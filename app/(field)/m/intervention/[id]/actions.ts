'use server'

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import {
  getIntervention,
  updateInterventionStatus,
  markChecklistItemDone,
  insertPhoto,
  createAnomaly,
} from '@/lib/db/interventions'
import { markInterventionSkipped } from '@/lib/db/intervention-templates'
import { logAuditEvent } from '@/lib/audit/log'

async function requireFieldAgent(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  // chef_equipe = production agent. admin/manager = QA on /m.
  if (role !== 'chef_equipe' && role !== 'admin' && role !== 'manager') {
    return { error: 'Forbidden' }
  }
  return { userId: user.id }
}

const idSchema = z.object({ id: z.string().uuid() })

export async function startInterventionMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }

  // Garde-fou Doctrine V3 : une intervention sans équipe affectée
  // (organisation prévue) ne peut pas être démarrée. Le briefing du soir
  // signale ces interventions, et cohérence avec /sites/[id] : on ne démarre
  // pas un travail dont personne n'est responsable.
  if (intervention.status === 'planned' && !intervention.assigned_team_id) {
    return {
      error:
        "Cette intervention n'a pas d'équipe affectée. Demande au gérant de l'affecter avant de démarrer.",
    }
  }

  // Only allow start if currently planned. If already in_progress, this is a no-op success
  // (handles concurrent agent on same intervention — pas de panic, juste idempotent)
  if (intervention.status === 'planned') {
    await updateInterventionStatus(parsed.data.id, 'in_progress')
  } else if (intervention.status !== 'in_progress') {
    return { error: `Statut actuel : ${intervention.status}. Démarrage impossible.` }
  }

  revalidatePath(`/m/intervention/${parsed.data.id}`)
  revalidatePath('/m')
  return { ok: true as const }
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  done: z.boolean(),
})

export async function toggleChecklistItemMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    done: formData.get('done') === 'true',
  })
  if (!parsed.success) return { error: 'Invalid input' }

  if (parsed.data.done) {
    await markChecklistItemDone(parsed.data.id, auth.userId)
  } else {
    // Reset done = false (admin client — RLS still protects via the policies on intervention_checklist_items)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_checklist_items')
      .update({ done: false, done_at: null, done_by: null })
      .eq('id', parsed.data.id)
    if (error) return { error: error.message }
  }

  // Find intervention_id for revalidation
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('intervention_checklist_items')
    .select('intervention_id')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (data?.intervention_id) revalidatePath(`/m/intervention/${data.intervention_id}`)
  return { ok: true as const }
}

// ----- Photo upload (mobile, chef_equipe-friendly) -----

const photoKindSchema = z.enum(['before', 'after', 'anomaly', 'proof'])

const uploadPhotoSchema = z.object({
  intervention_id: z.string().uuid(),
  checklist_item_id: z.string().uuid().nullable(),
  kind: photoKindSchema,
  client_timestamp: z.string().datetime().nullable().optional(),
})

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

