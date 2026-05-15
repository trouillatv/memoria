import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  DbTender,
  DbTenderDocument,
  DbTenderAnalysis,
  TenderStatus,
  TenderOutcome,
  TenderOutcomeTag,
} from '@/types/db'

export interface TenderListQuery {
  status?: TenderStatus
  search?: string
  /** 0-based offset. */
  offset?: number
  /** Max items returned. */
  limit?: number
}

export interface TenderListResult {
  items: DbTender[]
  total: number
}

/**
 * Liste paginée des AO du tenant.
 * Filtres optionnels : status, search (title + client_name).
 * Renvoie items + total pour permettre la pagination côté UI.
 */
export async function listTendersPaged(query: TenderListQuery = {}): Promise<TenderListResult> {
  const supabase = await createServerClient()
  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at, outcome, outcome_at, outcome_reason, outcome_tag, outcome_set_by, voice_note_path, voice_note_duration_seconds, voice_note_recorded_at, voice_note_recorded_by', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error
  return {
    items: (data ?? []) as DbTender[],
    total: count ?? 0,
  }
}

/**
 * Variante legacy non paginée — conservée pour compat. Renvoie l'array brut.
 */
export async function listTenders(query: TenderListQuery = {}): Promise<DbTender[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at, outcome, outcome_at, outcome_reason, outcome_tag, outcome_set_by, voice_note_path, voice_note_duration_seconds, voice_note_recorded_at, voice_note_recorded_by')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.status) q = q.eq('status', query.status)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbTender[]
}

export async function getTender(id: string): Promise<DbTender | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at, outcome, outcome_at, outcome_reason, outcome_tag, outcome_set_by, voice_note_path, voice_note_duration_seconds, voice_note_recorded_at, voice_note_recorded_by')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTender
}

