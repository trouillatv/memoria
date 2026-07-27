import { createAdminClient } from '@/lib/supabase/admin'

// ── LA PHOTO PRINCIPALE D'UN CHANTIER (mig 243) ──────────────────────────────
// Résout sites.cover_capture_id en une URL signée affichable. Résilient : si la
// capture a été écartée, archivée ou a perdu sa pièce, on rend `null` — le
// chantier retombe simplement sans couverture (pas d'image cassée).

export interface SiteCoverPhoto {
  captureId: string
  url: string
  mime: string | null
}

/** L'id de la capture choisie comme couverture (sans résoudre l'URL) — pour
 *  marquer la photo active dans une liste de choix. */
export async function getSiteCoverCaptureId(siteId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('cover_capture_id').eq('id', siteId).maybeSingle()
  return (data as { cover_capture_id: string | null } | null)?.cover_capture_id ?? null
}

/** La photo principale prête à l'affichage, ou null si aucune / plus valable. */
export async function getSiteCoverPhoto(siteId: string): Promise<SiteCoverPhoto | null> {
  const supabase = createAdminClient()
  const captureId = await getSiteCoverCaptureId(siteId)
  if (!captureId) return null

  const { data: capRow } = await supabase
    .from('visit_capture')
    .select('id, attachment_id, kind, status, hidden_at')
    .eq('id', captureId)
    .maybeSingle()
  const capture = capRow as { id: string; attachment_id: string | null; kind: string; status: string; hidden_at: string | null } | null
  if (!capture || !capture.attachment_id || capture.status === 'discarded' || capture.hidden_at) return null

  const { data: attRow } = await supabase
    .from('site_report_attachments')
    .select('storage_path, mime_type')
    .eq('id', capture.attachment_id)
    .maybeSingle()
  const attachment = attRow as { storage_path: string | null; mime_type: string | null } | null
  if (!attachment?.storage_path) return null

  const { data: signed } = await supabase.storage.from('site-reports').createSignedUrl(attachment.storage_path, 3600)
  if (!signed?.signedUrl) return null
  return { captureId: capture.id, url: signed.signedUrl, mime: attachment.mime_type }
}

/**
 * Choisit (ou retire, captureId=null) la photo principale d'un chantier. Vérifie
 * que la capture appartient bien au chantier et qu'elle est une photo affichable
 * — on ne fait pas d'une pièce d'un autre site la couverture de celui-ci.
 */
export async function setSiteCover(siteId: string, captureId: string | null): Promise<void> {
  const supabase = createAdminClient()
  if (captureId) {
    const { data: capRow } = await supabase
      .from('visit_capture')
      .select('id, site_id, kind, status')
      .eq('id', captureId)
      .maybeSingle()
    const capture = capRow as { id: string; site_id: string; kind: string; status: string } | null
    if (!capture || capture.site_id !== siteId || capture.kind !== 'photo' || capture.status === 'discarded') {
      throw new Error('Capture invalide pour ce chantier')
    }
  }
  const { error } = await supabase.from('sites').update({ cover_capture_id: captureId }).eq('id', siteId)
  if (error) throw error
}
