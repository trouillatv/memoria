'use server'

// 🔍 Interroger toute l'entreprise — P7 (cross-site, retrieval + synthèse encadrée).
//
// Généralisation ORG-LEVEL du moteur de site (sites/[id]/memory-query-actions).
// Même ADN : question → RÉSULTATS classés, typés, datés, SOURCÉS PAR SITE.
// Sémantique cross-sites (find_similar_traces_for_tenant) + plein-texte org
// (search_memory sans siteId), fusionnés/dédupliqués. La synthèse LLM (à la
// demande) regroupe UNIQUEMENT les traces retrouvées — jamais de cause inventée,
// jamais de recommandation. Sujet = sites/traces, jamais une personne.

import { z } from 'zod'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { logUsageEvent } from '@/lib/db/usage-events'
import { getAIProvider } from '@/services/ai/factory'
import { withAITracking } from '@/services/ai/tracking'
import { searchMemory, type MemoryHitType } from '@/lib/db/memory-search'
import { getEmbedding } from '@/lib/ai/embeddings'
import { findSimilarTracesForTenant } from '@/lib/ai/embed-trace'
import { searchKnowledgeForOrg } from '@/lib/ai/match-ao-knowledge'
import { listSites } from '@/lib/db/sites'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types/db'

async function requireOperator(): Promise<{ role: UserRole } | null> {
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  if (user.role !== 'admin' && user.role !== 'manager') return null
  return { role: user.role }
}

// Seuil de similarité sémantique : sous ce niveau, un match est trop faible pour
// être « proche » — précision >> rappel (vaut autant cross-site que par site).
const SEM_FLOOR = 0.45

// source_type de trace_embeddings → type d'affichage mémoire (mêmes mappings
// que le moteur de site ; le RPC tenant ne renvoie pas photo_caption).
const SRC_TO_TYPE: Record<string, MemoryHitType> = {
  anomaly: 'anomaly',
  site_note: 'site_note',
  intervention_note: 'intervention',
  photo_caption: 'photo',
}

export interface OrgMemoryHit {
  /** 'document' = couche Connaissance (bibliothèque / AO passé / document).
   *  'action' | 'reserve' | 'mission' = couche EXÉCUTION (keyword ILIKE org-scopé). */
  type: MemoryHitType | 'document' | 'action' | 'reserve' | 'mission'
  id: string
  title: string
  snippet: string
  /** FTS donne une date ; un match sémantique seul peut être null (best-effort). */
  occurredAt: string | null
  /** Match sémantique (0..1) ou null si trouvé seulement en plein-texte. */
  similarity: number | null
  /** Site d'origine (traces) — clé du moteur org-level. null pour la connaissance. */
  siteId: string | null
  /** Nom résolu via listSites ; « Site inconnu » si non résoluble ; '' si knowledge. */
  siteName: string
  /** Couche Connaissance : libellé de la source (titre doc/biblio/AO) + domaine. */
  sourceLabel: string | null
  sourceDomain: string | null
  /** Match MOT-CLÉ (FTS ou ILIKE opérations). Distinct de similarity : un hit peut
   *  être à la fois mot-clé ET sémantique. Sépare « correspondance exacte » vs « proche ». */
  keyword: boolean
}

/** Signal DÉTERMINISTE sur un résultat de recherche (zéro LLM). Identique au
 *  moteur de site — confiance = FORCE des correspondances, jamais juste le nombre. */
export interface OrgMemorySummary {
  count: number
  distinctDays: number
  confidence: 'forte' | 'moyenne' | 'faible'
  recurring: boolean
  last30dCount: number
  spanDays: number | null
  /** Au moins une trace contient VRAIMENT le terme (match mot-clé / ILIKE). */
  keywordGrounded: boolean
}

