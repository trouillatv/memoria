'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import {
  markChecklistItemDone,
  insertPhoto,
  updateInterventionStatus,
  getIntervention,
  listChecklistItemsByIntervention,
  createAnomaly,
  createValidation,
  getValidationByIntervention,
} from '@/lib/db/interventions'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const idSchema = z.object({ id: z.string().uuid() })

export async function startInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'planned') {
    return { error: `Statut courant: ${intervention.status}. Démarrer impossible.` }
  }

  await updateInterventionStatus(parsed.data.id, 'in_progress')
  revalidatePath(`/interventions/${parsed.data.id}`)
  return { ok: true as const }
}

export async function completeInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'in_progress') {
    return { error: `Statut courant: ${intervention.status}. Démarrez d'abord l'intervention.` }
  }

  // Verify required items are done
  const items = await listChecklistItemsByIntervention(parsed.data.id)
  const missingRequired = items.filter((it) => it.required && !it.done)
  if (missingRequired.length > 0) {
    return {
      error: `${missingRequired.length} tâche${missingRequired.length > 1 ? 's' : ''} obligatoire${missingRequired.length > 1 ? 's' : ''} non cochée${missingRequired.length > 1 ? 's' : ''}`,
    }
  }

  await updateInterventionStatus(parsed.data.id, 'completed', new Date().toISOString())
  revalidatePath(`/interventions/${parsed.data.id}`)
  return { ok: true as const }
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  done: z.boolean(),
})

export async function toggleChecklistItemAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    done: formData.get('done') === 'true',
  })
  if (!parsed.success) return { error: 'Invalid input' }

  if (parsed.data.done) {
    await markChecklistItemDone(parsed.data.id, auth.userId)
  } else {
    // Reset done = false (admin client)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_checklist_items')
      .update({ done: false, done_at: null, done_by: null })
      .eq('id', parsed.data.id)
    if (error) return { error: error.message }
  }

  // We need the intervention_id to revalidate. Fetch it.
  const supabase = createAdminClient()
  const { data } = await supabase.from('intervention_checklist_items').select('intervention_id').eq('id', parsed.data.id).maybeSingle()
  if (data?.intervention_id) revalidatePath(`/interventions/${data.intervention_id}`)
  return { ok: true as const }
}

const photoKindSchema = z.enum(['before', 'after', 'anomaly', 'proof'])

const uploadPhotoSchema = z.object({
  intervention_id: z.string().uuid(),
  checklist_item_id: z.string().uuid().nullable(),
  kind: photoKindSchema,
  caption: z.string().max(500).optional(),
})

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

export async function uploadInterventionPhotoAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Fichier requis' }
  if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 MB)' }
  if (!file.type.startsWith('image/')) return { error: 'Format non supporté (image uniquement)' }

  const checklistItemRaw = formData.get('checklist_item_id') as string | null
  const checklist_item_id = checklistItemRaw && checklistItemRaw !== '' ? checklistItemRaw : null

  const parsed = uploadPhotoSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    checklist_item_id,
    kind: formData.get('kind'),
    caption: formData.get('caption') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }

  // Upload to storage with server timestamp in path
  const supabase = createAdminClient()
  const ext = file.name.split('.').pop()?.toLowerCase().slice(0, 5) ?? 'jpg'
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
  const ts = Date.now()
  const storagePath = `${parsed.data.intervention_id}/${parsed.data.kind}-${ts}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage
    .from('intervention-photos')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (uploadErr) return { error: `Upload failed: ${uploadErr.message}` }

  const photoId = await insertPhoto({
    intervention_id: parsed.data.intervention_id,
    checklist_item_id: parsed.data.checklist_item_id,
    storage_path: storagePath,
    kind: parsed.data.kind,
    caption: parsed.data.caption ?? null,
    taken_by: auth.userId,
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const, photoId }
}

// ============================
// Anomalies
// ============================

const createAnomalySchema = z.object({
  intervention_id: z.string().uuid(),
  category: z.enum(['eau_coupee', 'materiel_casse', 'acces_bloque', 'produit_manquant', 'autre']),
  category_other: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
})

export async function createAnomalyAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createAnomalySchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    category: formData.get('category'),
    category_other: formData.get('category_other') || undefined,
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  if (parsed.data.category === 'autre' && !parsed.data.category_other?.trim()) {
    return { error: 'Précisez la catégorie pour "Autre"' }
  }

  await createAnomaly({
    intervention_id: parsed.data.intervention_id,
    category: parsed.data.category,
    category_other: parsed.data.category_other ?? null,
    description: parsed.data.description ?? null,
    reported_by: auth.userId,
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const }
}

const resolveAnomalySchema = z.object({
  id: z.string().uuid(),
  resolution_note: z.string().max(2000).optional(),
})

export async function resolveAnomalyAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = resolveAnomalySchema.safeParse({
    id: formData.get('id'),
    resolution_note: formData.get('resolution_note') || undefined,
  })
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = createAdminClient()
  const { data: anom, error: anomErr } = await supabase
    .from('intervention_anomalies')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution_note: parsed.data.resolution_note ?? null,
    })
    .eq('id', parsed.data.id)
    .select('intervention_id')
    .single()
  if (anomErr) return { error: anomErr.message }
  if (anom?.intervention_id) revalidatePath(`/interventions/${anom.intervention_id}`)
  return { ok: true as const }
}

// ============================
// Validations
// ============================

const validateSchema = z.object({
  intervention_id: z.string().uuid(),
  comment: z.string().max(2000).optional(),
})

export async function validateInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = validateSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    comment: formData.get('comment') || undefined,
  })
  if (!parsed.success) return { error: 'Invalid input' }

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'completed') {
    return { error: `Statut courant: ${intervention.status}. Validation impossible.` }
  }

  // Check no validation already exists
  const existing = await getValidationByIntervention(parsed.data.intervention_id)
  if (existing) return { error: 'Cette intervention a déjà été validée' }

  // Create validation row + bump status
  await createValidation({
    intervention_id: parsed.data.intervention_id,
    validated_by: auth.userId,
    comment: parsed.data.comment ?? null,
  })
  await updateInterventionStatus(parsed.data.intervention_id, 'validated')

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const }
}

const requestCorrectionSchema = z.object({
  intervention_id: z.string().uuid(),
  comment: z.string().min(1, 'Précisez ce qui doit être corrigé').max(2000),
})

export async function requestCorrectionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = requestCorrectionSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    comment: formData.get('comment'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'completed') {
    return { error: `Statut courant: ${intervention.status}.` }
  }

  // Bump status back to in_progress + append comment to notes
  const supabase = createAdminClient()
  const { data: current } = await supabase.from('interventions').select('notes').eq('id', parsed.data.intervention_id).maybeSingle()
  const existingNotes = current?.notes ?? ''
  const newNote = `[Demande correction · ${new Date().toLocaleDateString('fr-FR')}] ${parsed.data.comment}`
  const combinedNotes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote

  await supabase.from('interventions')
    .update({ status: 'in_progress', notes: combinedNotes })
    .eq('id', parsed.data.intervention_id)

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const }
}
