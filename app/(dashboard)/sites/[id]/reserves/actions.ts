'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  createSiteReserve,
  liftReserve,
  setReserveBeforePhoto,
} from '@/lib/db/site-reserve'
import { createSiteAction } from '@/lib/db/site-actions'
import { addDocumentLink } from '@/lib/db/documents'

// Server actions — Réserves / levée de réserves (Tier 1 BTP).
//
// Photo : même pattern que uploadSpontaneousTraceAction — File via FormData,
// Buffer.from(arrayBuffer), upload bucket 'intervention-photos'.
//   - constat (avant) : site-reserves/<id>/before-<ts>.<ext>
//   - preuve de levée (après) : site-reserves/<id>/after-<ts>.<ext>
//
// Doctrine : piloté côté superviseur (pas le terrain) → chef_equipe interdit.

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

const createSchema = z.object({
  siteId: z.string().uuid(),
  label: z.string().trim().min(1, 'Libellé requis').max(280),
  location: z.string().trim().max(140).nullable(),
  issuedBy: z.string().trim().max(140).nullable(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide').nullable(),
})

const liftSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  liftNote: z.string().trim().max(280).nullable(),
})

type ActionResult = { ok: true } | { error: string }

/** Extrait une extension de fichier sûre (a-z0-9, max 5 car.), défaut 'jpg'. */
function safeExt(name: string): string {
  const ext = (name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
  return /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
}

/** Upload optionnel d'une photo de réserve, renvoie le storage path ou null. */
async function uploadReservePhoto(
  reserveId: string,
  phase: 'before' | 'after',
  file: File,
): Promise<{ path: string } | { error: string }> {
  if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
  if (!file.type.startsWith('image/')) return { error: 'Format de photo non supporté' }

  const ts = Date.now()
  const path = `site-reserves/${reserveId}/${phase}-${ts}.${safeExt(file.name)}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from('intervention-photos')
    .upload(path, buffer, { contentType: file.type, upsert: false })
  if (error) return { error: `Upload échoué : ${error.message}` }
  return { path }
}

export async function createReserveAction(formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  // Les réserves sont pilotées côté superviseur (réception MOE), pas le terrain.
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  const issuedOnRaw = (formData.get('issuedOn') as string | null) ?? ''
  const parsed = createSchema.safeParse({
    siteId: formData.get('siteId'),
    label: formData.get('label'),
    location: ((formData.get('location') as string | null) ?? '').trim() || null,
    issuedBy: ((formData.get('issuedBy') as string | null) ?? '').trim() || null,
    issuedOn: issuedOnRaw.trim() || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  const { id } = await createSiteReserve({
    siteId: parsed.data.siteId,
    label: parsed.data.label,
    location: parsed.data.location,
    issuedBy: parsed.data.issuedBy,
    issuedOn: parsed.data.issuedOn,
    userId: user.id,
  })

  // Photo de constat (avant) optionnelle.
  const file = formData.get('photoBefore')
  if (file instanceof File && file.size > 0) {
    const up = await uploadReservePhoto(id, 'before', file)
    if ('error' in up) return up
    await setReserveBeforePhoto(id, up.path)
  }

  revalidatePath(`/sites/${parsed.data.siteId}/reserves`)
  return { ok: true }
}

export async function liftReserveAction(formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  const parsed = liftSchema.safeParse({
    id: formData.get('id'),
    siteId: formData.get('siteId'),
    liftNote: ((formData.get('liftNote') as string | null) ?? '').trim() || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  // Photo de preuve de levée (après) optionnelle.
  let photoAfterPath: string | null = null
  const file = formData.get('photoAfter')
  if (file instanceof File && file.size > 0) {
    const up = await uploadReservePhoto(parsed.data.id, 'after', file)
    if ('error' in up) return up
    photoAfterPath = up.path
  }

  await liftReserve({
    id: parsed.data.id,
    liftNote: parsed.data.liftNote,
    photoAfterPath,
    userId: user.id,
  })

  revalidatePath(`/sites/${parsed.data.siteId}/reserves`)
  return { ok: true }
}

// ── Réserve = mini-dossier : actions correctives + documents liés ───────────

const correctiveSchema = z.object({
  siteId: z.string().uuid(),
  reserveId: z.string().uuid(),
  title: z.string().trim().min(1, 'Intitulé requis').max(200),
  assignedTo: z.string().trim().max(120).nullable(),
})

/** Crée une action corrective rattachée à une réserve (site_actions.reserve_id). */
export async function addCorrectiveActionAction(formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  const parsed = correctiveSchema.safeParse({
    siteId: formData.get('siteId'),
    reserveId: formData.get('reserveId'),
    title: formData.get('title'),
    assignedTo: ((formData.get('assignedTo') as string | null) ?? '').trim() || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  await createSiteAction({
    site_id: parsed.data.siteId,
    title: parsed.data.title,
    assigned_to: parsed.data.assignedTo,
    reserve_id: parsed.data.reserveId,
    created_by: user.id,
    created_from: 'reserve',
  })
  revalidatePath(`/sites/${parsed.data.siteId}/reserves`)
  return { ok: true }
}

const linkDocSchema = z.object({
  siteId: z.string().uuid(),
  reserveId: z.string().uuid(),
  documentId: z.string().uuid(),
})

/** Lie un document existant à une réserve (document_links target='reserve'). */
export async function linkDocumentToReserveAction(formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  const parsed = linkDocSchema.safeParse({
    siteId: formData.get('siteId'),
    reserveId: formData.get('reserveId'),
    documentId: formData.get('documentId'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  await addDocumentLink(parsed.data.documentId, 'reserve', parsed.data.reserveId)
  revalidatePath(`/sites/${parsed.data.siteId}/reserves`)
  return { ok: true }
}