function computeSummary(hits: OrgMemoryHit[]): OrgMemorySummary | null {
  if (hits.length === 0) return null
  const days = new Set(hits.map((h) => (h.occurredAt || '').slice(0, 10)).filter(Boolean))
  const times = hits
    .map((h) => (h.occurredAt ? new Date(h.occurredAt).getTime() : NaN))
    .filter((t) => !Number.isNaN(t))
  const now = Date.now()
  const last30dCount = times.filter((t) => now - t <= 30 * 86_400_000).length
  const spanDays = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000) : null
  const ftsCount = hits.filter((h) => h.keyword).length // vrais matches mot-clé (FTS / ILIKE)
  const count = hits.length
  // ANCRAGE LEXICAL (cf. moteur site) : sans au moins un vrai match mot-clé, on
  // n'a que du « sémantiquement proche ». Sur du jargon chantier court les vecteurs
  // se ressemblent tous → bruit confiant. Doctrine précision >> rappel : pas
  // d'ancrage ⇒ confiance FAIBLE, et jamais « sujet récurrent ».
  const keywordGrounded = ftsCount >= 1
  let confidence: 'forte' | 'moyenne' | 'faible'
  if (ftsCount >= 3) confidence = 'forte'
  else if (ftsCount >= 1) confidence = 'moyenne'
  else confidence = 'faible'
  const recurring = ftsCount >= 4
  return { count, distinctDays: days.size, confidence, recurring, last30dCount, spanDays, keywordGrounded }
}

/** Résout le tenant_id scopé à l'organisation (single-tenant pilote : une seule
 *  valeur sur toutes les sites de l'org). Renvoie null si aucune site. */
async function getOrgTenantId(orgId: string | null): Promise<string | null> {
  const supabase = createAdminClient()
  let q = supabase.from('sites').select('tenant_id').not('tenant_id', 'is', null).limit(1)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data } = await q.maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

// ── Retriever OPÉRATIONS (couche EXÉCUTION) ──────────────────────────────────
// Recherche KEYWORD (ILIKE, PAS sémantique) scopée aux sites de l'org, sur la
// donnée d'exécution réelle : actions / réserves / missions. Les interventions
// NE SONT PAS ré-ajoutées ici — elles remontent déjà via leurs notes dans
// searchMemory (intervention_note). similarity = null → compte comme du FTS.

/** Échappe une saisie utilisateur destinée à un filtre PostgREST `.or(ilike)`.
 *  Retire les caractères qui cassent/parsent le filtre ou agissent en wildcard
 *  (`% _ , ( ) * \`), collapse les espaces. < 2 chars utiles → '' (skip). */
