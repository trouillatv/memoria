'use server'

// 🔍 Interroger ce site — Phase 1.5 (sémantique + plein-texte, retrieval-only).
//
// Cible : moteur d'enquête, pas chatbot. Question → RÉSULTATS classés, typés,
// datés, sourcés. ZÉRO LLM, zéro synthèse générative, jamais de cause inventée.
//
// Modes :
//   - search  : question libre → embeddings (findSimilarTraces) + FTS
//               (search_memory), fusionnés/dédupliqués, rang conceptuel d'abord.
//   - teams   : « Qui connaît ce site ? » → équipes (descriptif, jamais de score
//               de performance ni de comparaison nominative).
//   - photos  : « Dernières photos » → récence (preuves visuelles).
//
// Corpus traces : anomalies, notes de site, notes d'intervention, légendes
// photo. Scopé au site courant. Jamais de recherche par personne+heure+lieu.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { logUsageEvent } from '@/lib/db/usage-events'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { searchMemory, type MemoryHitType } from '@/lib/db/memory-search'
import { getEmbedding } from '@/lib/ai/embeddings'
import { findSimilarTraces } from '@/lib/ai/embed-trace'
import { getSiteMemoryTimeline } from '@/lib/db/site-memory'
import { getSiteTeamsKnowledge } from '@/lib/db/site-team-knowledge'
import { getSiteRecentPhotos } from '@/lib/db/site-cockpit'

const IdSchema = z.string().uuid()

async function requireOperator(): Promise<boolean> {
  const user = await getCurrentUserWithProfile()
  if (!user) return false
  return user.role === 'admin' || user.role === 'manager' || user.role === 'chef_equipe'
}

// Seuil de similarité sémantique : sous ce niveau, un match est trop faible pour
// être « proche » — précision >> rappel (une question vague rend peu, pas du bruit).
const SEM_FLOOR = 0.45

// source_type de trace_embeddings → type d'affichage mémoire.
const SRC_TO_TYPE: Record<string, MemoryHitType> = {
  anomaly: 'anomaly',
  site_note: 'site_note',
  intervention_note: 'intervention',
  photo_caption: 'photo',
}

export interface SiteMemoryHit {
  type: MemoryHitType
  id: string
  title: string
  snippet: string
  occurredAt: string
  /** Match sémantique (0..1) ou null si trouvé seulement en plein-texte. */
  similarity: number | null
  /** Match MOT-CLÉ (plein-texte). Distinct de similarity : un hit peut être à la
   *  fois mot-clé ET sémantique. Sépare « correspondance exacte » vs « proche ». */
  keyword: boolean
}

/** Signal DÉTERMINISTE sur un résultat de recherche (zéro LLM). Aide à juger la
 *  force et la nature de ce qui est retrouvé, sans réponse magique. */
export interface SiteMemorySummary {
  count: number
  /** Dates distinctes = « sources indépendantes » (proxy). */
  distinctDays: number
  confidence: 'forte' | 'moyenne' | 'faible'
  /** ≥ 6 occurrences = sujet récurrent. */
  recurring: boolean
  /** Occurrences sur les 30 derniers jours = sujet actif. */
  last30dCount: number
  /** Étalement temporel (jours) entre la plus ancienne et la plus récente. */
  spanDays: number | null
  /** Au moins une trace contient VRAIMENT le terme (match mot-clé). Sinon on n'a
   *  que du « sémantiquement proche » — signal faible, à annoncer comme tel. */
  keywordGrounded: boolean
}