export async function uploadPhotoMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Photo manquante' }
  if (file.size > MAX_PHOTO_BYTES) return { error: 'Photo trop lourde (max 10 Mo)' }
  if (!file.type.startsWith('image/')) return { error: 'Format non supporté' }

  const checklistItemRaw = formData.get('checklist_item_id') as string | null
  const checklist_item_id = checklistItemRaw && checklistItemRaw !== '' ? checklistItemRaw : null
  const clientTimestampRaw = formData.get('client_timestamp') as string | null
  const client_timestamp = clientTimestampRaw && clientTimestampRaw !== '' ? clientTimestampRaw : null

  const parsed = uploadPhotoSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    checklist_item_id,
    kind: formData.get('kind'),
    client_timestamp,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // Upload to storage with server timestamp in path
  const supabase = createAdminClient()
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
  const ts = Date.now()
  const storagePath = `${parsed.data.intervention_id}/${parsed.data.kind}-${ts}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())

  // Intégrité cryptographique : hash SHA-256 du contenu binaire avant upload.
  // Le hash + le storage_path + le timestamp serveur lient indissociablement
  // la photo en base au fichier dans le bucket (migration 040, Phase 1.1).
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const { error: uploadErr } = await supabase.storage
    .from('intervention-photos')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  if (uploadErr) return { error: `Upload échoué : ${uploadErr.message}` }

  const photoId = await insertPhoto({
    intervention_id: parsed.data.intervention_id,
    checklist_item_id: parsed.data.checklist_item_id,
    storage_path: storagePath,
    kind: parsed.data.kind,
    caption: null,
    taken_by: auth.userId,
    sha256,
    mime_type: file.type,
    size_bytes: buffer.length,
    client_timestamp: parsed.data.client_timestamp ?? null,
    hash_origin: 'verified',
  })

  revalidatePath(`/m/intervention/${parsed.data.intervention_id}`)
  return { ok: true as const, photoId, storagePath }
}

// ----- Anomalies (mobile, chef_equipe-friendly) -----

const createAnomalyMobileSchema = z.object({
  intervention_id: z.string().uuid(),
  category: z.enum(['acces_bloque', 'materiel_casse', 'eau_coupee', 'produit_manquant', 'autre']),
  category_other: z.string().max(140).optional(),
  description: z.string().max(2000).optional(),
})

export async function createAnomalyMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = createAnomalyMobileSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    category: formData.get('category'),
    category_other: formData.get('category_other') || undefined,
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  if (parsed.data.category === 'autre' && !parsed.data.category_other?.trim()) {
    return { error: 'Précisez ce qu\'il s\'est passé' }
  }

  await createAnomaly({
    intervention_id: parsed.data.intervention_id,
    category: parsed.data.category,
    category_other: parsed.data.category_other ?? null,
    description: parsed.data.description ?? null,
    reported_by: auth.userId,
  })

  revalidatePath(`/m/intervention/${parsed.data.intervention_id}`)
  return { ok: true as const }
}

// ----- Skip intervention ("Pas aujourd'hui", raison obligatoire) -----
//
// Doctrine Slice 6.4 :
//   - Wording « Pas aujourd'hui », jamais « Annuler / Reporter / Skip » côté UX.
//   - Raison obligatoire (texte libre, min 3 chars, max 500).
//   - Un appel = un skip. Pas de mass-skip.
//   - Bouton uniquement sur intervention `status === 'planned'` — refuse sinon.
//   - Audit log best-effort (`mission.status_changed`, metadata={reason, skip: true}).

const skipSchema = z.object({
  intervention_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'La raison doit faire au moins 3 caractères').max(500),
})

export async function skipInterventionAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = skipSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { ok: false as const, error: 'Intervention introuvable' }

  // Refuse si déjà commencée / terminée / déjà sautée — cohérence métier.
  if (intervention.status !== 'planned') {
    return {
      ok: false as const,
      error:
        intervention.status === 'skipped'
          ? 'Cette opération est déjà annulée pour ce jour'
          : 'Cette intervention est déjà commencée',
    }
  }

  await markInterventionSkipped(
    parsed.data.intervention_id,
    parsed.data.reason,
    auth.userId
  )

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: parsed.data.intervention_id,
    action: 'status_changed',
    metadata: { to: 'skipped', reason: parsed.data.reason, source: 'mobile' },
  })

  revalidatePath(`/m/intervention/${parsed.data.intervention_id}`)
  revalidatePath('/m')
  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  revalidatePath('/missions')

  return { ok: true as const }
}

// ----- Complete intervention (mobile, soft-required) -----

const completeMobileSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(140).optional(),
})

export async function completeInterventionMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = completeMobileSchema.safeParse({
    id: formData.get('id'),
    comment: formData.get('comment') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'in_progress') {
    return { error: `Statut courant: ${intervention.status}` }
  }

  // Check required items
  const supabase = createAdminClient()
  const { data: items } = await supabase
    .from('intervention_checklist_items')
    .select('id, required, done')
    .eq('intervention_id', parsed.data.id)
  const missingRequired = (items ?? []).filter((i) => i.required && !i.done)

  if (missingRequired.length > 0 && !parsed.data.comment) {
    return {
      error: 'comment_required',
      missingCount: missingRequired.length,
    } as const
  }

  // Append comment to notes if provided
  if (parsed.data.comment) {
    const { data: current } = await supabase
      .from('interventions')
      .select('notes')
      .eq('id', parsed.data.id)
      .maybeSingle()
    const existingNotes = current?.notes ?? ''
    const newNote = `[Agent · ${new Date().toLocaleDateString('fr-FR')}] ${parsed.data.comment}`
    const combinedNotes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote

    await supabase
      .from('interventions')
      .update({
        status: 'completed',
        executed_at: new Date().toISOString(),
        notes: combinedNotes,
      })
      .eq('id', parsed.data.id)
  } else {
    await updateInterventionStatus(parsed.data.id, 'completed', new Date().toISOString())
  }

  revalidatePath(`/m/intervention/${parsed.data.id}`)
  revalidatePath('/m')
  return { ok: true as const }
}
