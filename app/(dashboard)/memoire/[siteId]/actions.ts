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
import { createAdminClient } from '@/lib/supabase/admin'
import { getSubjectTimeline } from '@/lib/db/subjects'

const answerSchema = z.object({
  answer: z.string().default(''),
  retiens: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
  // Concepts centraux de la réponse → boutons d'exploration (sujet métier).
  concepts: z.array(z.string()).default([]),
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
  '- concepts : 2 à 4 CONCEPTS CENTRAUX de ta réponse (sujet métier, ouvrage, entreprise — ex. « Porte coupe-feu », « Sécurité incendie », « Entreprise X »), pour explorer leur histoire. Des noms concrets, jamais des mots vides.',
  'INTERDITS : inventer un fait absent des éléments fournis ; prédire l\'avenir ; juger ou comparer des personnes. Français, phrases courtes.',
  'Réponds STRICTEMENT en JSON de cette forme : {"answer":"…","retiens":["…"],"next":["…"],"concepts":["…"]}.',
].join('\n')

// Navigation (cran 4) : chaque source pointe vers sa destination la PLUS PRÉCISE
// disponible. Limite connue : la recherche ne porte pas le report_id/parent id des
// CR & décisions → on route vers la sous-page qui les agrège (pas le record exact).
// Un vrai deep-link par objet exigerait d'enrichir la recherche (hors périmètre ici).
function hrefFor(h: SiteMemoryHit, siteId: string): string {
  if (h.href) return h.href                                   // documents : lien direct
  switch (h.type) {
    case 'intervention':     return `/interventions/${h.id}`  // record-level (route sûre)
    case 'site_reserve':     return `/sites/${siteId}/reserves`
    case 'meeting_decision': return `/sites/${siteId}/subjects`
    case 'photo':
    case 'anomaly':
    case 'site_note':        return `/sites/${siteId}/journal`
    default:                 return `/sites/${siteId}`        // site_action, report_document…
  }
}

function mockAnswer(siteName: string, q: string, digestText: string): SiteMemoryAnswer {
  const retiens = digestText.split('\n').filter((l) => l.trim().startsWith('•')).slice(0, 3).map((l) => l.replace(/^\s*•\s*/, ''))
  // Concepts factices = mots saillants de la question (≥5 lettres), pour pouvoir
  // tester l'exploration sans clé IA.
  const concepts = Array.from(new Set(q.split(/[\s,.?!]+/).filter((w) => w.length >= 5))).slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return {
    answer: `(démo locale) Voici ce que je trouve dans la mémoire de ${siteName} au sujet de « ${q} ». Configurez une clé IA (Gemini/Anthropic) pour une vraie synthèse.`,
    retiens,
    next: [],
    concepts,
  }
}

// Cran 5 — l'unité de navigation est le SUJET, présenté en TIMELINE (l'histoire),
// pas l'objet. Si le concept matche un sujet connu → vraie getSubjectTimeline ;
// sinon → chronologie des traces retrouvées pour ce terme.
export interface SiteMemoryTimelineItem { date: string; kind: string; label: string; meta: string | null }

export async function getSubjectMemoryTimelineAction(
  siteId: string,
  concept: string,
): Promise<{ ok: true; subjectName: string | null; items: SiteMemoryTimelineItem[] } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  if (!z.string().uuid().safeParse(siteId).success) return { ok: false, error: 'Site invalide' }
  const term = (concept ?? '').trim().slice(0, 120)
  if (term.length < 2) return { ok: true, subjectName: null, items: [] }

  // 1) Concept = sujet connu du site ? → vraie timeline du sujet (exhaustive).
  const sb = createAdminClient()
  const { data: subjects } = await sb.from('subjects').select('id, name').eq('site_id', siteId).neq('status', 'closed').ilike('name', `%${term}%`).limit(10)
  const rows = (subjects ?? []) as Array<{ id: string; name: string }>
  const match = rows.find((r) => r.name.toLowerCase() === term.toLowerCase()) ?? rows[0]
  if (match) {
    const events = await getSubjectTimeline(match.id).catch(() => [])
    const items: SiteMemoryTimelineItem[] = events
      .map((e) => ({ date: e.date, kind: e.kind, label: e.label, meta: e.reportLabel ?? e.meta }))
      .filter((i) => i.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    return { ok: true, subjectName: match.name, items }
  }

  // 2) Sinon : chronologie des traces retrouvées pour ce terme (recherche).
  const search = await searchSiteMemory(siteId, term).catch(() => ({ ok: false as const, error: 'search' }))
  if (!search.ok) return { ok: true, subjectName: null, items: [] }
  const items: SiteMemoryTimelineItem[] = search.hits
    .map((h) => ({ date: h.occurredAt, kind: h.type, label: h.title, meta: h.snippet ? h.snippet.slice(0, 90) : null }))
    .filter((i) => i.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  return { ok: true, subjectName: null, items }
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
    type: h.type, title: h.title, snippet: h.snippet, occurredAt: h.occurredAt, href: hrefFor(h, siteId),
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
      const result: SiteMemoryAnswer = parsed.success ? parsed.data : { answer: '', retiens: [], next: [], concepts: [] }
      return { result, tokens: r.tokens, model: r.model, provider: provider.name, durationMs: r.durationMs }
    })
    return { ok: true, answer, sources, confidence, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
