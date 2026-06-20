// Photos AJOUTÉES directement au CR (mig 133) — pas un artefact terrain mais un
// ajout éditorial choisi par Émeline. Source 'report' dans le modèle SitePhoto :
// vraie suppression autorisée (≠ exclure réversible des photos intervention/action).
import { createAdminClient } from '@/lib/supabase/admin'
import type { SitePhoto } from './site-photos'

/** Photos report (ajouts directs) d'une réunion, plus récentes d'abord. */
export async function listReportPhotos(reportId: string): Promise<SitePhoto[]> {
  const { data } = await createAdminClient()
    .from('report_photos')
    .select('id, storage_path, caption, taken_at, created_by, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: false })
  return (data ?? []).map((p) => ({
    id: p.id as string,
    storagePath: p.storage_path as string,
    legende: ((p.caption as string | null) ?? '').trim(),
    takenAt: (p.taken_at as string | null) ?? (p.created_at as string | null) ?? null,
    authorId: (p.created_by as string | null) ?? null,
    interventionId: null,
    anomalyId: null,
    actionId: null,
    source: 'report',
  }))
}

/** Insère une photo report (après upload storage). Renvoie l'id créé. */
export async function addReportPhoto(input: {
  reportId: string
  storagePath: string
  caption?: string | null
  createdBy?: string | null
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('report_photos')
    .insert({
      report_id: input.reportId,
      storage_path: input.storagePath,
      caption: input.caption?.trim() || null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

/** Supprime une photo report (ligne) et renvoie son storage_path pour purger le bucket.
 *  Scopé au report (garde-fou : on ne supprime que SES propres ajouts). */
export async function deleteReportPhoto(reportId: string, photoId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('report_photos')
    .select('storage_path')
    .eq('id', photoId)
    .eq('report_id', reportId)
    .maybeSingle()
  if (!data) return null
  const { error } = await sb.from('report_photos').delete().eq('id', photoId).eq('report_id', reportId)
  if (error) throw new Error(error.message)
  return (data.storage_path as string) ?? null
}
