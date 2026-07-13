'use server'

import { z } from 'zod'
import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { findTeamSiteConflict } from '@/lib/scheduling/team-conflict'
import { getUserRoleById } from '@/lib/db/users'
import {
  markChecklistItemDone,
  insertPhoto,
  updateInterventionStatus,
  updatePhotoAiCaption,
  getIntervention,
  listChecklistItemsByIntervention,
  createAnomaly,
  rescheduleIntervention,
  getAvailableSlotsForTeam,
} from '@/lib/db/interventions'
import { analyzeAnomalyPhoto } from '@/lib/ai/analyze-photo'
import { markInterventionSkipped } from '@/lib/db/intervention-templates'
import { logAuditEvent } from '@/lib/audit/log'
import { requireOwned } from '@/lib/auth/ownership'
import type { UserRole } from '@/types/db'

async function requireManagerOrAdmin(): Promise<{ userId: string; role: UserRole } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id, role }
}

/** Lot S — garde d'appartenance : le rôle ne suffit pas, l'intervention doit
 *  appartenir à l'organisation de l'appelant (admin = super-admin exempté).
 *  Toute action de ce fichier qui mute par id DOIT passer par ici. */
async function guardIntervention(role: UserRole, id: string): Promise<{ error: string } | null> {
  const owned = await requireOwned(role, 'interventions', id)
  return owned.allowed ? null : { error: owned.error }
}

const idSchema = z.object({ id: z.string().uuid() })

export async function startInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }
  const denied = await guardIntervention(auth.role, parsed.data.id)
  if (denied) return denied

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'planned') {
    return { error: `Statut courant: ${intervention.status}. Démarrer impossible.` }
  }
  // Garde-fou Doctrine V3 : pas d'organisation prévue → pas de démarrage.
  if (!intervention.assigned_team_id) {
    return {
      error: "Cette intervention n'a pas d'équipe affectée. Affecte-la avant de démarrer.",
    }
  }

  await updateInterventionStatus(parsed.data.id, 'in_progress')
  revalidatePath(`/interventions/${parsed.data.id}`)
  return { ok: true as const }
}

const completeSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(500).optional(),
})

export async function completeInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const parsed = completeSchema.safeParse({
    id: formData.get('id'),
    comment: formData.get('comment') || undefined,
  })
  if (!parsed.success) return { error: 'Invalid id' }
  const denied = await guardIntervention(auth.role, parsed.data.id)
  if (denied) return denied

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'in_progress') {
    return { error: `Statut courant: ${intervention.status}. Démarrez d'abord l'intervention.` }
  }

  const items = await listChecklistItemsByIntervention(parsed.data.id)
  const missingRequired = items.filter((it) => it.required && !it.done)

  // Soft-block : si tâches manquantes sans justification → demander la raison
  if (missingRequired.length > 0 && !parsed.data.comment) {
    return { error: 'comment_required' as const, missingCount: missingRequired.length }
  }

  const supabase = createAdminClient()
  if (parsed.data.comment) {
    const { data: current } = await supabase.from('interventions').select('notes').eq('id', parsed.data.id).maybeSingle()
    const existingNotes = (current?.notes as string | null) ?? ''
    const newNote = `[Superviseur · ${new Date().toLocaleDateString('fr-FR')}] ${parsed.data.comment}`
    const combinedNotes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote
    await supabase.from('interventions').update({ status: 'completed', executed_at: new Date().toISOString(), notes: combinedNotes }).eq('id', parsed.data.id)
  } else {
    await updateInterventionStatus(parsed.data.id, 'completed', new Date().toISOString())
  }

  revalidatePath(`/interventions/${parsed.data.id}`)
  return { ok: true as const }
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  intervention_id: z.string().uuid(),
  done: z.boolean(),
})

export async function toggleChecklistItemAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    intervention_id: formData.get('intervention_id'),
    done: formData.get('done') === 'true',
  })
  if (!parsed.success) return { error: 'Invalid input' }
  const denied = await guardIntervention(auth.role, parsed.data.intervention_id)
  if (denied) return denied

  const supabase = createAdminClient()

  // Vérifie que l'item appartient bien à l'intervention attendue
  const { data: item } = await supabase
    .from('intervention_checklist_items')
    .select('intervention_id')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!item || item.intervention_id !== parsed.data.intervention_id) {
    return { error: 'Item introuvable pour cette intervention' }
  }

  if (parsed.data.done) {
    await markChecklistItemDone(parsed.data.id, auth.userId)
  } else {
    const { error } = await supabase
      .from('intervention_checklist_items')
      .update({ done: false, done_at: null, done_by: null })
      .eq('id', parsed.data.id)
    if (error) return { error: error.message }
  }

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
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
  const denied = await guardIntervention(auth.role, parsed.data.intervention_id)
  if (denied) return denied

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }

  // Upload to storage with server timestamp in path
  const supabase = createAdminClient()
  const ext = file.name.split('.').pop()?.toLowerCase().slice(0, 5) ?? 'jpg'
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'jpg'
  const ts = Date.now()
  const storagePath = `${parsed.data.intervention_id}/${parsed.data.kind}-${ts}.${safeExt}`

  const buffer = Buffer.from(await file.arrayBuffer())

  // Intégrité cryptographique (migration 040, Phase 1.1).
  const sha256 = createHash('sha256').update(buffer).digest('hex')

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
    sha256,
    mime_type: file.type,
    size_bytes: buffer.length,
    hash_origin: 'verified',
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const, photoId }
}

