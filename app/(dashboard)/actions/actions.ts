'use server'

// Server actions pour les « actions ouvertes » (site_actions).
// Partagées par toutes les surfaces : fiche site, mobile site, briefing, /actions, /m/actions.
// Doctrine : une action n'est pas une intervention. On ne fait que CLÔTURER
// (avec trace : commentaire + photo optionnelle) ou annuler. La planification
// (action → intervention) reste un geste séparé.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { markSiteActionDone, cancelSiteAction, markSiteActionPlanned } from '@/lib/db/site-actions'
import { listMissionsBySite, createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'

const IdSchema = z.string().uuid()
const CommentSchema = z.string().trim().min(1, 'Un commentaire est requis').max(1000)

const PHOTO_BUCKET = 'intervention-photos'
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

async function requireOperator(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  return { ok: true }
}

function revalidateActionSurfaces(siteId?: string) {
  revalidatePath('/actions')
  revalidatePath('/briefing')
  revalidatePath('/m/actions')
  if (siteId) {
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}`)
  }
}

/**
 * Clôture une action AVEC trace : commentaire (requis) + photo (optionnelle).
 * La trace alimente le journal du site (mémoire du fait accompli).
 */
export async function closeActionAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = formData.get('id')
  if (typeof id !== 'string' || !IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const siteId = typeof formData.get('site_id') === 'string' ? (formData.get('site_id') as string) : undefined

  const cParsed = CommentSchema.safeParse(formData.get('comment'))
  if (!cParsed.success) return { ok: false, error: cParsed.error.issues[0]?.message ?? 'Commentaire requis' }

  const auth = await requireOperator()
  if (!auth.ok) return auth

  // Photo optionnelle → upload bucket privé.
  let photoPath: string | null = null
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'Photo trop lourde (max 10 Mo)' }
    if (!file.type.startsWith('image/')) return { ok: false, error: 'Format de photo non supporté' }
    const supabase = createAdminClient()
    const rawExt = (file.name.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5)
    const safeExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'jpg'
    const path = `site-actions/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false })
    if (upErr) return { ok: false, error: 'Échec de l\'envoi de la photo' }
    photoPath = path
  }

  try {
    await markSiteActionDone(id, { comment: cParsed.data, photoPath })
  } catch {
    return { ok: false, error: 'Échec de la clôture' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}

/** Missions du site (pour le sélecteur de planification). Chargé à la demande. */
export async function listSiteMissionsForPlanningAction(
  siteId: string,
): Promise<Array<{ id: string; name: string; cadence: string }>> {
  if (!IdSchema.safeParse(siteId).success) return []
  const auth = await requireOperator()
  if (!auth.ok) return []
  const missions = await listMissionsBySite(siteId).catch(() => [])
  return missions
    .filter((m) => m.active !== false)
    .map((m) => ({ id: m.id, name: m.name, cadence: m.cadence }))
}

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')
const SlotSchema = z.enum(['morning', 'afternoon', 'evening'])

/**
 * Planifie une action ouverte en intervention datée.
 * Mission : existante (recommandé — héritage cadence/visibilité) ou nouvelle
 * (ponctuelle, cadence on_demand). L'action passe en 'planned' (liée à l'intervention).
 */
export async function planActionAction(
  formData: FormData,
): Promise<{ ok: true; interventionId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }

  const id = formData.get('id')
  if (typeof id !== 'string' || !IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const siteId = formData.get('site_id')
  if (typeof siteId !== 'string' || !IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const dParsed = DateSchema.safeParse(formData.get('scheduled_for'))
  if (!dParsed.success) return { ok: false, error: 'Date invalide' }
  const sParsed = SlotSchema.safeParse(formData.get('slot'))
  if (!sParsed.success) return { ok: false, error: 'Créneau invalide' }

  const missionMode = formData.get('mission_mode')
  let missionId: string
  try {
    if (missionMode === 'existing') {
      const mid = formData.get('mission_id')
      if (typeof mid !== 'string' || !IdSchema.safeParse(mid).success) return { ok: false, error: 'Mission invalide' }
      missionId = mid
    } else {
      const rawName = formData.get('new_mission_name')
      const name = (typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'Intervention').slice(0, 120)
      missionId = await createMission({ site_id: siteId, name, cadence: 'on_demand', created_by: user.id })
    }

    const interventionId = await createIntervention({
      mission_id: missionId,
      scheduled_for: dParsed.data,
      slot: sParsed.data,
      created_by: user.id,
    })
    await markSiteActionPlanned(id, 'intervention', interventionId)
    revalidateActionSurfaces(siteId)
    revalidatePath('/aujourdhui')
    revalidatePath('/semaine')
    return { ok: true, interventionId }
  } catch {
    return { ok: false, error: 'Échec de la planification' }
  }
}

export async function cancelActionAction(
  id: string,
  siteId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const auth = await requireOperator()
  if (!auth.ok) return auth
  try {
    await cancelSiteAction(id)
  } catch {
    return { ok: false, error: 'Échec de la mise à jour' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}
