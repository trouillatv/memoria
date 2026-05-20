import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { findSimilarTraces } from '@/lib/ai/embed-trace'
import {
  B2_ALGO,
  B2_COSINE_THRESHOLD,
  B2_DOC_TYPES_ALLOWED,
  B2_EXPIRE_DAYS,
  B2_MAX_PER_SITE,
  B2_TOP_K_PER_CHUNK,
  B2_VISIBILITY_ALLOWED,
  buildB2Fragment,
  chunkSignalsAction,
  traceSignalsActionable,
} from './cross-store-matchers'

// =============================================================================
// B2 — pont cross-store documents ↔ traces site (approche β, ratifiée
// Vincent 2026-05-20, Q1 renforcée).
// =============================================================================
//
// Spec :   docs/superpowers/notes/2026-05-20-b2-etude-cross-store-bridge.md
// Matchers : ./cross-store-matchers.ts (purs, testables).
//
// Filtres en AND non négociables :
//   1. document_type ∈ {plan_acces, securite, procedure, protocole}
//      (juridique exclu d'office — [[litige-no-automatic-reading]])
//   2. visibility_level ∈ {operations, field}
//      (défense en profondeur — invariant sécurité §1.7 du protocole
//       d'observation B1, conservé DUR)
//   3. document_links target_type='site' (filtrage AMONT, bornage)
//   4. chunkSignalsAction(chunk_text) = true (action/procédure citée)
//   5. cosine(chunk, trace) ≥ 0.80 via find_similar_traces (site-scoped)
//   6. traceSignalsActionable(kind, text) = true (action appelée)
//   7. tenant match (defensive cross-tenant)
//
// Sortie : upsert dans site_reading_candidates (reading_type='resonance',
// algorithm_version='b2_doc_trace_v1'), ≤2 actives par site, expire 30j,
// source_ids = [{type:'document',id:docId},{type:'trace',id:traceId}].
//
// Coût borné : N_chunks × 1 RPC pgvector indexed × M_sites. Aucun appel
// LLM, aucun nouvel embedding, aucun scan tenant-wide.
//
// Mock-safe : pas d'appel IA, déterministe. Idempotent (stale anciennes
// B2 actives avec même doc en source[0] avant insert).

// -----------------------------------------------------------------------------
// Types internes (privés, pas exportés — server-only)
// -----------------------------------------------------------------------------

interface DocRow {
  id: string
  tenant_id: string | null
  document_type: string
  visibility_level: string
  deleted_at: string | null
  analysis_status: string
}

interface ChunkRow {
  id: string
  chunk_text: string
  embedding: unknown // string "[0.1,0.2,...]" ou number[]
}

interface TraceCtx {
  created_at: string
  kind?: string
}

type Admin = ReturnType<typeof createAdminClient>

// -----------------------------------------------------------------------------
// Entrée publique — fire-and-forget après analyzeDocument 'ready'.
// -----------------------------------------------------------------------------

/**
 * Calcule les résonances B2 (cross-store) pour TOUS les sites liés à
 * un document. Silencieux et tolérant : un raté de résonance ne doit
 * jamais annuler une analyse réussie.
 */
