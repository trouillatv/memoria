'use server'

// Gestes DESKTOP sur les photos d'une visite — légende + original d'une annotée.
//
// Le modèle est celui du mobile (visit_capture, mig 165/185) : aucune deuxième
// logique photo. Ici on n'ajoute que deux lectures/écritures que le mobile n'a
// pas exposées :
//   · éditer la LÉGENDE hors triage (le mobile ne l'édite qu'au tri voiture —
//     setCaptureTriage est fait pour poser un tag, on ne le détourne pas) ;
//   · retrouver l'ORIGINAL d'une version annotée (archivé via hidden_at, donc
//     absent des listes — mais « archivé et consultable », mig 185).
//
// Garde : mêmes rôles que le terrain (requireFieldAgent accepte admin/manager)
// + appartenance à l'organisation de la capture (le service-role bypasse la
// RLS, le filtre vit ICI).

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { createAdminClient } from '@/lib/supabase/admin'

/** Charge une capture de CETTE visite et vérifie le tenant. `null` = refus. */
async function guardedCapture(captureId: string, reportId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('visit_capture')
    .select('id, kind, organization_id, annotated_original_id')
    .eq('id', captureId)
    .eq('report_id', reportId)
    .maybeSingle()
  if (!data) return null
  const membership = await requireOrganizationMembership((data as { organization_id: string }).organization_id)
  if (!membership.ok) return null
  return data as { id: string; kind: string; organization_id: string; annotated_original_id: string | null }
}

const captionSchema = z.object({
  report_id: z.string().uuid(),
  capture_id: z.string().uuid(),
  // Même plafond que le commentaire du triage mobile (500) — une légende, pas un CR.
  caption: z.string().max(500),
})

export async function updateVisitPhotoCaptionAction(
  input: z.input<typeof captionSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = captionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const capture = await guardedCapture(parsed.data.capture_id, parsed.data.report_id)
  if (!capture) return { ok: false, error: 'Photo introuvable' }
  // La légende n'a de sens que sur un média — jamais sur un vocal (body =
  // transcription, l'écraser détruirait une preuve) ni une note.
  if (capture.kind !== 'photo' && capture.kind !== 'video') {
    return { ok: false, error: 'Cette capture ne porte pas de légende' }
  }

  const { error } = await createAdminClient()
    .from('visit_capture')
    .update({ body: parsed.data.caption.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.capture_id)
    .eq('report_id', parsed.data.report_id)
  if (error) return { ok: false, error: 'Enregistrement de la légende échoué' }
  return { ok: true }
}

const originalSchema = z.object({
  report_id: z.string().uuid(),
  capture_id: z.string().uuid(),
})

/** L'original d'une version annotée — même s'il est archivé (hidden_at). Lecture
 *  seule : on montre la preuve, on ne la réactive pas. */
export async function getAnnotatedOriginalAction(
  input: z.input<typeof originalSchema>,
): Promise<{ ok: true; url: string; caption: string | null } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = originalSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const annotated = await guardedCapture(parsed.data.capture_id, parsed.data.report_id)
  if (!annotated) return { ok: false, error: 'Photo introuvable' }
  if (!annotated.annotated_original_id) return { ok: false, error: 'Cette photo n’a pas d’original distinct' }

  const db = createAdminClient()
  const { data: original } = await db
    .from('visit_capture')
    .select('id, body, attachment_id')
    .eq('id', annotated.annotated_original_id)
    .eq('report_id', parsed.data.report_id)
    .maybeSingle()
  const att = (original as { attachment_id: string | null } | null)?.attachment_id
  if (!original || !att) return { ok: false, error: 'Original introuvable' }

  const { data: attachment } = await db
    .from('site_report_attachments')
    .select('storage_path')
    .eq('id', att)
    .eq('report_id', parsed.data.report_id)
    .maybeSingle()
  const path = (attachment as { storage_path: string | null } | null)?.storage_path
  if (!path) return { ok: false, error: 'Original introuvable' }

  const { data: signed } = await db.storage.from('site-reports').createSignedUrl(path, 3600)
  if (!signed?.signedUrl) return { ok: false, error: 'Chargement de l’original échoué' }
  return { ok: true, url: signed.signedUrl, caption: (original as { body: string | null }).body }
}
