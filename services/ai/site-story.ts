// services/ai/site-story.ts
//
// Synthèse "Raconte-moi ce chantier".
//
// Doctrine :
// - Le LLM lit le modèle de connaissance structuré (sujets + relations + acteurs), pas les PDFs.
// - Input structuré avec hiérarchie de confiance explicite :
//     matérialisé (objet actif) > terrain confirmé > terrain observé > documentaire seul.
//   Les rejected sont exclus en amont (getNavigableSubjectsForSite + query séparée).
// - Output = { headline, narrative, keyFindings[] }
//   Chaque finding a un evidenceType ('subject' | 'link' | 'actor') et un evidenceId traçable.
// - Post-traitement : résolution evidenceId → resolvedHref + resolvedLabel pour l'UI.
// - Silencieux sur erreur : la page s'affiche sans cette section.
// - model tier 'light' : input < 2 500 tokens, output ~600 tokens.
// - Règle de densité : le LLM ne peut pas inventer une relation absente du graphe.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { getSiteDependencyGraph, getSiteKnowledgeGraph } from '@/lib/documents/site-synthesis'
import type { SiteDependencyLink } from '@/lib/documents/site-synthesis'

export type SiteStoryEvidenceType = 'subject' | 'link' | 'actor'

export interface SiteStoryFinding {
  text: string
  evidenceType: SiteStoryEvidenceType
  evidenceId: string
  resolvedHref: string    // URL de navigation résolue (jamais vide si evidenceId valide)
  resolvedLabel: string   // Libellé du CTA ("Voir le sujet", "Voir la relation", "Voir l'intervenant")
}

export interface SiteStoryResult {
  headline: string
  narrative: string
  keyFindings: SiteStoryFinding[]
  subjectCount: number
  linkCount: number
  actorCount: number
  generatedAt: string
  model: string
  provider: string
}

const storySchema = z.object({
  headline: z.string().max(120).catch(''),
  narrative: z.string().max(800).catch(''),
  keyFindings: z.array(
    z.object({
      text: z.string().max(200).catch(''),
      evidenceType: z.enum(['subject', 'link', 'actor']).catch('subject' as const),
      evidenceId: z.string().catch(''),
    }),
  ).max(4).catch([]),
})

const STATUS_FR: Record<string, string> = {
  open: 'ouvert', in_progress: 'en cours', planned: 'planifié', done: 'clôturé',
  non_compliant: 'non conforme', awaiting_validation: 'en attente', still_open: 'toujours ouvert',
  field_checked: 'vérifié terrain', cancelled: 'annulé', not_applicable: 'sans objet',
}

const LINK_FR: Record<string, string> = {
  requires: 'nécessite', enables: 'permet', causes: 'entraîne',
  validates: 'valide', replaces: 'remplace', relates_to: 'est lié à',
}

// Niveaux de confiance par ordre décroissant de certitude.
// Chaque niveau correspond à une catégorie précise de preuve dans le modèle de connaissance.
function confidenceTags(
  s: NavigableSubjectSummary,
  confirmedNative: number,  // occurrences field_visit/meeting avec validation_status='confirmed'
  observedNative: number,   // occurrences field_visit/meeting avec validation_status='observed'
): string {
  const tags: string[] = []
  if (s.activeObjects.total > 0) tags.push('matérialisé')     // objet actif = preuve la plus forte
  if (confirmedNative > 0)        tags.push('terrain confirmé')  // validé par un humain
  if (observedNative > 0)         tags.push('terrain observé')   // vu en visite, non encore validé
  if (tags.length === 0 && s.pvCount > 0) tags.push('documentaire')  // PV/CR seul
  return tags.length > 0 ? `[${tags.join(', ')}]` : ''
}

