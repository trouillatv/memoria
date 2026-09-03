// services/ai/canonical-subject-trajectory.ts
//
// Trajectoire synthétique d'un canonical_subject.
//
// Doctrine :
// - Le LLM raconte des faits déterministes préformatés, il n'invente rien.
// - Input = résumé structuré borné dérivé de CanonicalSubjectLife.
// - Output = { headline, trajectory, evidence[] } — jamais une chaîne brute.
// - Silencieux sur erreur : la page s'affiche sans cette section.
// - model tier 'light' : input petit (< 1 000 tokens), output 2-3 phrases.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import { isActorKind } from '@/lib/subjects/kind'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'

export interface SubjectTrajectoryResult {
  headline: string
  trajectory: string
  evidence: Array<{ kind: 'occurrence' | 'event'; id: string; date: string }>
  generatedAt: string
  model: string
  provider: string
}

const trajectorySchema = z.object({
  headline: z.string().max(100).catch(''),
  trajectory: z.string().max(600).catch(''),
  evidence: z.array(
    z.object({
      kind: z.enum(['occurrence', 'event']).catch('occurrence' as const),
      id: z.string().catch(''),
      date: z.string().catch(''),
    }),
  ).max(10).catch([]),
})

const STATUS_FR: Record<string, string> = {
  // P0-2B — displayState partagé
  resolved: 'résolu', reopened: 'réouvert',
  open: 'ouvert', in_progress: 'en cours', planned: 'planifié', done: 'clôturé',
  non_compliant: 'non conforme', awaiting_validation: 'en attente de validation',
  cancelled: 'annulé', informational: 'informatif', field_checked: 'vérifié terrain',
  still_open: 'toujours ouvert', not_applicable: 'sans objet', mentioned: 'évoqué',
  actee: 'actée', appliquee: 'appliquée', caduque: 'caduque', proposee: 'proposée',
  contredite: 'contredite', lifted: 'levée', to_plan: 'à planifier', superseded: 'remplacée',
}

function frDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildInput(life: CanonicalSubjectLife): string {
  const realOccs = life.occurrences
    .filter((o) => !o.isGap)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .slice(0, 20)

  const lines: string[] = []
  lines.push(`Sujet : ${life.label}`)
  if (life.csStatus !== 'active') lines.push(`Statut sujet : ${life.csStatus}`)
  // P0-2B — « État actuel » = displayState partagé (vérité d'état courant), jamais le rawStatus.
  if (life.displayState !== 'unknown') lines.push(`État actuel : ${STATUS_FR[life.displayState] ?? life.displayState}`)
  if (life.firstSeenAt) lines.push(`Première mention : ${frDateShort(life.firstSeenAt)}`)
  if (life.lastSeenAt)  lines.push(`Dernière mention : ${frDateShort(life.lastSeenAt)}`)
  if (life.isStagnant && life.stagnationDays) {
    lines.push(`Stagnation : ${life.stagnationDays} jours sans évolution (${life.consecutiveMentionsWithoutChange + 1} mentions sans changement)`)
  }

  if (realOccs.length > 0) {
    lines.push('\nChronologie :')
    for (const occ of realOccs) {
      const src = occ.sourceKind === 'field_visit' ? 'visite' : occ.sourceKind === 'meeting' ? 'réunion' : 'PV'
      const statusPart = occ.visitStatus ?? occ.documentStatus
      const statusLabel = statusPart ? ` (${STATUS_FR[statusPart] ?? statusPart})` : ''
      const desc = occ.description ?? occ.label ?? ''
      const descPart = desc ? ` — ${desc.slice(0, 120)}` : ''
      const idHint = occ.proposalId ?? occ.reportId ?? ''
      lines.push(`- [id:${idHint}] ${frDateShort(occ.effectiveDate)} · ${src}${statusLabel}${descPart}`)
    }
  }

  const ACTIVE = new Set(['open', 'in_progress', 'to_plan', 'planned', 'non_compliant', 'still_open', 'awaiting_validation', 'proposee'])
  const activeEvents = life.materializedEvents.filter((e) => !e.status || ACTIVE.has(e.status))
  if (activeEvents.length > 0) {
    lines.push('\nObjets actifs :')
    for (const ev of activeEvents.slice(0, 8)) {
      const st = ev.status ? ` (${STATUS_FR[ev.status] ?? ev.status})` : ''
      const datePart = ev.date ? ` · ${frDateShort(ev.date)}` : ''
      lines.push(`- [id:${ev.entityId}] ${ev.entityType.replace('site_', '')} : ${ev.title}${st}${datePart}`)
    }
  }

  return lines.join('\n')
}

