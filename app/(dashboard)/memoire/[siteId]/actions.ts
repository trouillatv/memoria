'use server'

// Atelier mémoire — agent de Q&A scopé À CE CHANTIER. Pas un chat généraliste :
// « interroger la mémoire de ce site ». À partir d'un DIGEST structuré + des
// TRACES retrouvées par la recherche existante (preuves cliquables), le LLM
// SYNTHÉTISE — il propose, il ne décide pas (doctrine memoire : « tu synthétises
// et tu nommes, tu ne décides pas »). Pas de RAG vectoriel neuf : on réutilise la
// recherche site déjà en place comme fournisseur de SOURCES.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { getSiteMemoryDigest } from '@/lib/db/site-memory-digest'
import { askSiteMemoryAction as searchSiteMemory, type SiteMemoryHit } from '@/app/(dashboard)/sites/[id]/memory-query-actions'

const answerSchema = z.object({
  answer: z.string().default(''),
  retiens: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
})
export type SiteMemoryAnswer = z.infer<typeof answerSchema>

/** Preuve cliquable retournée à l'UI (forme légère, sérialisable). */
export interface SiteMemorySource {
  type: string
  title: string
  snippet: string
  occurredAt: string
  href?: string
}

const SYSTEM = [
  "Tu es le copilote mémoire de CE chantier (et de lui seul). Tu réponds à la question à partir UNIQUEMENT du digest et des traces retrouvées (réunions, visites, actions, réserves, décisions, obligations, sujets, intervenants). Tu remplis :",
  '- answer : réponse COURTE, concrète, factuelle, appuyée sur les éléments fournis. Si l\'information manque, dis-le franchement plutôt que d\'inventer.',
  '- retiens : 0 à 4 points clés à RETENIR / SURVEILLER (ce qui traîne, bloque, revient).',
  '- next : 0 à 3 PROCHAINS POINTS à traiter, formulés comme des SUGGESTIONS prudentes ou des questions (« valider le devis ? »), JAMAIS comme un ordre. Tu proposes, l\'humain décide.',
  'INTERDITS : inventer un fait absent des éléments fournis ; prédire l\'avenir ; juger ou comparer des personnes. Français, phrases courtes.',
  'Réponds STRICTEMENT en JSON de cette forme : {"answer":"…","retiens":["…"],"next":["…"]}.',
].join('\n')

function hrefFor(h: SiteMemoryHit): string | undefined {
  if (h.href) return h.href                                  // documents (lien direct existant)
  if (h.type === 'intervention') return `/interventions/${h.id}` // route connue et sûre
  return undefined                                            // autres types : carte sans lien (cran « navigation » à venir)
}

function mockAnswer(siteName: string, q: string, digestText: string): SiteMemoryAnswer {
  const retiens = digestText.split('\n').filter((l) => l.trim().startsWith('•')).slice(0, 3).map((l) => l.replace(/^\s*•\s*/, ''))
  return {
    answer: `(démo locale) Voici ce que je trouve dans la mémoire de ${siteName} au sujet de « ${q} ». Configurez une clé IA (Gemini/Anthropic) pour une vraie synthèse.`,
    retiens,
    next: [],
  }
}

export async function askSiteMemoryAgentAction(
  siteId: string,
  question: string,
): Promise<
  | { ok: true; answer: SiteMemoryAnswer; sources: SiteMemorySource[]; confidence: 'forte' | 'moyenne' | 'faible' | null; mock: boolean }
  | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 300)
  if (q.length < 3) return { ok: false, error: 'Question trop courte' }

  // Digest (contexte large) + recherche (preuves citables) en parallèle.
  const [digest, search] = await Promise.all([
    getSiteMemoryDigest(siteId),
    searchSiteMemory(siteId, q).catch(() => ({ ok: false as const, error: 'search' })),
  ])
  if (!digest) return { ok: false, error: 'Chantier introuvable' }

  const hits = search.ok ? search.hits.slice(0, 8) : []
  const confidence = search.ok ? (search.summary?.confidence ?? null) : null
  const sources: SiteMemorySource[] = hits.map((h) => ({
    type: h.type, title: h.title, snippet: h.snippet, occurredAt: h.occurredAt, href: hrefFor(h),
  }))

  const provider = getAIProvider()
  try {
    const answer = await withAITracking('site_memory_qa', user.id, async () => {
      let userMessage: string
      if (provider.name === 'mock') {
        userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockAnswer(digest.siteName, q, digest.text))}`
      } else {
        const sourceLines = hits.length > 0
          ? hits.map((h, i) => `[${i + 1}] (${h.type}) ${h.title}${h.snippet ? ' — ' + h.snippet : ''}`.slice(0, 240)).join('\n')
          : '(aucune trace retrouvée par la recherche)'
        userMessage = [
          `Question : ${q}`,
          '',
          `=== Mémoire du chantier ${digest.siteName} (synthèse) ===`,
          digest.text,
          '',
          '=== Traces retrouvées pour cette question (sources affichées à l\'utilisateur) ===',
          sourceLines,
        ].join('\n')
      }
      const r = await provider.complete({ systemPrompt: SYSTEM, userMessage, responseSchema: answerSchema, modelTier: 'light', maxOutputTokens: 700 })
      const parsed = answerSchema.safeParse(r.parsed)
      const result: SiteMemoryAnswer = parsed.success ? parsed.data : { answer: '', retiens: [], next: [] }
      return { result, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })
    return { ok: true, answer, sources, confidence, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