export async function createTender(input: {
  title: string
  client_name?: string | null
  deadline?: string | null
  created_by: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .insert({
      title: input.title,
      client_name: input.client_name ?? null,
      deadline: input.deadline ?? null,
      status: 'draft',
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function updateTenderStatus(
  id: string,
  status: TenderStatus,
  errorMsg?: string | null,
  opportunityScore?: number | null
): Promise<void> {
  const supabase = createAdminClient()
  const fields: Record<string, unknown> = { status }
  if (errorMsg !== undefined) fields.error_msg = errorMsg
  if (opportunityScore !== undefined) fields.opportunity_score = opportunityScore
  const { error } = await supabase.from('tenders').update(fields).eq('id', id)
  if (error) throw error
}

export async function softDeleteTender(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('tenders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function createTenderDocument(input: {
  tender_id: string
  storage_path: string
  filename: string
  size_bytes: number
  page_count?: number | null
  extracted_text?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

export async function getTenderDocument(tenderId: string): Promise<DbTenderDocument | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_documents')
    .select('id, tender_id, storage_path, filename, size_bytes, page_count, extracted_text, uploaded_at')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as DbTenderDocument
}

export async function getLatestTenderAnalysis(tenderId: string): Promise<DbTenderAnalysis | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .select('id, tender_id, provider, model, prompt_versions, summary, constraints, risks, checklist, technical_memo, library_snapshot, raw_response, created_at')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as DbTenderAnalysis
}

export async function insertTenderAnalysis(input: Omit<DbTenderAnalysis, 'id' | 'created_at'>): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tender_analyses')
    .insert(input)
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id
}

// =================================
// Mémoire commerciale — doctrine V5 verrou V1 (mémoire ≠ recommandation)
// =================================

export interface SetTenderOutcomeInput {
  tenderId: string
  outcome: TenderOutcome
  reason?: string // 0..200 chars (trim). Ignoré si outcome === 'pending'.
  tag?: TenderOutcomeTag // Ignoré si outcome === 'pending'.
  /** UUID de l'utilisateur qui pose l'étiquette (manager/admin). */
  userId: string
}

/**
 * Pose le statut sortie d'un AO + raison + tag.
 *
 * Doctrine V5 verrou V1 :
 * - Le système enregistre ce que Guillaume déclare. Il ne calcule rien.
 * - Aucun score. Aucune next_action. Aucune relance.
 *
 * Règles de cohérence :
 * - outcome === 'pending' → reason et tag forcés à NULL (juste "en attente client").
 * - outcome IN (won, lost, withdrawn, not_responded) → reason/tag optionnels.
 * - reason trimmé, max 200 chars (CHECK DB en garde-fou).
 */
export async function setTenderOutcome(input: SetTenderOutcomeInput): Promise<DbTender> {
  const supabase = createAdminClient()

  const trimmedReason = input.reason?.trim() ?? ''
  if (trimmedReason.length > 200) {
    throw new Error('outcome_reason_too_long')
  }

  const isPending = input.outcome === 'pending'
  const reasonToWrite = isPending ? null : (trimmedReason.length > 0 ? trimmedReason : null)
  const tagToWrite = isPending ? null : (input.tag ?? null)

  const { data, error } = await supabase
    .from('tenders')
    .update({
      outcome: input.outcome,
      outcome_at: new Date().toISOString(),
      outcome_reason: reasonToWrite,
      outcome_tag: tagToWrite,
      outcome_set_by: input.userId,
    })
    .eq('id', input.tenderId)
    .select('id, title, client_name, deadline, status, opportunity_score, error_msg, created_by, created_at, deleted_at, outcome, outcome_at, outcome_reason, outcome_tag, outcome_set_by, voice_note_path, voice_note_duration_seconds, voice_note_recorded_at, voice_note_recorded_by')
    .single()

  if (error || !data) throw error ?? new Error('outcome_update_failed')
  return data as DbTender
}

// =================================
// Mémoire commerciale MC-2 — rappel contextuel AO similaires
// Doctrine V5 verrou V1 : retourne des FAITS (AO passés gagnés/perdus),
// aucun score commercial, aucune recommandation. L'UI rend en formulation
// passive descriptive uniquement.
// =================================

export interface SimilarTenderMemory {
  id: string
  title: string
  client_name: string | null
  outcome: TenderOutcome
  outcome_at: string | null
  outcome_reason: string | null
  outcome_tag: TenderOutcomeTag | null
  similarity: number // 0..1
}

/**
 * Trouve les AO passés (won/lost uniquement) dont title ou client_name
 * matchent en trigram le tender courant.
 *
 * Tri : perdus d'abord (urgence mnemonique), puis outcome_at desc.
 * Limit 5 par défaut.
 *
 * Si le tender courant n'a ni title ni client_name → retourne [].
 *
 * Repose sur la RPC `find_similar_tender_memory` (migration 030).
 */
export async function findSimilarTenderMemory(
  currentTenderId: string,
  options?: { threshold?: number; limit?: number }
): Promise<SimilarTenderMemory[]> {
  const threshold = options?.threshold ?? 0.25
  const limit = options?.limit ?? 5

  const supabase = createAdminClient()

  // Récupère title + client_name du tender courant
  const { data: current, error: currentErr } = await supabase
    .from('tenders')
    .select('id, title, client_name')
    .eq('id', currentTenderId)
    .maybeSingle()
  if (currentErr || !current) return []

  const title = (current.title ?? '').trim()
  const clientName = (current.client_name ?? '').trim()
  if (title.length === 0 && clientName.length === 0) return []

  const { data, error } = await supabase.rpc('find_similar_tender_memory', {
    p_current_tender_id: currentTenderId,
    p_title: title,
    p_client_name: clientName,
    p_threshold: threshold,
    p_limit: limit,
  })
  if (error) throw error
  if (!data) return []

  return (data as SimilarTenderMemory[]).map((row) => ({
    id: row.id,
    title: row.title,
    client_name: row.client_name,
    outcome: row.outcome,
    outcome_at: row.outcome_at,
    outcome_reason: row.outcome_reason,
    outcome_tag: row.outcome_tag,
    similarity: row.similarity,
  }))
}

// =================================
// Mémoire commerciale MC-3 — page journal des AO finalisés
// Doctrine V5 verrou V1 : la mémoire rappelle, ne recommande pas.
// Helper de liste pure — pas d'agrégat, pas de stat, pas de tendance.
// =================================

export interface TenderMemoryEntry {
  id: string
  title: string
  client_name: string | null
  status: TenderStatus
  outcome: TenderOutcome
  outcome_at: string
  outcome_reason: string | null
  outcome_tag: TenderOutcomeTag | null
  created_at: string
  // MC-4 — signal sobre dans la liste mémoire (badge "Note vocale · 1min24").
  voice_note_path: string | null
  voice_note_duration_seconds: number | null
}

export interface TenderMemoryFilters {
  /** Restreint aux AO d'un outcome précis (won/lost/withdrawn/not_responded). */
  outcome?: TenderOutcome
  /** Restreint aux AO portant ce tag de raison. */
  tag?: TenderOutcomeTag
  /** Recherche ilike sur title ou client_name. */
  search?: string
  /** 0-based offset. */
  offset?: number
  /** Max items returned (default 30). */
  limit?: number
}

export interface TenderMemoryResult {
  items: TenderMemoryEntry[]
  total: number
}

/**
 * Liste paginée des AO finalisés (outcome NOT NULL, hors 'pending'),
 * triés par outcome_at DESC. C'est le moteur de la page /tenders/memoire :
 * un journal chronologique calme, descriptif.
 *
 * Doctrine V5 verrou V1 + V4 : aucune métrique calculée. Le helper
 * retourne des faits bruts. L'UI rend en formulation passive uniquement.
 *
 * Filtres optionnels : outcome, tag, search (title + client_name).
 */
export async function listTenderMemory(
  filters: TenderMemoryFilters = {},
): Promise<TenderMemoryResult> {
  // Admin client : permet le test direct hors request scope, et match le
  // pattern de findSimilarTenderMemory. La sécurité de page est portée par
  // la vérification de rôle dans le Server Component (admin/manager only).
  const supabase = createAdminClient()

  let q = supabase
    .from('tenders')
    .select(
      'id, title, client_name, status, outcome, outcome_at, outcome_reason, outcome_tag, created_at, voice_note_path, voice_note_duration_seconds',
      { count: 'exact' },
    )
    .is('deleted_at', null)
    .not('outcome', 'is', null)
    .neq('outcome', 'pending')
    .order('outcome_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (filters.outcome) q = q.eq('outcome', filters.outcome)
  if (filters.tag) q = q.eq('outcome_tag', filters.tag)
  if (filters.search) {
    const s = filters.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,client_name.ilike.%${s}%`)
  }

  const offset = Math.max(0, filters.offset ?? 0)
  const limit = Math.max(1, filters.limit ?? 30)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error
  return {
    items: (data ?? []) as TenderMemoryEntry[],
    total: count ?? 0,
  }
}

// =================================
// Mémoire commerciale MC-4 — voice note DG sur AO finalisé
// Doctrine V5 cas validé : déchargement + mémoire incarnée.
// Archive personnelle, pas une conversation. Lecture privée admin/manager.
// =================================

const VOICE_NOTE_BUCKET = 'tender-voice-notes'

export interface SaveVoiceNoteInput {
  tenderId: string
  audioBlob: Blob
  durationSeconds: number
  recordedBy: string
  /** Extension (sans point). Default 'webm'. */
  extension?: string
  /** Content type explicite. Default 'audio/webm'. */
  contentType?: string
}

/**
 * Sauvegarde une voice note sur le tender finalisé.
 *
 * Comportement :
 * - Upload du Blob dans bucket Supabase Storage `tender-voice-notes`
 *   à `{tenderId}/{timestamp}.{ext}`.
 * - Si une voice note existe déjà → supprime l'ancien fichier avant.
 * - UPDATE tenders SET voice_note_path, voice_note_duration_seconds,
 *   voice_note_recorded_at=now(), voice_note_recorded_by.
 *
 * Caller responsabilité : vérifier que tender.outcome IS NOT NULL avant
 * d'appeler (logique métier dans server action / page).
 */
export async function saveTenderVoiceNote(
  input: SaveVoiceNoteInput,
): Promise<{ path: string }> {
  const duration = Math.round(input.durationSeconds)
  if (!Number.isFinite(duration) || duration < 1 || duration > 180) {
    throw new Error('voice_note_duration_out_of_range')
  }

  const supabase = createAdminClient()

  // Récupère ancienne voice note pour suppression idempotente.
  const { data: existing } = await supabase
    .from('tenders')
    .select('voice_note_path')
    .eq('id', input.tenderId)
    .maybeSingle()

  const ext = (input.extension ?? 'webm').replace(/^\./, '')
  const contentType = input.contentType ?? 'audio/webm'
  const timestamp = Date.now()
  const path = `${input.tenderId}/${timestamp}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from(VOICE_NOTE_BUCKET)
    .upload(path, input.audioBlob, {
      contentType,
      upsert: false,
    })
  if (uploadErr) throw uploadErr

  const { error: updateErr } = await supabase
    .from('tenders')
    .update({
      voice_note_path: path,
      voice_note_duration_seconds: duration,
      voice_note_recorded_at: new Date().toISOString(),
      voice_note_recorded_by: input.recordedBy,
    })
    .eq('id', input.tenderId)
  if (updateErr) {
    // Rollback du fichier uploadé pour rester cohérent.
    await supabase.storage.from(VOICE_NOTE_BUCKET).remove([path]).catch(() => {})
    throw updateErr
  }

  // Best-effort : supprime l'ancien fichier après le UPDATE réussi.
  if (existing?.voice_note_path && existing.voice_note_path !== path) {
    await supabase.storage
      .from(VOICE_NOTE_BUCKET)
      .remove([existing.voice_note_path])
      .catch(() => {})
  }

  return { path }
}

/**
 * Supprime la voice note du tender (storage + colonnes DB).
 * Idempotent : si pas de voice note, no-op.
 */
export async function deleteTenderVoiceNote(tenderId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('tenders')
    .select('voice_note_path')
    .eq('id', tenderId)
    .maybeSingle()

  if (!existing?.voice_note_path) return

  await supabase.storage
    .from(VOICE_NOTE_BUCKET)
    .remove([existing.voice_note_path])
    .catch(() => {})

  const { error } = await supabase
    .from('tenders')
    .update({
      voice_note_path: null,
      voice_note_duration_seconds: null,
      voice_note_recorded_at: null,
      voice_note_recorded_by: null,
    })
    .eq('id', tenderId)
  if (error) throw error
}

/**
 * Génère un signed URL (TTL 1h) pour la voice note du tender.
 * Renvoie null si pas de voice note.
 */
export async function getSignedVoiceNoteUrl(
  tenderId: string,
): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tenders')
    .select('voice_note_path')
    .eq('id', tenderId)
    .maybeSingle()
  if (error || !data?.voice_note_path) return null

  const { data: signed } = await supabase.storage
    .from(VOICE_NOTE_BUCKET)
    .createSignedUrl(data.voice_note_path, 3600)
  return signed?.signedUrl ?? null
}

export async function countAnalysesToday(): Promise<number> {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('feature', 'lecteur_ao')
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}