// ============================
// Anomalies
// ============================

const createAnomalySchema = z.object({
  intervention_id: z.string().uuid(),
  category: z.enum([
    'acces_bloque',
    'eau_coupee',
    'electricite_coupee',
    'zone_non_prete',
    'materiel_casse',
    'danger_securite',
    'livraison_probleme',
    'produit_manquant',
    'autre',
  ]),
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
  const denied = await guardIntervention(auth.role, parsed.data.intervention_id)
  if (denied) return denied

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
  // Lot S : on résout l'intervention porteuse AVANT d'écrire — l'anomalie d'un
  // autre tenant ne doit pas être résolue par un id deviné.
  const { data: target } = await supabase
    .from('intervention_anomalies')
    .select('intervention_id')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!target?.intervention_id) return { error: 'Anomalie introuvable' }
  const denied = await guardIntervention(auth.role, target.intervention_id)
  if (denied) return denied

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

// ----- Skip intervention ("Pas aujourd'hui", raison obligatoire) — vue superviseur -----
//
// Doctrine Slice 6.4 — même comportement que la version mobile (cf.
// app/(field)/m/intervention/[id]/actions.ts). Auth via requireManagerOrAdmin
// (les chef_equipe utilisent la version mobile depuis /m).

const skipSupervisorSchema = z.object({
  intervention_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'La raison doit faire au moins 3 caractères').max(500),
})

export async function skipInterventionSupervisorAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = skipSupervisorSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }
  const denied = await guardIntervention(auth.role, parsed.data.intervention_id)
  if (denied) return { ok: false as const, error: denied.error }

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { ok: false as const, error: 'Intervention introuvable' }

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
    metadata: { to: 'skipped', reason: parsed.data.reason, source: 'supervisor' },
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  revalidatePath('/missions')
  revalidatePath(`/m/intervention/${parsed.data.intervention_id}`)
  revalidatePath('/m')

  return { ok: true as const }
}

// ============================
// Décaler intervention (changement de date + slot)
// ============================

const rescheduleSchema = z.object({
  intervention_id: z.string().uuid(),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  new_slot: z.enum(['morning', 'afternoon', 'evening']),
})

export async function rescheduleInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = rescheduleSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    new_date: formData.get('new_date'),
    new_slot: formData.get('new_slot'),
  })
  if (!parsed.success) return { error: 'Données invalides' }
  const denied = await guardIntervention(auth.role, parsed.data.intervention_id)
  if (denied) return denied

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'planned') {
    return { error: `Décalage impossible : l'intervention est ${intervention.status}.` }
  }
  if (!intervention.assigned_team_id) {
    return { error: "Aucune équipe affectée — le décalage nécessite une équipe." }
  }

  // V6.1 — vérifier conflit horaire (chevauchement) au lieu de "même slot".
  // Si l'intervention avait une heure précise sur l'ancien jour, on la
  // réplique sur la nouvelle date pour la comparaison (le slot ne change
  // que si l'utilisateur l'a explicitement changé dans le form).
  const supabase = createAdminClient()
  const interventionTyped = intervention as unknown as { planned_start: string | null; planned_end: string | null }
  const slotChanged = parsed.data.new_slot !== intervention.slot
  let srcPlannedStart: string | null = null
  let srcPlannedEnd: string | null = null
  if (!slotChanged && interventionTyped.planned_end && interventionTyped.planned_start) {
    const startHHMM = /T(\d{2}:\d{2})/.exec(interventionTyped.planned_start)?.[1]
    const endHHMM = /T(\d{2}:\d{2})/.exec(interventionTyped.planned_end)?.[1]
    if (startHHMM && endHHMM) {
      srcPlannedStart = `${parsed.data.new_date}T${startHHMM}:00.000Z`
      srcPlannedEnd = `${parsed.data.new_date}T${endHHMM}:00.000Z`
    }
  }
  const conflict = await findTeamSiteConflict({
    admin: supabase,
    teamId: intervention.assigned_team_id,
    missionId: intervention.mission_id,
    scheduledFor: parsed.data.new_date,
    slot: parsed.data.new_slot,
    sourcePlannedStart: srcPlannedStart,
    sourcePlannedEnd: srcPlannedEnd,
    excludeInterventionId: parsed.data.intervention_id,
  })
  if (conflict) {
    return {
      error: `Cet horaire vient d'être pris : ${conflict.teamName} est déjà sur ${conflict.siteName}. Choisis un autre horaire.`,
    }
  }

  await rescheduleIntervention(parsed.data.intervention_id, parsed.data.new_date, parsed.data.new_slot)

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: parsed.data.intervention_id,
    action: 'status_changed',
    metadata: {
      to: 'rescheduled',
      newDate: parsed.data.new_date,
      newSlot: parsed.data.new_slot,
      previousDate: intervention.scheduled_for,
      previousSlot: intervention.slot,
    },
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  revalidatePath(`/m/intervention/${parsed.data.intervention_id}`)
  revalidatePath('/m')
  revalidatePath('/missions')
  return { ok: true as const }
}

