// Présentation des photos dans un CR (mig 129) : ordre, photo de couverture,
// commentaire général. Métadonnées propres au CR (on ne touche pas les photos).
import { createAdminClient } from '@/lib/supabase/admin'

export interface PhotoMeta {
  sortOrder: number
  isCover: boolean
}

/** Ordre + couverture par photo, pour ce CR (clé = photoId). */
export async function listReportPhotoMeta(reportId: string): Promise<Map<string, PhotoMeta>> {
  const { data } = await createAdminClient()
    .from('report_photo_meta')
    .select('photo_id, sort_order, is_cover')
    .eq('report_id', reportId)
  const map = new Map<string, PhotoMeta>()
  for (const r of data ?? []) map.set(r.photo_id as string, { sortOrder: r.sort_order as number, isCover: r.is_cover as boolean })
  return map
}

/** Réordonne : sort_order = index dans la liste fournie (préserve la couverture). */
export async function reorderReportPhotos(
  reportId: string,
  ordered: { id: string; source: 'intervention' | 'action' }[],
): Promise<void> {
  if (ordered.length === 0) return
  const sb = createAdminClient()
  const existing = await listReportPhotoMeta(reportId)
  const rows = ordered.map((p, i) => ({
    report_id: reportId,
    photo_id: p.id,
    source: p.source,
    sort_order: i,
    is_cover: existing.get(p.id)?.isCover ?? false,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await sb.from('report_photo_meta').upsert(rows, { onConflict: 'report_id,photo_id' })
  if (error) throw new Error(error.message)
}

/** Définit la photo de couverture (1 seule par CR : on remet les autres à false). */
export async function setReportCoverPhoto(
  reportId: string,
  photoId: string,
  source: 'intervention' | 'action',
  cover: boolean,
): Promise<void> {
  const sb = createAdminClient()
  if (cover) {
    await sb.from('report_photo_meta').update({ is_cover: false }).eq('report_id', reportId)
  }
  const existing = await listReportPhotoMeta(reportId)
  const { error } = await sb.from('report_photo_meta').upsert(
    {
      report_id: reportId,
      photo_id: photoId,
      source,
      sort_order: existing.get(photoId)?.sortOrder ?? 0,
      is_cover: cover,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'report_id,photo_id' },
  )
  if (error) throw new Error(error.message)
}

export async function getCrPhotosComment(reportId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('report_cr_meta')
    .select('photos_comment')
    .eq('report_id', reportId)
    .maybeSingle()
  return (data as { photos_comment: string | null } | null)?.photos_comment ?? null
}

export async function setCrPhotosComment(reportId: string, comment: string | null, userId: string | null): Promise<void> {
  const { error } = await createAdminClient()
    .from('report_cr_meta')
    .upsert(
      { report_id: reportId, photos_comment: comment, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'report_id' },
    )
  if (error) throw new Error(error.message)
}