function buildInput(
  subjects: NavigableSubjectSummary[],
  confirmedNativeCounts: Map<string, number>,
  observedNativeCounts: Map<string, number>,
  links: SiteDependencyLink[],
  actors: Array<{ csId: string; label: string; subjectLabel: string; actionCount: number }>,
): string {
  const lines: string[] = []

  const stagnants = subjects.filter((s) => s.isStagnant)
  const active = subjects.filter((s) => !s.isStagnant)

  lines.push(`=== Sujets actifs (${subjects.length}) ===`)
  lines.push('Légende de confiance : [matérialisé]=objet actif lié (preuve forte) | [terrain confirmé]=visite/réunion validée | [terrain observé]=observé, non validé (formuler avec prudence) | [documentaire]=PV/CR seulement (contexte, pas vérité opérationnelle).')

  if (stagnants.length > 0) {
    lines.push(`\n[Stagnants — sans évolution significative]`)
    for (const s of stagnants.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const stag = s.stagnationDays > 0 ? `, stagnation ${s.stagnationDays}j` : ''
      const change = s.lastMeaningfulChangeAt ? `, dernier chgt ${s.lastMeaningfulChangeAt.slice(0, 10)}` : ''
      const objParts = [
        s.activeObjects.actionsOpen > 0 ? `${s.activeObjects.actionsOpen} action(s)` : '',
        s.activeObjects.reservesOpen > 0 ? `${s.activeObjects.reservesOpen} réserve(s)` : '',
        s.activeObjects.deadlinesActive > 0 ? `${s.activeObjects.deadlinesActive} échéance(s)` : '',
        s.activeObjects.decisionsOpen > 0 ? `${s.activeObjects.decisionsOpen} décision(s)` : '',
      ].filter(Boolean).join(', ')
      const obj = objParts ? `, objets actifs : ${objParts}` : ''
      const conf = confidenceTags(s, confirmedNativeCounts.get(s.canonicalSubjectId) ?? 0, observedNativeCounts.get(s.canonicalSubjectId) ?? 0)
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${stag}${change}${obj} ${conf}`)
    }
  }

  if (active.length > 0) {
    lines.push(`\n[En cours]`)
    for (const s of active.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const objParts = [
        s.activeObjects.actionsOpen > 0 ? `${s.activeObjects.actionsOpen} action(s)` : '',
        s.activeObjects.reservesOpen > 0 ? `${s.activeObjects.reservesOpen} réserve(s)` : '',
        s.activeObjects.deadlinesActive > 0 ? `${s.activeObjects.deadlinesActive} échéance(s)` : '',
        s.activeObjects.decisionsOpen > 0 ? `${s.activeObjects.decisionsOpen} décision(s)` : '',
      ].filter(Boolean).join(', ')
      const obj = objParts ? `, objets actifs : ${objParts}` : ''
      const conf = confidenceTags(s, confirmedNativeCounts.get(s.canonicalSubjectId) ?? 0, observedNativeCounts.get(s.canonicalSubjectId) ?? 0)
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${obj} ${conf}`)
    }
  }

  if (links.length > 0) {
    lines.push(`\n=== Relations confirmées entre sujets (${links.length}) ===`)
    for (const l of links.slice(0, 10)) {
      const verb = LINK_FR[l.linkType] ?? l.linkType
      lines.push(`- [link:${l.id}] ${l.fromLabel} ${verb} ${l.toLabel}`)
    }
  } else {
    lines.push(`\n[Aucune relation confirmée entre sujets pour l'instant.]`)
  }

  if (actors.length > 0) {
    lines.push(`\n=== Responsabilités acteurs (${actors.length}) ===`)
    for (const a of actors.slice(0, 6)) {
      lines.push(`- [actor:${a.csId}] ${a.label} : responsable de "${a.subjectLabel}" (${a.actionCount} action(s))`)
    }
  }

  return lines.join('\n')
}

const GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    narrative: { type: 'STRING' },
    keyFindings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          evidenceType: { type: 'STRING', enum: ['subject', 'link', 'actor'] },
          evidenceId: { type: 'STRING' },
        },
        required: ['text', 'evidenceType', 'evidenceId'],
      },
    },
  },
  required: ['headline', 'narrative', 'keyFindings'],
}

const SYSTEM = `Tu es un assistant MemorIA. À partir UNIQUEMENT des faits fournis, produis une synthèse du chantier.

Hiérarchie de confiance à respecter strictement :
- [matérialisé] = objet métier actif lié (preuve la plus forte). Tu peux affirmer.
- [terrain confirmé] = validé lors d'une visite ou réunion. Tu peux rapporter.
- [terrain observé] = observé mais non encore validé. Formule avec prudence : "semble", "selon les observations".
- [documentaire] = extrait de PV/CR sans validation terrain. Formule prudemment : "selon les documents".
- Absence de preuve = n'affirme pas. N'invente pas.

Règles strictes :
- headline : état général du chantier en une phrase courte et factuelle, moins de 15 mots.
- narrative : 2 à 4 phrases décrivant l'état du chantier en respectant la hiérarchie de confiance. Les faits matérialisés et terrain confirmé passent en premier. Aucune causalité inventée. Aucun conseil. Aucune connaissance externe (normes, codes, définitions techniques).
- RÈGLE DE DENSITÉ : si le graphe a peu de relations (moins de 3), le récit reste factuel et modeste. Ne PAS écrire "X bloque Y" ou "X dépend de Y" si cette relation n'est pas dans les données. L'absence de relation dans le graphe ne signifie pas une relation implicite.
- keyFindings : 2 à 4 constats importants. Chaque constat cite UNE preuve. evidenceType = 'subject' si [id:...], 'link' si [link:...], 'actor' si [actor:...]. evidenceId = copie l'ID exact (sans les crochets et le préfixe). '' si constat général sans preuve identifiable.
- Français, ton neutre de conducteur de travaux.

Réponds en JSON : { "headline": "...", "narrative": "...", "keyFindings": [{ "text": "...", "evidenceType": "subject"|"link"|"actor", "evidenceId": "..." }] }`