export async function computeDocCrossStoreResonancesForDocument(
  documentId: string,
): Promise<void> {
  try {
    const supabase = createAdminClient()

    const { data: doc } = await supabase
      .from('documents')
      .select('id, tenant_id, document_type, visibility_level, deleted_at, analysis_status')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc) return
    const d = doc as DocRow
    if (d.deleted_at || d.analysis_status !== 'ready') return

    // Filtre #1 — type ∈ {plan_acces, securite, procedure, protocole}
    if (!(B2_DOC_TYPES_ALLOWED as readonly string[]).includes(d.document_type)) return

    // Filtre #2 — visibility ∈ {operations, field} (défense en profondeur)
    if (!(B2_VISIBILITY_ALLOWED as readonly string[]).includes(d.visibility_level)) return

    // Filtre #3 — sites liés via document_links target_type='site'
    const { data: links } = await supabase
      .from('document_links')
      .select('target_id')
      .eq('document_id', documentId)
      .eq('target_type', 'site')
    const siteIds = (links ?? []).map((l) => (l as { target_id: string }).target_id)
    if (siteIds.length === 0) return

    // Chunks doc avec embeddings non null (filtrage AMONT par source_domain
    // ET source_id — pas de scan tenant-wide).
    const { data: chunksRaw } = await supabase
      .from('knowledge_chunks')
      .select('id, chunk_text, embedding')
      .eq('source_domain', 'document')
      .eq('source_id', documentId)
      .not('embedding', 'is', null)
    const chunks = (chunksRaw ?? []) as ChunkRow[]
    if (chunks.length === 0) return

    // Filtre #4 — chunks qui signalent une action (Q1 renforcée)
    const actionable = chunks.filter((c) => chunkSignalsAction(c.chunk_text))
    if (actionable.length === 0) return

    for (const siteId of siteIds) {
      await computeForOneSite(supabase, siteId, d, actionable).catch(() => {})
    }
  } catch {
    // Silencieux : la résonance est un bonus, jamais bloquant.
  }
}

// -----------------------------------------------------------------------------
// Calcul pour un site donné
// -----------------------------------------------------------------------------

async function computeForOneSite(
  supabase: Admin,
  siteId: string,
  doc: DocRow,
  actionableChunks: ChunkRow[],
): Promise<void> {
  // tenant_id du site (defensive cross-tenant)
  const { data: siteRow } = await supabase
    .from('sites')
    .select('tenant_id')
    .eq('id', siteId)
    .maybeSingle()
  const tenantId = (siteRow as { tenant_id?: string } | null)?.tenant_id ?? null
  if (!tenantId) return

  // Si le doc a un tenant_id et qu'il ne matche pas le site → refuser
  // (anti-fuite cross-tenant, défense en profondeur).
  if (doc.tenant_id && doc.tenant_id !== tenantId) return

  const expiresAt = new Date(Date.now() + B2_EXPIRE_DAYS * 86_400_000).toISOString()

  // Pour chaque chunk action, top-K traces ≥ seuil, filtrées actionnables.
  // On garde le MEILLEUR cosine par traceId (un trace peut matcher plusieurs
  // chunks — on évite les doublons).
  type Candidate = {
    traceId: string
    traceKind: string
    traceDateIso: string
    similarity: number
  }
  const bestByTrace = new Map<string, Candidate>()

  for (const chunk of actionableChunks) {
    const queryEmbedding = parseEmbedding(chunk.embedding)
    if (!queryEmbedding || queryEmbedding.length === 0) continue

    const matches = await findSimilarTraces({
      siteId,
      queryEmbedding,
      limit: B2_TOP_K_PER_CHUNK,
    }).catch(() => [] as Awaited<ReturnType<typeof findSimilarTraces>>)

    for (const m of matches) {
      // Filtre #5 — cosine ≥ B2_COSINE_THRESHOLD
      if (m.similarity < B2_COSINE_THRESHOLD) continue

      const ctx = await fetchTraceContext(supabase, m.source_type, m.source_id)
      if (!ctx) continue

      const traceKind = mapToB2TraceKind(m.source_type, ctx.kind ?? null)
      // Filtre #6 — trace actionnable (kind ou keyword)
      if (!traceSignalsActionable(traceKind, m.text_excerpt ?? null)) continue

      const prev = bestByTrace.get(m.source_id)
      if (!prev || m.similarity > prev.similarity) {
        bestByTrace.set(m.source_id, {
          traceId: m.source_id,
          traceKind,
          traceDateIso: ctx.created_at,
          similarity: m.similarity,
        })
      }
    }
  }

  if (bestByTrace.size === 0) return

  // Idempotence : stale toutes les B2 actives pour ce site avec doc.id
  // en source[0]. Pas de doublons sur ré-analyse.
  const { data: existing } = await supabase
    .from('site_reading_candidates')
    .select('id, source_ids')
    .eq('site_id', siteId)
    .eq('algorithm_version', B2_ALGO)
    .eq('status', 'active')
  const toStale = (existing ?? [])
    .filter((r) => {
      const src = (r as { source_ids: Array<{ type: string; id: string }> }).source_ids ?? []
      return src.length > 0 && src[0]?.id === doc.id
    })
    .map((r) => (r as { id: string }).id)
  if (toStale.length > 0) {
    await supabase.from('site_reading_candidates').update({ status: 'stale' }).in('id', toStale)
  }

  // Insert nouveaux candidats
  for (const c of bestByTrace.values()) {
    const fragment = buildB2Fragment({
      docId: doc.id,
      docType: doc.document_type,
      traceId: c.traceId,
      traceKind: c.traceKind,
      traceDateIso: c.traceDateIso,
    })
    await supabase.from('site_reading_candidates').insert({
      tenant_id: tenantId,
      site_id: siteId,
      reading_type: 'resonance',
      fragment,
      source_ids: [
        { type: 'document', id: doc.id },
        { type: 'trace', id: c.traceId },
      ],
      algorithm_version: B2_ALGO,
      expires_at: expiresAt,
      status: 'active',
    })
  }

  // Plafond ≤ B2_MAX_PER_SITE des B2 actives sur ce site.
  // Garde les plus récentes ; les autres → 'stale'.
  const { data: all } = await supabase
    .from('site_reading_candidates')
    .select('id, generated_at')
    .eq('site_id', siteId)
    .like('algorithm_version', 'b2_doc_trace_%')
    .eq('status', 'active')
    .order('generated_at', { ascending: false })
  if (all && all.length > B2_MAX_PER_SITE) {
    const overflow = all.slice(B2_MAX_PER_SITE).map((r) => (r as { id: string }).id)
    await supabase.from('site_reading_candidates').update({ status: 'stale' }).in('id', overflow)
  }
}