function computeSummary(hits: SiteMemoryHit[]): SiteMemorySummary | null {
  if (hits.length === 0) return null
  const days = new Set(hits.map((h) => (h.occurredAt || '').slice(0, 10)).filter(Boolean))
  const times = hits
    .map((h) => (h.occurredAt ? new Date(h.occurredAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t))
  const now = Date.now()
  const last30dCount = times.filter((t) => now - t <= 30 * 86_400_000).length
  const spanDays = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000) : null
  const ftsCount = hits.filter((h) => h.keyword).length // matches mot-clé EXACTS (FTS)
  const count = hits.length
  // ANCRAGE LEXICAL : au moins une trace contient VRAIMENT le terme cherché.
  // Sans lui, on n'a que du « sémantiquement proche ». Or sur du jargon chantier
  // court, les vecteurs se ressemblent tous (« béton » ≈ « humidité » ≈ « marche
  // pas » à ~0.7) : la sémantique seule produit du bruit CONFIANT. Doctrine
  // précision >> rappel : pas d'ancrage mot-clé ⇒ confiance FAIBLE, sans exception.
  const keywordGrounded = ftsCount >= 1
  let confidence: 'forte' | 'moyenne' | 'faible'
  if (ftsCount >= 3) confidence = 'forte'       // le mot revient dans ≥3 traces réelles
  else if (ftsCount >= 1) confidence = 'moyenne' // au moins un vrai match mot-clé
  else confidence = 'faible'                     // sémantique seul → faible, point
  // « Sujet récurrent » = le MÊME mot-clé revient. Le clustering sémantique du
  // jargon ne compte pas (sinon « 8 traces vaguement liées » = faux récurrent).
  const recurring = ftsCount >= 4
  return { count, distinctDays: days.size, confidence, recurring, last30dCount, spanDays, keywordGrounded }
}

export async function askSiteMemoryAction(
  siteId: string,
  question: string,
): Promise<{ ok: true; hits: SiteMemoryHit[]; summary: SiteMemorySummary | null } | { ok: false; error: string }> {
  if (!(await requireOperator())) return { ok: false, error: 'Accès refusé' }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 200)
  if (q.length < 2) return { ok: true, hits: [], summary: null }

  // Sémantique + plein-texte + index d'enrichissement (dates/titres) en parallèle.
  const queryEmbedding = await getEmbedding(q).catch(() => null)
  const [ftsHits, semHits, timeline] = await Promise.all([
    searchMemory({ q, siteId, periodDays: 3650, limit: 30 }).catch(() => []),
    queryEmbedding
      ? findSimilarTraces({ siteId, queryEmbedding, limit: 20 }).catch(() => [])
      : Promise.resolve([]),
    getSiteMemoryTimeline(siteId, { limit: 400, periodDays: 3650 }).catch(() => []),
  ])

  const byId = new Map(timeline.map((e) => [e.id, e]))

  type Merged = SiteMemoryHit & { fts: number }
  const merged = new Map<string, Merged>()

  for (const h of ftsHits) {
    merged.set(`${h.type}:${h.id}`, {
      type: h.type, id: h.id, title: h.title, snippet: h.snippet,
      occurredAt: h.occurredAt, similarity: null, keyword: true, fts: h.rank,
    })
  }
  for (const s of semHits) {
    const type = SRC_TO_TYPE[s.source_type]
    if (!type) continue
    if (s.similarity < SEM_FLOOR) continue // écarte le bruit (matches trop faibles)
    const key = `${type}:${s.source_id}`
    const existing = merged.get(key)
    if (existing) {
      existing.similarity = Math.max(existing.similarity ?? 0, s.similarity)
      continue
    }
    const ev = byId.get(s.source_id)
    merged.set(key, {
      type, id: s.source_id,
      title: ev?.title ?? '',
      snippet: s.text_excerpt || ev?.detail || '',
      occurredAt: ev?.occurredAt ?? '',
      similarity: s.similarity, keyword: false, fts: 0,
    })
  }

  // Rang : pertinence conceptuelle d'abord, puis plein-texte, puis récence.
  const hits = [...merged.values()]
    .sort((a, b) =>
      (b.similarity ?? 0) - (a.similarity ?? 0) ||
      b.fts - a.fts ||
      (a.occurredAt < b.occurredAt ? 1 : -1),
    )
    .slice(0, 30)
    .map(({ fts: _fts, ...h }) => h)

  // Usage produit (best-effort, fire-and-forget — ne retarde pas la réponse).
  void logUsageEvent({ event: 'memory_search', siteId, query: q })

  return { ok: true, hits, summary: computeSummary(hits) }
}

