// services/ai/site-story.ts
//
// Synthèse "Raconte-moi ce chantier".
//
// Doctrine :
// - Le LLM lit le modèle de connaissance structuré (sujets + relations + acteurs), pas les PDFs.
// - Input = NavigableSubjectSummary[] + SiteDependencyGraph (liens avec IDs) + KnowledgeGraph (acteurs).
// - Hiérarchie de confiance encodée dans l'input : matérialisé > terrain > documentaire.
// - Output = { headline, narrative, keyFindings[] } — chaque finding cite un ID traçable.
// - linkResolutionMap permet au composant de naviguer depuis un linkId vers le sujet source.
// - Silencieux sur erreur : la page s'affiche sans cette section.
// - model tier 'light' : input < 2 500 tokens, output ~600 tokens.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { getSiteDependencyGraph, getSiteKnowledgeGraph } from '@/lib/documents/site-synthesis'
import type { SiteDependencyLink } from '@/lib/documents/site-synthesis'

export interface SiteStoryFinding {
  text: string
  subjectId: string       // canonical_subject_id cité (ou '')
  linkId: string          // link ID cité (ou '')
  resolvedSubjectId: string  // ID résolu : subjectId, sinon fromCsId du lien, sinon ''
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
      subjectId: z.string().catch(''),
      linkId: z.string().catch(''),
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

// Niveau de confiance d'un sujet d'après ses sources disponibles.
// Les rejected sont déjà exclus par getNavigableSubjectsForSite (validation_status != 'rejected').
function confidenceTag(s: NavigableSubjectSummary): string {
  const tags: string[] = []
  if (s.activeObjects.total > 0) tags.push('matérialisé')   // objet actif = fait le plus fort
  if (s.nativeOccurrenceCount > 0) tags.push('confirmé terrain')  // visite/réunion
  if (tags.length === 0 && s.pvCount > 0) tags.push('documentaire uniquement')
  return tags.length > 0 ? `[${tags.join(', ')}]` : ''
}

function buildInput(
  subjects: NavigableSubjectSummary[],
  links: SiteDependencyLink[],
  actors: Array<{ label: string; subjectLabel: string; actionCount: number }>,
): string {
  const lines: string[] = []

  const stagnants = subjects.filter((s) => s.isStagnant)
  const active = subjects.filter((s) => !s.isStagnant)

  lines.push(`=== Sujets actifs (${subjects.length}) ===`)
  lines.push('Niveaux de confiance : [matérialisé] = objet actif lié ; [confirmé terrain] = visite ou réunion ; [documentaire] = PV/CR uniquement.')

  if (stagnants.length > 0) {
    lines.push(`\n[Stagnants — sans évolution significative]`)
    for (const s of stagnants.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const stag = s.stagnationDays > 0 ? `, stagnation ${s.stagnationDays}j` : ''
      const change = s.lastMeaningfulChangeAt ? `, dernier changement ${s.lastMeaningfulChangeAt.slice(0, 10)}` : ''
      const obj = s.activeObjects.total > 0
        ? `, objets actifs : ${[
            s.activeObjects.actionsOpen > 0 ? `${s.activeObjects.actionsOpen} action(s)` : '',
            s.activeObjects.reservesOpen > 0 ? `${s.activeObjects.reservesOpen} réserve(s)` : '',
            s.activeObjects.deadlinesActive > 0 ? `${s.activeObjects.deadlinesActive} échéance(s)` : '',
            s.activeObjects.decisionsOpen > 0 ? `${s.activeObjects.decisionsOpen} décision(s)` : '',
          ].filter(Boolean).join(', ')}`
        : ''
      const conf = confidenceTag(s)
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${stag}${change}${obj} ${conf}`)
    }
  }

  if (active.length > 0) {
    lines.push(`\n[En cours]`)
    for (const s of active.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const obj = s.activeObjects.total > 0
        ? `, objets actifs : ${[
            s.activeObjects.actionsOpen > 0 ? `${s.activeObjects.actionsOpen} action(s)` : '',
            s.activeObjects.reservesOpen > 0 ? `${s.activeObjects.reservesOpen} réserve(s)` : '',
            s.activeObjects.deadlinesActive > 0 ? `${s.activeObjects.deadlinesActive} échéance(s)` : '',
            s.activeObjects.decisionsOpen > 0 ? `${s.activeObjects.decisionsOpen} décision(s)` : '',
          ].filter(Boolean).join(', ')}`
        : ''
      const conf = confidenceTag(s)
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${obj} ${conf}`)
    }
  }

  if (links.length > 0) {
    lines.push(`\n=== Relations confirmées (${links.length}) ===`)
    for (const l of links.slice(0, 10)) {
      const verb = LINK_FR[l.linkType] ?? l.linkType
      lines.push(`- [link:${l.id}] ${l.fromLabel} ${verb} ${l.toLabel}`)
    }
  }

  if (actors.length > 0) {
    lines.push(`\n=== Responsabilités acteurs (${actors.length}) ===`)
    for (const a of actors.slice(0, 6)) {
      lines.push(`- ${a.label} est responsable de "${a.subjectLabel}" (${a.actionCount} action(s))`)
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
          subjectId: { type: 'STRING' },
          linkId: { type: 'STRING' },
        },
        required: ['text', 'subjectId', 'linkId'],
      },
    },
  },
  required: ['headline', 'narrative', 'keyFindings'],
}

