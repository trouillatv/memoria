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
  const sims = hits.map((h) => h.similarity).filter((s): s is number => s != null)
  const topSim = sims.length ? Math.max(...sims) : 0
  const count = hits.length
  let confidence: 'forte' | 'moyenne' | 'faible'
  if (count >= 8 || (count >= 4 && topSim >= 0.72)) confidence = 'forte'
  else if (count >= 3 || topSim >= 0.6) confidence = 'moyenne'
  else confidence = 'faible'
  return { count, distinctDays: days.size, confidence, recurring: count >= 6, last30dCount, spanDays }
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
      occurredAt: h.occurredAt, similarity: null, fts: h.rank,
    })
  }
  for (const s of semHits) {
    const type = SRC_TO_TYPE[s.source_type]
    if (!type) continue
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
      similarity: s.similarity, fts: 0,
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