// Mots vides FR + bruit générique du domaine (peu informatifs comme suggestion).
const TERM_STOPWORDS = new Set([
  'avec', 'dans', 'pour', 'cette', 'sont', 'mais', 'plus', 'tout', 'tous', 'toute',
  'toutes', 'leur', 'leurs', 'etre', 'avoir', 'fait', 'faire', 'sans', 'sous', 'entre',
  'vers', 'chez', 'donc', 'alors', 'aussi', 'comme', 'cela', 'celui', 'celle', 'quand',
  'encore', 'depuis', 'apres', 'avant', 'pendant', 'selon', 'elles', 'nous', 'vous',
  'elle', 'notre', 'votre', 'aux', 'ont', 'ete', 'par', 'sur', 'qui', 'que', 'dont',
  'ainsi', 'meme', 'tres', 'bien', 'deja', 'etait', 'etaient', 'sera', 'seront',
  // bruit générique : peu utile comme piste de recherche
  'site', 'chantier', 'note', 'intervention', 'photo', 'jour', 'jours', 'semaine', 'test',
])

/** Termes qui REVIENNENT le plus dans la mémoire du site (déterministe, zéro LLM).
 *  « Revient » = présent dans ≥2 traces distinctes — on compte une fois par trace,
 *  pour qu'un mot répété dans 1 seule note ne domine pas. Sert à proposer des
 *  pistes ANCRÉES (qui existent vraiment), au lieu d'exemples génériques codés. */
export async function getSiteMemoryTermsAction(
  siteId: string,
): Promise<{ ok: true; terms: { term: string; count: number }[] } | { ok: false; error: string }> {
  if (!(await requireOperator())) return { ok: false, error: 'Accès refusé' }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const timeline = await getSiteMemoryTimeline(siteId, { limit: 400, periodDays: 3650 }).catch(() => [])
  const counts = new Map<string, number>()
  for (const e of timeline) {
    const text = `${e.title ?? ''} ${e.detail ?? ''}`.toLowerCase()
    const tokens = text.match(/\p{L}{4,}/gu) ?? []
    const seenInTrace = new Set<string>()
    for (const tok of tokens) {
      if (TERM_STOPWORDS.has(tok) || seenInTrace.has(tok)) continue
      seenInTrace.add(tok)
      counts.set(tok, (counts.get(tok) ?? 0) + 1)
    }
  }
  const terms = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term, count]) => ({ term, count }))
  return { ok: true, terms }
}

export interface SiteTeamHit {
  teamName: string
  teamColor: string | null
  interventions: number
  firstPassage: string | null
  lastPassage: string | null
  missions: string[]
  isActive: boolean
}

/** « Qui connaît ce site ? » — équipes (descriptif, sans score ni classement). */
export async function getSiteTeamsAction(
  siteId: string,
): Promise<{ ok: true; teams: SiteTeamHit[] } | { ok: false; error: string }> {
  if (!(await requireOperator())) return { ok: false, error: 'Accès refusé' }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }
  const teams = await getSiteTeamsKnowledge(siteId).catch(() => [])
  return {
    ok: true,
    teams: teams.map((t) => ({
      teamName: t.team_name,
      teamColor: t.team_color,
      interventions: t.interventionsDocumentedCount,
      firstPassage: t.firstPassageDate,
      lastPassage: t.lastPassageDate,
      missions: t.missionNames,
      isActive: t.isActive,
    })),
  }
}

export interface SitePhotoHit {
  id: string
  url: string
  caption: string | null
  takenAt: string
  takenByName: string | null
}

/** « Dernières photos » — preuves visuelles récentes du site. */
export async function getSiteRecentPhotosAction(
  siteId: string,
): Promise<{ ok: true; photos: SitePhotoHit[] } | { ok: false; error: string }> {
  if (!(await requireOperator())) return { ok: false, error: 'Accès refusé' }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }
  const photos = await getSiteRecentPhotos(siteId, 12).catch(() => [])
  return {
    ok: true,
    photos: photos.map((p) => ({
      id: p.id,
      url: p.signedUrl,
      caption: p.caption,
      takenAt: p.takenAt,
      takenByName: p.takenByName,
    })),
  }
}

// ── Phase 2B — synthèse encadrée sur question libre (LLM) ────────────────────
//
// L'ADN de MemorIA : « je pose une question, la mémoire me répond ». Mais le LLM
// ne RAISONNE pas — il REGROUPE les traces déjà retrouvées en thèmes comptés.
// Golden rule câblée : contexte fermé (uniquement les hits), JAMAIS de cause,
// de prédiction ni d'opinion. Structure imposée par l'UI : Réponse / Confiance /
// Sources. À la demande (bouton), jamais auto (coût + valeur ciblée).