function resolveHref(
  siteId: string,
  evidenceType: SiteStoryEvidenceType,
  evidenceId: string,
  linkResolutionMap: Map<string, string>,
): { href: string; label: string } {
  if (!evidenceId) return { href: '', label: '' }

  switch (evidenceType) {
    case 'subject':
      return {
        href: `/sites/${siteId}/historique/sujets/${evidenceId}`,
        label: 'Voir le sujet →',
      }
    case 'link': {
      // Naviguer vers le sujet source du lien (fromCanonicalSubjectId)
      const fromCsId = linkResolutionMap.get(evidenceId)
      if (!fromCsId) return { href: '', label: '' }
      return {
        href: `/sites/${siteId}/historique/sujets/${fromCsId}`,
        label: 'Voir la relation →',
      }
    }
    case 'actor':
      // L'acteur est un canonical_subject (company_id ou contact_id set) — sa fiche est sur la même route
      return {
        href: `/sites/${siteId}/historique/sujets/${evidenceId}`,
        label: "Voir l'intervenant →",
      }
  }
}

function emptyResult(model: string, provider: string): SiteStoryResult {
  return { headline: '', narrative: '', keyFindings: [], subjectCount: 0, linkCount: 0, actorCount: 0, generatedAt: new Date().toISOString(), model, provider }
}