const SYSTEM = `Tu es un assistant MemorIA. À partir UNIQUEMENT des faits fournis, produis une synthèse structurée d'un sujet de chantier.

Règles strictes :
- headline : état actuel très court, moins de 10 mots, factuel.
- trajectory : 1 à 3 phrases expliquant comment ce sujet en est arrivé là. Aucune invention de causalité. Aucun fait absent des données. Tu ne déclares pas résolu ce que les données ne prouvent pas. Tu ne déclares pas bloqué si aucun blocage explicite n'est mentionné. Tu n'utilises pas de connaissances externes (normes, codes, définitions techniques).
- evidence : liste des [id:...] des occurrences ou objets que tes phrases citent réellement.
- Français, ton neutre de conducteur de travaux. Pas de formules creuses.

Réponds en JSON : { "headline": "...", "trajectory": "...", "evidence": [{ "kind": "occurrence"|"event", "id": "...", "date": "..." }] }`

// Schéma Gemini natif — contraint la structure de sortie au niveau du provider.
// Les type values suivent l'enum Type du SDK @google/genai (uppercase).
const GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    headline:  { type: 'STRING' },
    trajectory: { type: 'STRING' },
    evidence: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['occurrence', 'event'] },
          id:   { type: 'STRING' },
          date: { type: 'STRING' },
        },
        required: ['kind', 'id', 'date'],
      },
    },
  },
  required: ['headline', 'trajectory', 'evidence'],
}

function emptyResult(model: string, provider: string): SubjectTrajectoryResult {
  return { headline: '', trajectory: '', evidence: [], generatedAt: new Date().toISOString(), model, provider }
}

export async function generateSubjectTrajectory(
  life: CanonicalSubjectLife,
  userId: string | null = null,
): Promise<SubjectTrajectoryResult> {
  const provider = getAIProvider()

  // Guard acteur : query kind séparément (colonne pas encore dans getCanonicalSubjectLife)
  let kind: string | null = null
  try {
    const { data: csKindRow } = await createAdminClient()
      .from('canonical_subject')
      .select('kind')
      .eq('id', life.canonicalSubjectId)
      .maybeSingle()
    kind = (csKindRow as { kind: string | null } | null)?.kind ?? null
  } catch { /* colonne absente → traité comme non-acteur */ }
  if (isActorKind(kind)) {
    return { headline: life.label, trajectory: '', evidence: [], generatedAt: new Date().toISOString(), model: 'none', provider: provider.name }
  }

  const realOccs = life.occurrences.filter((o) => !o.isGap)
  if (realOccs.length === 0) return emptyResult('none', provider.name)

  if (provider.name === 'mock') {
    return {
      headline: life.displayState !== 'unknown' ? (STATUS_FR[life.displayState] ?? life.displayState) : 'En cours',
      trajectory: `[mock] ${life.label} — trajectoire de démonstration sur ${realOccs.length} occurrence(s).`,
      evidence: realOccs.slice(0, 2).map((o) => ({
        kind: 'occurrence' as const,
        id: o.proposalId ?? o.reportId ?? '',
        date: o.effectiveDate,
      })),
      generatedAt: new Date().toISOString(),
      model: 'mock-1',
      provider: 'mock',
    }
  }

  const userMessage = buildInput(life)

  const parsed = await withAITracking('subject_trajectory', userId, async () => {
    const out = await provider.complete({
      systemPrompt: SYSTEM,
      userMessage,
      responseSchema: trajectorySchema,
      geminiSchema: GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 400,
    })

    const empty = { headline: '', trajectory: '', evidence: [] } as z.infer<typeof trajectorySchema>

    // Troncature détectée → section absente (trajectoire partielle = pire que rien)
    if (out.finishReason && out.finishReason !== 'STOP' && out.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
      return { result: empty, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
    }

    let result: z.infer<typeof trajectorySchema> | undefined

    // 1. Sortie structurée du provider (chemin privilégié — actif quand geminiSchema est fourni)
    if (out.parsed !== undefined && out.parsed !== null) {
      const r = trajectorySchema.safeParse(out.parsed)
      if (r.success) result = r.data
    }
    // 2. Parse direct du texte brut (provider sans sortie structurée ou parsing échoué)
    if (!result) {
      try {
        const r = trajectorySchema.safeParse(JSON.parse(out.text))
        if (r.success) result = r.data
      } catch { /* ignore */ }
    }
    // 3. Extraction du premier objet JSON (premier '{' → dernier '}') : garde-fou
    // si Gemini ajoute du texte avant ou après le JSON malgré geminiSchema.
    if (!result) {
      const text = out.text ?? ''
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          const r = trajectorySchema.safeParse(JSON.parse(text.slice(start, end + 1)))
          if (r.success) result = r.data
        } catch { /* ignore */ }
      }
    }
    // 4. Aucune extraction réussie → section absente (ne jamais afficher le texte brut)
    if (!result) result = empty

    return { result, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  return {
    headline: parsed.headline,
    trajectory: parsed.trajectory,
    evidence: parsed.evidence,
    generatedAt: new Date().toISOString(),
    model: provider.name,
    provider: provider.name,
  }
}