// -----------------------------------------------------------------------------
// Helpers internes
// -----------------------------------------------------------------------------

/** Parse un pgvector reçu de Supabase JS : soit un tableau number[],
 *  soit la string "[0.1,0.2,...]". Retourne null si parsing échoue. */
function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw.every((x) => typeof x === 'number') ? (raw as number[]) : null
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) {
        return parsed as number[]
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Récupère la date (et éventuel kind) d'une trace référencée par
 *  trace_embeddings.source_type + source_id. */
async function fetchTraceContext(
  supabase: Admin,
  source_type: string,
  source_id: string,
): Promise<TraceCtx | null> {
  switch (source_type) {
    case 'site_note': {
      const { data } = await supabase
        .from('site_notes')
        .select('created_at, kind, deleted_at')
        .eq('id', source_id)
        .maybeSingle()
      if (!data) return null
      const r = data as { created_at: string; kind: string; deleted_at: string | null }
      if (r.deleted_at) return null
      return { created_at: r.created_at, kind: r.kind }
    }
    case 'anomaly': {
      const { data } = await supabase
        .from('intervention_anomalies')
        .select('created_at')
        .eq('id', source_id)
        .maybeSingle()
      if (!data) return null
      return { created_at: (data as { created_at: string }).created_at }
    }
    case 'intervention_note':
    case 'photo_caption': {
      // Fallback déterministe : created_at de la ligne trace_embeddings
      // (l'embedding est calculé à la création de la trace, donc cohérent).
      const { data } = await supabase
        .from('trace_embeddings')
        .select('created_at')
        .eq('source_type', source_type)
        .eq('source_id', source_id)
        .maybeSingle()
      if (!data) return null
      return { created_at: (data as { created_at: string }).created_at }
    }
    default:
      return null
  }
}

/** Mappe le source_type trace_embeddings vers le kind interne B2 (cf.
 *  traceSignalsActionable). Pour 'site_note', distingue 'a_savoir'. */
function mapToB2TraceKind(source_type: string, kindFromSource: string | null): string {
  if (source_type === 'site_note') {
    return kindFromSource === 'a_savoir' ? 'site_note_a_savoir' : 'site_note'
  }
  if (source_type === 'anomaly') return 'anomaly'
  if (source_type === 'intervention_note') return 'intervention'
  if (source_type === 'photo_caption') return 'observation'
  return 'unknown'
}
