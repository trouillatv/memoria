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
  if (life.currentStatus) lines.push(`État actuel : ${STATUS_FR[life.currentStatus] ?? life.currentStatus}`)
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

function emptyResult(model: string, provider: string): SubjectTrajectoryResult {
  return { headline: '', trajectory: '', evidence: [], generatedAt: new Date().toISOString(), model, provider }
}

export async function generateSubjectTrajectory(
  life: CanonicalSubjectLife,
  userId: string | null = null,
): Promise<SubjectTrajectoryResult> {
  const provider = getAIProvider()

  // Guards déterministes — pas d'appel LLM
  if (isActorKind(life.kind)) {
    return { headline: life.label, trajectory: '', evidence: [], generatedAt: new Date().toISOString(), model: 'none', provider: provider.name }
  }

  const realOccs = life.occurrences.filter((o) => !o.isGap)
  if (realOccs.length === 0) return emptyResult('none', provider.name)

  if (provider.name === 'mock') {
    return {
      headline: life.currentStatus ? (STATUS_FR[life.currentStatus] ?? life.currentStatus) : 'En cours',
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
      modelTier: 'light',
      maxOutputTokens: 250,
    })

    let result: z.infer<typeof trajectorySchema> | undefined
    if (out.parsed !== undefined && out.parsed !== null) {
      const r = trajectorySchema.safeParse(out.parsed)
      if (r.success) result = r.data
    }
    if (!result) {
      try {
        const r = trajectorySchema.safeParse(JSON.parse(out.text))
        if (r.success) result = r.data
      } catch { /* ignore */ }
    }
    if (!result) result = { headline: '', trajectory: (out.text ?? '').slice(0, 400), evidence: [] }

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