export async function generateSiteStory(
  siteId: string,
  userId: string | null = null,
): Promise<SiteStoryResult> {
  const provider = getAIProvider()
  const supabase = createAdminClient()

  const [subjects, dependencyGraph, knowledgeGraph] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch((): NavigableSubjectSummary[] => []),
    getSiteDependencyGraph(siteId).catch((): { siteId: string; links: SiteDependencyLink[] } => ({ siteId, links: [] })),
    getSiteKnowledgeGraph(siteId).catch((): { siteId: string; nodes: unknown[]; edges: unknown[] } => ({ siteId, nodes: [], edges: [] })),
  ])

  // #228 : opérationnel = nature durable (actor exclu), plus la famille de la 1re occurrence.
  const operational = subjects.filter((s) => s.durableKind !== 'actor')
  if (operational.length === 0) return emptyResult('none', provider.name)

  // Requête séparée pour distinguer 'confirmed' vs 'observed' dans canonical_subject_occurrence.
  // getNavigableSubjectsForSite() filtre les rejected mais ne distingue pas les deux statuts —
  // nativeOccurrenceCount mélange confirmed + observed. On résout ici sans modifier la fonction partagée.
  const operationalIds = operational.map((s) => s.canonicalSubjectId)
  const confirmedNativeCounts = new Map<string, number>()
  const observedNativeCounts  = new Map<string, number>()

  if (operationalIds.length > 0) {
    const { data: occRows } = await supabase
      .from('canonical_subject_occurrence')
      .select('canonical_subject_id, validation_status')
      .eq('site_id', siteId)
      .in('canonical_subject_id', operationalIds)
      .in('source_kind', ['field_visit', 'meeting'])
      .in('validation_status', ['confirmed', 'observed'])

    for (const row of (occRows ?? []) as Array<{ canonical_subject_id: string; validation_status: string }>) {
      if (row.validation_status === 'confirmed') {
        confirmedNativeCounts.set(row.canonical_subject_id, (confirmedNativeCounts.get(row.canonical_subject_id) ?? 0) + 1)
      } else {
        observedNativeCounts.set(row.canonical_subject_id, (observedNativeCounts.get(row.canonical_subject_id) ?? 0) + 1)
      }
    }
  }

  // Map linkId → fromCanonicalSubjectId (résolution UX pour findings de type 'link')
  const linkResolutionMap = new Map<string, string>()
  for (const l of dependencyGraph.links) {
    if (l.fromCanonicalSubjectId) linkResolutionMap.set(l.id, l.fromCanonicalSubjectId)
  }

  // Responsabilités acteur→sujet depuis le knowledge graph
  type KEdge = { edgeType: string; from: string; to: string; actionCount?: number }
  type KNode = { id: string; label: string; kind: string }
  const kEdges = (knowledgeGraph.edges as KEdge[]) ?? []
  const kNodes = (knowledgeGraph.nodes as KNode[]) ?? []
  const nodeLabel = new Map<string, string>(kNodes.map((n) => [n.id, n.label]))

  const actors: Array<{ csId: string; label: string; subjectLabel: string; actionCount: number }> = []
  for (const e of kEdges) {
    if (e.edgeType !== 'responsible_for') continue
    const actorLabel   = nodeLabel.get(e.from)
    const subjectLabel = nodeLabel.get(e.to)
    if (actorLabel && subjectLabel) {
      actors.push({ csId: e.from, label: actorLabel, subjectLabel, actionCount: e.actionCount ?? 1 })
    }
  }

  if (provider.name === 'mock') {
    const stagnants = operational.filter((s) => s.isStagnant)
    return {
      headline: stagnants.length > 0
        ? `${stagnants.length} sujet(s) en stagnation sur ${operational.length} actifs`
        : `${operational.length} sujets actifs suivis`,
      narrative: `[mock] Ce chantier comporte ${operational.length} sujet(s) actif(s), ${dependencyGraph.links.length} relation(s) confirmée(s) et ${actors.length} responsabilité(s) acteur. ${stagnants.length > 0 ? `${stagnants.length} sujet(s) stagn${stagnants.length > 1 ? 'ent' : 'e'} sans évolution significative.` : ''}`,
      keyFindings: operational.slice(0, 2).map((s) => ({
        text: `[mock] ${s.title} — ${s.isStagnant ? `stagnation ${s.stagnationDays}j` : s.currentStatus ?? 'en cours'}`,
        evidenceType: 'subject' as const,
        evidenceId: s.canonicalSubjectId,
        resolvedHref: `/sites/${siteId}/historique/sujets/${s.canonicalSubjectId}`,
        resolvedLabel: 'Voir le sujet →',
      })),
      subjectCount: operational.length,
      linkCount: dependencyGraph.links.length,
      actorCount: actors.length,
      generatedAt: new Date().toISOString(),
      model: 'mock-1',
      provider: 'mock',
    }
  }

  const userMessage = buildInput(operational, confirmedNativeCounts, observedNativeCounts, dependencyGraph.links, actors)

  const parsed = await withAITracking('site_story', userId, async () => {
    const out = await provider.complete({
      systemPrompt: SYSTEM,
      userMessage,
      responseSchema: storySchema,
      geminiSchema: GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 600,
    })

    const empty = { headline: '', narrative: '', keyFindings: [] } as z.infer<typeof storySchema>

    if (out.finishReason && out.finishReason !== 'STOP' && out.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
      return { result: empty, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
    }

    let result: z.infer<typeof storySchema> | undefined

    if (out.parsed !== undefined && out.parsed !== null) {
      const r = storySchema.safeParse(out.parsed)
      if (r.success) result = r.data
    }
    if (!result) {
      try {
        const r = storySchema.safeParse(JSON.parse(out.text))
        if (r.success) result = r.data
      } catch { /* ignore */ }
    }
    if (!result) {
      const text = out.text ?? ''
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          const r = storySchema.safeParse(JSON.parse(text.slice(start, end + 1)))
          if (r.success) result = r.data
        } catch { /* ignore */ }
      }
    }
    if (!result) result = empty

    return { result, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  // Post-processing : résolution evidenceId → resolvedHref + resolvedLabel
  const keyFindings: SiteStoryFinding[] = parsed.keyFindings.map((f) => {
    const { href, label } = resolveHref(siteId, f.evidenceType, f.evidenceId, linkResolutionMap)
    return {
      text: f.text,
      evidenceType: f.evidenceType,
      evidenceId: f.evidenceId,
      resolvedHref: href,
      resolvedLabel: label,
    }
  })

  return {
    headline: parsed.headline,
    narrative: parsed.narrative,
    keyFindings,
    subjectCount: operational.length,
    linkCount: dependencyGraph.links.length,
    actorCount: actors.length,
    generatedAt: new Date().toISOString(),
    model: provider.name,
    provider: provider.name,
  }
}