function sanitizeIlikeTerm(raw: string): string {
  const cleaned = (raw ?? '')
    .replace(/[%_,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 2 ? cleaned : ''
}

type OpsHit = Omit<OrgMemoryHit, 'siteName'> & { fts: number }

export async function searchOperationsForOrg({
  orgSiteIds,
  q,
  limit = 10,
}: {
  orgSiteIds: string[]
  q: string
  limit?: number
}): Promise<OpsHit[]> {
  const term = sanitizeIlikeTerm(q)
  if (!term || orgSiteIds.length === 0) return []

  const supabase = createAdminClient()
  const like = `%${term}%`
  const trunc = (s: string | null, n = 220): string => (s ?? '').slice(0, n)

  const [actions, reserves, missions] = await Promise.all([
    // site_actions — title, body (DbSiteAction). resultType 'action'.
    supabase
      .from('site_actions')
      .select('id, title, body, created_at, site_id')
      .in('site_id', orgSiteIds)
      .or(`title.ilike.${like},body.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(limit)
      .then((r) => r.data ?? [], () => []),
    // site_reserve — label, location, lift_note (migration 110, snake_case).
    // (pas de colonne « note » brute ; la note de levée est lift_note.)
    supabase
      .from('site_reserve')
      .select('id, label, location, lift_note, created_at, site_id')
      .in('site_id', orgSiteIds)
      .or(`label.ilike.${like},location.ilike.${like},lift_note.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(limit)
      .then((r) => r.data ?? [], () => []),
    // missions — name, description (DbMission). Vivantes uniquement.
    supabase
      .from('missions')
      .select('id, name, description, created_at, site_id, deleted_at')
      .in('site_id', orgSiteIds)
      .is('deleted_at', null)
      .or(`name.ilike.${like},description.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(limit)
      .then((r) => r.data ?? [], () => []),
  ])

  const hits: OpsHit[] = []

  for (const a of actions as Array<{ id: string; title: string | null; body: string | null; created_at: string; site_id: string | null }>) {
    hits.push({
      type: 'action', id: a.id, title: a.title || 'Action',
      snippet: trunc(a.body), occurredAt: a.created_at, similarity: null, keyword: true, fts: 1,
      siteId: a.site_id ?? null, sourceLabel: null, sourceDomain: null,
    })
  }
  for (const r of reserves as Array<{ id: string; label: string | null; location: string | null; lift_note: string | null; created_at: string; site_id: string | null }>) {
    hits.push({
      type: 'reserve', id: r.id, title: r.label || 'Réserve',
      snippet: trunc(r.lift_note || r.location), occurredAt: r.created_at, similarity: null, keyword: true, fts: 1,
      siteId: r.site_id ?? null, sourceLabel: null, sourceDomain: null,
    })
  }
  for (const m of missions as Array<{ id: string; name: string | null; description: string | null; created_at: string; site_id: string | null }>) {
    hits.push({
      type: 'mission', id: m.id, title: m.name || 'Mission',
      snippet: trunc(m.description), occurredAt: m.created_at, similarity: null, keyword: true, fts: 1,
      siteId: m.site_id ?? null, sourceLabel: null, sourceDomain: null,
    })
  }

  return hits
}

export async function askOrgMemoryAction(
  question: string,
): Promise<{ ok: true; hits: OrgMemoryHit[]; summary: OrgMemorySummary | null } | { ok: false; error: string }> {
  const op = await requireOperator()
  if (!op) return { ok: false, error: 'Accès refusé' }

  const q = (question ?? '').trim().slice(0, 200)
  if (q.length < 2) return { ok: true, hits: [], summary: null }

  const orgId = await getOrgId()

  // Carte siteId → nom (attribution par site). Calculée une fois, en parallèle.
  const queryEmbedding = await getEmbedding(q).catch(() => null)
  const [ftsHits, sites, tenantId] = await Promise.all([
    searchMemory({ q, periodDays: 3650, limit: 30 }).catch(() => []), // org-scoped (pas de siteId)
    listSites().catch(() => []),
    getOrgTenantId(orgId).catch(() => null),
  ])

  const siteNameMap = new Map(sites.map((s) => [s.id, s.name]))
  const resolveSiteName = (siteId: string | null): string =>
    (siteId && siteNameMap.get(siteId)) || 'Site inconnu'

  // Couche EXÉCUTION (actions/réserves/missions) — keyword ILIKE org-scopé, en
  // parallèle du sémantique. Ne dépend pas de l'embedding.
  const orgSiteIds = sites.map((s) => s.id)
  const [opsHits, [semHits, knowledgeHits]] = await Promise.all([
    searchOperationsForOrg({ orgSiteIds, q, limit: 10 }).catch(() => []),
    queryEmbedding && tenantId
      ? Promise.all([
          findSimilarTracesForTenant({ tenantId, queryEmbedding, limit: 30, threshold: SEM_FLOOR }).catch(() => []),
          searchKnowledgeForOrg({ tenantId, queryEmbedding, role: op.role, limit: 10 }).catch(() => []),
        ])
      : Promise.resolve([[], []] as const),
  ])

  type Merged = OrgMemoryHit & { fts: number }
  const merged = new Map<string, Merged>()

  for (const h of ftsHits) {
    merged.set(`${h.type}:${h.id}`, {
      type: h.type, id: h.id, title: h.title, snippet: h.snippet,
      occurredAt: h.occurredAt, similarity: null, keyword: true, fts: h.rank,
      siteId: h.siteId, siteName: resolveSiteName(h.siteId),
      sourceLabel: null, sourceDomain: null,
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
      // FTS donne déjà siteId ; sinon on prend celui du match sémantique.
      if (!existing.siteId && s.site_id) {
        existing.siteId = s.site_id
        existing.siteName = resolveSiteName(s.site_id)
      }
      continue
    }
    merged.set(key, {
      type, id: s.source_id,
      title: '',
      // Un match sémantique seul n'a pas de date (pas de timeline cross-site —
      // trop lourd sur toutes les sites). null acceptable (best-effort).
      snippet: s.text_excerpt || '',
      occurredAt: null,
      similarity: s.similarity, keyword: false, fts: 0,
      siteId: s.site_id ?? null,
      siteName: resolveSiteName(s.site_id ?? null),
      sourceLabel: null, sourceDomain: null,
    })
  }

  // Couche Connaissance (bibliothèque / AO passés / documents) — attribuée à sa
  // SOURCE documentaire, pas à un site. Visibilité docs déjà filtrée au recall.
  for (const k of knowledgeHits) {
    merged.set(`knowledge:${k.sourceDomain}:${k.sourceId}`, {
      type: 'document', id: `${k.sourceDomain}:${k.sourceId}`,
      title: k.label, snippet: k.snippet, occurredAt: null,
      similarity: k.similarity, keyword: false, fts: 0,
      siteId: null, siteName: '',
      sourceLabel: k.label, sourceDomain: k.sourceDomain,
    })
  }

  // Couche EXÉCUTION — actions / réserves / missions (keyword). Clés
  // `action:` / `reserve:` / `mission:` : pas de collision avec les traces.
  for (const o of opsHits) {
    merged.set(`${o.type}:${o.id}`, {
      type: o.type, id: o.id, title: o.title, snippet: o.snippet,
      occurredAt: o.occurredAt, similarity: o.similarity, keyword: true, fts: o.fts,
      siteId: o.siteId, siteName: resolveSiteName(o.siteId),
      sourceLabel: o.sourceLabel, sourceDomain: o.sourceDomain,
    })
  }

  // Rang : pertinence conceptuelle d'abord, puis plein-texte, puis récence.
  const hits = [...merged.values()]
    .sort((a, b) =>
      (b.similarity ?? 0) - (a.similarity ?? 0) ||
      b.fts - a.fts ||
      ((a.occurredAt ?? '') < (b.occurredAt ?? '') ? 1 : -1),
    )
    .slice(0, 30)
    .map(({ fts: _fts, ...h }) => h)

  void logUsageEvent({ event: 'memory_search', query: q })

  return { ok: true, hits, summary: computeSummary(hits) }
}

// ── Synthèse encadrée org-level (LLM) ────────────────────────────────────────
// Identique à synthesizeSiteMemoryAction, mais sur toute l'entreprise (pas de
// siteId). Golden rule : contexte fermé (uniquement les hits), JAMAIS de cause,
// de prédiction ni d'opinion. À la demande (bouton), jamais auto.

export interface SearchTheme {
  label: string
  count: number
}

export interface MemorySynthesis {
  retiens: string[]
  hypothesis: string | null
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

export async function synthesizeOrgMemoryAction(
  question: string,
  hits: OrgMemoryHit[],
): Promise<{ ok: true; synthesis: MemorySynthesis; mock: boolean } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return { ok: false, error: 'Accès refusé' }
  }

  const q = (question ?? '').trim().slice(0, 200)
  const corpus = (hits ?? [])
    .slice(0, 18)
    .map((h, i) => `${i + 1}. [${h.type}] ${(h.siteName ? h.siteName + ' · ' : '') + (h.title ? h.title + ' — ' : '') + (h.snippet || '')}`.slice(0, 240))
    .filter((l) => l.length > 6)
  const EMPTY: MemorySynthesis = { retiens: [], hypothesis: null, themes: [] }
  if (corpus.length === 0) return { ok: true, synthesis: EMPTY, mock: false }

  const provider = getAIProvider()
  const systemPrompt = [
    "Tu es le copilote mémoire de l'entreprise. À partir UNIQUEMENT des traces retrouvées pour la question (sur l'ensemble des chantiers), tu produis une SYNTHÈSE utile pour agir. Tu remplis trois champs :",
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
    const synthesis = await withAITracking('org_search_synthesis', user.id, async () => {
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