// Server action pour récupérer la liste des créneaux libres (appelé depuis le client)
export async function getAvailableSlotsAction(interventionId: string) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { error: auth.error }
  const denied = await guardIntervention(auth.role, interventionId)
  if (denied) return denied

  const intervention = await getIntervention(interventionId)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (!intervention.assigned_team_id) return { error: 'Aucune équipe affectée' }

  const slots = await getAvailableSlotsForTeam(intervention.assigned_team_id, interventionId, 7)
  return { ok: true as const, slots }
}

// ============================
// Réouverture intervention (mot de passe superviseur)
// ============================

const reopenSchema = z.object({
  intervention_id: z.string().uuid(),
  password: z.string().min(1),
})

export async function reopenInterventionAction(formData: FormData) {
  // Récupérer l'utilisateur courant depuis la session (déjà manager/admin car sur la page desktop)
  const supabaseServer = await createServerClient()
  const { data: { user: currentUser } } = await supabaseServer.auth.getUser()
  if (!currentUser?.email) return { error: 'Non authentifié' }

  const role = await getUserRoleById(currentUser.id)
  if (role !== 'manager' && role !== 'admin') {
    return { error: 'Seul un superviseur peut réouvrir une intervention terminée' }
  }

  const parsed = reopenSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'Données invalides' }
  const denied = await guardIntervention(role, parsed.data.intervention_id)
  if (denied) return denied

  const intervention = await getIntervention(parsed.data.intervention_id)
  if (!intervention) return { error: 'Intervention introuvable' }
  if (intervention.status !== 'completed') return { error: "Cette intervention n'est pas terminée" }

  // Confirmer l'identité : vérifier le mot de passe de l'utilisateur courant
  // via un client éphémère (pas de remplacement de session).
  const verifyClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error: authError } = await verifyClient.auth.signInWithPassword({
    email: currentUser.email,
    password: parsed.data.password,
  })
  if (authError) return { error: 'Mot de passe incorrect' }

  await updateInterventionStatus(parsed.data.intervention_id, 'in_progress')

  await logAuditEvent({
    userId: currentUser.id,
    entityType: 'mission',
    entityId: parsed.data.intervention_id,
    action: 'status_changed',
    metadata: { to: 'in_progress', reopenedBy: currentUser.id, source: 'reopen_flow' },
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return { ok: true as const }
}

// ----- Analyse photo anomalie (Gemini Vision) -----

export async function deleteInterventionPhotoAction(
  photoId: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const supabase = createAdminClient()
  const { data: photo } = await supabase
    .from('intervention_photos')
    .select('id, storage_path, intervention_id')
    .eq('id', photoId)
    .maybeSingle()
  if (!photo) return { error: 'Photo introuvable' }
  const denied = await guardIntervention(auth.role, photo.intervention_id)
  if (denied) return denied
  await supabase.storage.from('intervention-photos').remove([photo.storage_path])
  const { error } = await supabase.from('intervention_photos').delete().eq('id', photoId)
  if (error) return { error: error.message }
  revalidatePath(`/interventions/${photo.intervention_id}`)
  return { ok: true as const }
}

export async function analyzeInterventionPhotoAction(
  formData: FormData,
): Promise<{ ok: true; caption: string } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const photoId = formData.get('photo_id') as string | null
  if (!photoId) return { error: 'photo_id manquant' }

  const supabase = createAdminClient()
  const { data: photo } = await supabase
    .from('intervention_photos')
    .select('id, storage_path, mime_type, anomaly_id, intervention_id')
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) return { error: 'Photo introuvable' }
  const denied = await guardIntervention(auth.role, photo.intervention_id)
  if (denied) return denied
  if (!photo.anomaly_id) return { error: 'Photo non liée à une anomalie' }

  const { data: fileData, error: dlErr } = await supabase.storage
    .from('intervention-photos')
    .download(photo.storage_path)

  if (dlErr || !fileData) return { error: 'Téléchargement échoué' }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const caption = await analyzeAnomalyPhoto(buffer, photo.mime_type ?? 'image/jpeg')
  if (!caption) return { error: 'Analyse échouée — réessayez' }

  await updatePhotoAiCaption(photo.id, caption)
  revalidatePath(`/interventions/${photo.intervention_id}`)
  return { ok: true, caption }
}