export interface SearchTheme {
  label: string
  count: number
}

/** Phase 2C — synthèse utile à l'action (pas juste descriptive). */
export interface MemorySynthesis {
  /** « Ce qu'il faut retenir / surveiller » — 1 à 4 points concrets. */
  retiens: string[]
  /** Hypothèse PRUDENTE (questions « pourquoi ») — une lecture plausible, jamais une vérité. */
  hypothesis: string | null
  /** Regroupement des traces en thèmes comptés. */
  themes: SearchTheme[]
}

const synthesisSchema = z.object({
  retiens: z.array(z.string().min(1).max(280)).max(4),
  hypothesis: z.string().max(400).nullable().optional(),
  themes: z.array(z.object({
    label: z.string().min(1).max(80),
    count: z.number().int().min(1),
  })).max(5),
})

export async function synthesizeSiteMemoryAction(
  siteId: string,
  question: string,
  hits: SiteMemoryHit[],
): Promise<{ ok: true; synthesis: MemorySynthesis; mock: boolean } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 200)
  const corpus = (hits ?? [])
    .slice(0, 18)
    .map((h, i) => `${i + 1}. [${h.type}] ${(h.title ? h.title + ' — ' : '') + (h.snippet || '')}`.slice(0, 240))
    .filter((l) => l.length > 6)
  const EMPTY: MemorySynthesis = { retiens: [], hypothesis: null, themes: [] }
  if (corpus.length === 0) return { ok: true, synthesis: EMPTY, mock: false }

  const provider = getAIProvider()
  const systemPrompt = [
    "Tu es le copilote mémoire d'un chantier. À partir UNIQUEMENT des traces retrouvées pour la question, tu produis une SYNTHÈSE utile pour agir. Tu remplis trois champs :",
    "- `retiens` : 1 à 4 points concrets — CE QU'IL FAUT RETENIR / SURVEILLER (ce qui traîne, revient, bloque). Factuel, appuyé sur les traces.",
    "- `hypothesis` : UNIQUEMENT si la question demande un « pourquoi ». Formule UNE hypothèse PRUDENTE, à partir des SEULES traces. Commence par « D'après les traces, » et reste une hypothèse, JAMAIS une vérité affirmée. Sinon laisse null.",
    '- `themes` : regroupe les traces en 2 à 4 thèmes, avec le nombre de traces par thème (`count` ≤ nombre de traces fournies).',
    "INTERDITS STRICTS : aucune prédiction, aucune opinion personnelle, aucune recommandation de décision (« il faut faire X »). Tu synthétises et tu nommes ; tu ne décides pas. Tu n'inventes AUCUN fait absent des traces.",
    'Français, phrases courtes.',
    // Forme JSON EXPLICITE : sans elle, Gemini (mode JSON) peut renvoyer une
    // structure qui ne valide pas le schéma → synthèse vide (« pas de synthèse nette »).
    'Réponds STRICTEMENT en JSON de cette forme, et rien d\'autre : {"retiens":["…"],"hypothesis":null,"themes":[{"label":"…","count":2}]}.',
  ].join('\n')
  const userMessage = `Question : ${q || '(non précisée)'}\n\nTraces retrouvées (${corpus.length}) :\n${corpus.join('\n')}`

  try {
    const synthesis = await withAITracking('search_synthesis', user.id, async () => {
      const r = await provider.complete({
        systemPrompt,
        userMessage,
        responseSchema: synthesisSchema,
        modelTier: 'light',
        maxOutputTokens: 800,
      })
      const parsed = synthesisSchema.safeParse(r.parsed)
      const data = parsed.success ? parsed.data : EMPTY
      const themes = (data.themes ?? [])
        .map((t) => ({ label: t.label, count: Math.min(t.count, corpus.length) }))
        .filter((t) => t.count > 0)
      return {
        result: { retiens: data.retiens ?? [], hypothesis: data.hypothesis ?? null, themes } as MemorySynthesis,
        tokens: r.tokens,
        model: r.model,
        provider: provider.name,
        durationMs: r.durationMs,
      }
    })
    return { ok: true, synthesis, mock: provider.name === 'mock' }
  } catch {
    return { ok: false, error: 'Synthèse indisponible' }
  }
}
