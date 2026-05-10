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
