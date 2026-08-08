// services/ai/site-story.ts
//
// Synthèse "Raconte-moi ce chantier".
//
// Doctrine :
// - Le LLM lit le modèle de connaissance structuré (sujets + relations), pas les PDFs.
// - Input = NavigableSubjectSummary[] + SiteDependencyGraph (faits structurés bornés).
// - Output = { headline, narrative, keyFindings[] } — chaque finding cite un ID traçable.
// - Silencieux sur erreur : la page s'affiche sans cette section.
// - model tier 'light' : input < 2 000 tokens, output 3-6 phrases.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { getSiteDependencyGraph } from '@/lib/documents/site-synthesis'
import type { SiteDependencyLink } from '@/lib/documents/site-synthesis'

export interface SiteStoryResult {
  headline: string
  narrative: string
  keyFindings: Array<{
    text: string
    subjectId: string
    linkId: string
  }>
  subjectCount: number
  linkCount: number
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
  field_checked: 'vérifié', cancelled: 'annulé', not_applicable: 'sans objet',
}

const LINK_FR: Record<string, string> = {
  requires: 'nécessite', enables: 'permet', causes: 'entraîne',
  validates: 'valide', replaces: 'remplace', relates_to: 'est lié à',
}

function buildInput(
  subjects: NavigableSubjectSummary[],
  links: SiteDependencyLink[],
): string {
  const lines: string[] = []

  const operational = subjects.filter((s) => s.kind !== 'person' && s.kind !== 'company' && s.kind !== 'knowledge_fact')
  const stagnants = operational.filter((s) => s.isStagnant)
  const active = operational.filter((s) => !s.isStagnant)

  lines.push(`=== Sujets actifs (${operational.length}) ===`)

  if (stagnants.length > 0) {
    lines.push(`\n[Stagnants — sans évolution significative]`)
    for (const s of stagnants.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const obj = s.activeObjects.total > 0 ? `, ${s.activeObjects.total} objet(s) actif(s)` : ''
      const stag = s.stagnationDays > 0 ? `, stagnation ${s.stagnationDays}j` : ''
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${stag}${obj}`)
    }
  }

  if (active.length > 0) {
    lines.push(`\n[En cours]`)
    for (const s of active.slice(0, 6)) {
      const st = s.currentStatus ? ` (${STATUS_FR[s.currentStatus] ?? s.currentStatus})` : ''
      const obj = s.activeObjects.total > 0 ? `, ${s.activeObjects.total} objet(s) actif(s)` : ''
      lines.push(`- [id:${s.canonicalSubjectId}] ${s.title}${st}${obj}`)
    }
  }

  if (links.length > 0) {
    lines.push(`\n=== Relations confirmées (${links.length}) ===`)
    for (const l of links.slice(0, 10)) {
      const verb = LINK_FR[l.linkType] ?? l.linkType
      lines.push(`- [link:${l.id}] ${l.fromLabel} ${verb} ${l.toLabel}`)
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

Règles strictes :
- headline : état général du chantier en une phrase courte et factuelle, moins de 15 mots.
- narrative : 2 à 4 phrases qui décrivent l'état du chantier : ce qui avance, ce qui stagne, les tensions clés. Aucun fait inventé. Aucun conseil. Aucune connaissance externe.
- keyFindings : 2 à 4 constats. Chaque constat cite UN sujet ou UNE relation. Pour subjectId : copie l'ID exact depuis [id:XXX] dans les données (ou '' si général). Pour linkId : copie l'ID depuis [link:XXX] (ou '' si pas de lien).
- Français, ton neutre de conducteur de travaux.

Réponds en JSON : { "headline": "...", "narrative": "...", "keyFindings": [{ "text": "...", "subjectId": "...", "linkId": "..." }] }`

function emptyResult(model: string, provider: string, subjectCount: number, linkCount: number): SiteStoryResult {
  return { headline: '', narrative: '', keyFindings: [], subjectCount, linkCount, generatedAt: new Date().toISOString(), model, provider }
}

export async function generateSiteStory(
  siteId: string,
  userId: string | null = null,
): Promise<SiteStoryResult> {
  const provider = getAIProvider()

  const [subjects, dependencyGraph] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch((): NavigableSubjectSummary[] => []),
    getSiteDependencyGraph(siteId).catch((): { siteId: string; links: SiteDependencyLink[] } => ({ siteId, links: [] })),
  ])

  const operational = subjects.filter((s) => s.kind !== 'person' && s.kind !== 'company' && s.kind !== 'knowledge_fact')
  if (operational.length === 0) return emptyResult('none', provider.name, 0, 0)

  if (provider.name === 'mock') {
    const stagnants = operational.filter((s) => s.isStagnant)
    return {
      headline: stagnants.length > 0
        ? `${stagnants.length} sujet(s) en stagnation sur ${operational.length} actifs`
        : `${operational.length} sujets actifs suivis`,
      narrative: `[mock] Ce chantier comporte ${operational.length} sujet(s) actif(s) et ${dependencyGraph.links.length} relation(s) confirmée(s). ${stagnants.length > 0 ? `${stagnants.length} sujet(s) stagn${stagnants.length > 1 ? 'ent' : 'e'} sans évolution significative.` : ''}`,
      keyFindings: operational.slice(0, 2).map((s) => ({
        text: `[mock] ${s.title} — ${s.isStagnant ? `stagnation ${s.stagnationDays}j` : s.currentStatus ?? 'en cours'}`,
        subjectId: s.canonicalSubjectId,
        linkId: '',
      })),
      subjectCount: operational.length,
      linkCount: dependencyGraph.links.length,
      generatedAt: new Date().toISOString(),
      model: 'mock-1',
      provider: 'mock',
    }
  }

  const userMessage = buildInput(operational, dependencyGraph.links)

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

  return {
    headline: parsed.headline,
    narrative: parsed.narrative,
    keyFindings: parsed.keyFindings,
    subjectCount: operational.length,
    linkCount: dependencyGraph.links.length,
    generatedAt: new Date().toISOString(),
    model: provider.name,
    provider: provider.name,
  }
}