const SYSTEM = `Tu es un assistant MemorIA. À partir UNIQUEMENT des faits fournis, produis une synthèse du chantier.

Hiérarchie de confiance à respecter :
- [matérialisé] = fait le plus certain (objet actif lié). Tu peux l'affirmer.
- [confirmé terrain] = observé lors d'une visite ou réunion. Tu peux le rapporter.
- [documentaire uniquement] = extrait de PV/CR sans validation terrain. Formule avec prudence ("selon les documents").
- Absence de preuve = n'affirme pas. N'invente pas.

Règles strictes :
- headline : état général du chantier en une phrase courte et factuelle, moins de 15 mots.
- narrative : 2 à 4 phrases qui décrivent l'état du chantier en respectant la hiérarchie de confiance. Les faits les plus forts passent en premier. Aucune causalité inventée. Aucun conseil. Aucune connaissance externe.
- keyFindings : 2 à 4 constats. Chaque constat cite UN sujet ou UNE relation. Pour subjectId : copie l'ID exact depuis [id:XXX] (ou '' si constat général). Pour linkId : copie l'ID depuis [link:XXX] (ou '' si pas de lien). Si le constat ne s'applique qu'à une relation, mets linkId et laisse subjectId à ''.
- Si le graphe est peu dense (< 3 relations), le récit doit rester modeste et factuel — ne pas inventer de structure causale.
- Français, ton neutre de conducteur de travaux.

Réponds en JSON : { "headline": "...", "narrative": "...", "keyFindings": [{ "text": "...", "subjectId": "...", "linkId": "..." }] }`

function emptyResult(model: string, provider: string): SiteStoryResult {
  return { headline: '', narrative: '', keyFindings: [], subjectCount: 0, linkCount: 0, actorCount: 0, generatedAt: new Date().toISOString(), model, provider }
}

export async function generateSiteStory(
  siteId: string,
  userId: string | null = null,
): Promise<SiteStoryResult> {
  const provider = getAIProvider()

  const [subjects, dependencyGraph, knowledgeGraph] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch((): NavigableSubjectSummary[] => []),
    getSiteDependencyGraph(siteId).catch((): { siteId: string; links: SiteDependencyLink[] } => ({ siteId, links: [] })),
    getSiteKnowledgeGraph(siteId).catch((): { siteId: string; nodes: unknown[]; edges: unknown[] } => ({ siteId, nodes: [], edges: [] })),
  ])

  const operational = subjects.filter((s) => s.kind !== 'person' && s.kind !== 'company' && s.kind !== 'knowledge_fact')
  if (operational.length === 0) return emptyResult('none', provider.name)

  // Map linkId → fromCanonicalSubjectId (pour résolution UX des findings)
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

  const actors: Array<{ label: string; subjectLabel: string; actionCount: number }> = []
  for (const e of kEdges) {
    if (e.edgeType !== 'responsible_for') continue
    const actorLabel = nodeLabel.get(e.from)
    const subjectLabel = nodeLabel.get(e.to)
    if (actorLabel && subjectLabel) {
      actors.push({ label: actorLabel, subjectLabel, actionCount: e.actionCount ?? 1 })
    }
  }

  const stagnants = operational.filter((s) => s.isStagnant)

  if (provider.name === 'mock') {
    return {
      headline: stagnants.length > 0
        ? `${stagnants.length} sujet(s) en stagnation sur ${operational.length} actifs`
        : `${operational.length} sujets actifs suivis`,
      narrative: `[mock] Ce chantier comporte ${operational.length} sujet(s) actif(s), ${dependencyGraph.links.length} relation(s) confirmée(s) et ${actors.length} responsabilité(s) acteur. ${stagnants.length > 0 ? `${stagnants.length} sujet(s) stagn${stagnants.length > 1 ? 'ent' : 'e'} sans évolution significative.` : ''}`,
      keyFindings: operational.slice(0, 2).map((s) => ({
        text: `[mock] ${s.title} — ${s.isStagnant ? `stagnation ${s.stagnationDays}j` : s.currentStatus ?? 'en cours'} ${confidenceTag(s)}`,
        subjectId: s.canonicalSubjectId,
        linkId: '',
        resolvedSubjectId: s.canonicalSubjectId,
      })),
      subjectCount: operational.length,
      linkCount: dependencyGraph.links.length,
      actorCount: actors.length,
      generatedAt: new Date().toISOString(),
      model: 'mock-1',
      provider: 'mock',
    }
  }

  const userMessage = buildInput(operational, dependencyGraph.links, actors)

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

  // Résolution post-LLM : chaque finding obtient un resolvedSubjectId traçable
  const keyFindings: SiteStoryFinding[] = parsed.keyFindings.map((f) => ({
    text: f.text,
    subjectId: f.subjectId,
    linkId: f.linkId,
    resolvedSubjectId: f.subjectId || (f.linkId ? linkResolutionMap.get(f.linkId) ?? '' : ''),
  }))

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
