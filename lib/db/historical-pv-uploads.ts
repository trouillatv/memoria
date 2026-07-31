// Couche DB — Tracking des uploads PV historiques (mig 270)
//
// Doctrine :
//   Cet adaptateur garantit l'idempotence et la traçabilité de l'upload en deux temps :
//   1. requestUpload → génère l'URL signée, crée la ligne 'pending'
//   2. confirmUpload → vérifie Storage, crée le document, passe 'confirmed'
//
// En cas d'échec réseau après l'upload Storage mais avant confirmation, l'utilisateur
// peut relancer uniquement la confirmation sans renvoyer le PDF.

import { createAdminClient } from '@/lib/supabase/admin'

export type HistoricalPvUploadStatus = 'pending' | 'uploaded' | 'confirmed' | 'failed'

export interface HistoricalPvUpload {
  id: string
  siteId: string
  userId: string
  storagePath: string
  originalFilename: string
  fileSize: number
  fileHashSha256: string | null
  effectiveDate: string | null
  status: HistoricalPvUploadStatus
  documentId: string | null
  errorMessage: string | null
  createdAt: string
  uploadedAt: string | null
  confirmedAt: string | null
}

type RawRow = {
  id: string
  site_id: string
  user_id: string
  storage_path: string
  original_filename: string
  file_size: number
  file_hash_sha256: string | null
  effective_date: string | null
  status: string
  document_id: string | null
  error_message: string | null
  created_at: string
  uploaded_at: string | null
  confirmed_at: string | null
}

function mapRow(r: RawRow): HistoricalPvUpload {
  return {
    id: r.id,
    siteId: r.site_id,
    userId: r.user_id,
    storagePath: r.storage_path,
    originalFilename: r.original_filename,
    fileSize: r.file_size,
    fileHashSha256: r.file_hash_sha256,
    effectiveDate: r.effective_date,
    status: r.status as HistoricalPvUploadStatus,
    documentId: r.document_id,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    uploadedAt: r.uploaded_at,
    confirmedAt: r.confirmed_at,
  }
}

/**
 * Crée un enregistrement d'upload en attente et retourne l'ID stable.
 */
export async function createPendingUpload(input: {
  siteId: string
  userId: string
  storagePath: string
  originalFilename: string
  fileSize: number
  fileHashSha256?: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('historical_pv_uploads')
    .insert({
      site_id: input.siteId,
      user_id: input.userId,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      file_size: input.fileSize,
      file_hash_sha256: input.fileHashSha256 ?? null,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

/**
 * Marque un upload comme 'uploaded' (fichier présent dans Storage).
 */
export async function markUploadAsUploaded(uploadId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('historical_pv_uploads')
    .update({ status: 'uploaded', uploaded_at: new Date().toISOString() })
    .eq('id', uploadId)
    .eq('status', 'pending')  // Idempotence : ne passe que si encore 'pending'
  if (error) throw new Error(error.message)
}

/**
 * Marque un upload comme 'confirmed' avec le document créé.
 * Retourne `true` si la transition a réussi (atomique), `false` si déjà confirmé.
 */
export async function markUploadAsConfirmed(
  uploadId: string,
  documentId: string,
  effectiveDate?: string,
): Promise<boolean> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {
    status: 'confirmed',
    document_id: documentId,
    confirmed_at: new Date().toISOString(),
  }
  if (effectiveDate) update.effective_date = effectiveDate

  // Transition conditionnelle atomique : UPDATE ... WHERE status IN (...) RETURNING *
  // Une seule requête concurrente obtiendra une ligne, les autres 0 ligne.
  const { data, error } = await supabase
    .from('historical_pv_uploads')
    .update(update)
    .eq('id', uploadId)
    .in('status', ['pending', 'uploaded'])  // Accepte les deux états (retry)
    .select('id')

  if (error) throw new Error(error.message)

  // Si data est vide → upload déjà confirmé par une requête concurrente
  return (data && data.length > 0)
}

/**
 * Marque un upload comme 'failed' avec le message d'erreur.
 */
export async function markUploadAsFailed(uploadId: string, errorMessage: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('historical_pv_uploads')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', uploadId)
  if (error) throw new Error(error.message)
}

/**
 * Retourne un upload par son storagePath (idempotence : éviter les doublons).
 */
export async function getUploadByStoragePath(
  storagePath: string,
): Promise<HistoricalPvUpload | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('historical_pv_uploads')
    .select('*')
    .eq('storage_path', storagePath)
    .single()
  if (error && error.code !== 'PGRST116') throw new Error(error.message)  // PGRST116 = not found
  return data ? mapRow(data as RawRow) : null
}

/**
 * Retourne un upload par son ID.
 */
export async function getUploadById(uploadId: string): Promise<HistoricalPvUpload | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('historical_pv_uploads')
    .select('*')
    .eq('id', uploadId)
    .single()
  if (error && error.code !== 'PGRST116') throw new Error(error.message)
  return data ? mapRow(data as RawRow) : null
}

/**
 * Liste les uploads orphelins (status='pending', created_at > 24h) pour nettoyage.
 */
export async function listOrphanedUploads(olderThanHours = 24): Promise<HistoricalPvUpload[]> {
  const supabase = createAdminClient()
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - olderThanHours)
  const { data, error } = await supabase
    .from('historical_pv_uploads')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff.toISOString())
  if (error) throw new Error(error.message)
  return ((data ?? []) as RawRow[]).map(mapRow)
}
