'use server'

// Server actions pour les « actions ouvertes » (site_actions).
// Partagées par toutes les surfaces : fiche site, mobile site, briefing, /actions, /m/actions.
// Doctrine : une action n'est pas une intervention. On ne fait que CLÔTURER
// (avec trace : commentaire + photo optionnelle) ou annuler. La planification
// (action → intervention) reste un geste séparé.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { requireSiteWriteAccess, requireSiteActionWriteAccess } from '@/lib/auth/site-write-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { logUsageEvent } from '@/lib/db/usage-events'
import { createSiteAction, markSiteActionDone, markSiteActionProgress, setSiteActionSnooze, cancelSiteAction, markSiteActionPlanned } from '@/lib/db/site-actions'
import { listMissionsBySite, createMission } from '@/lib/db/missions'
import { createIntervention } from '@/lib/db/interventions'
import { findOrCreateSubjectByName, attachToSubject } from '@/lib/db/subjects'

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

// « Fait aujourd'hui » — avancée terrain, PAS une clôture (l'action reste open).
const ProgressSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid().optional(),
  on: z.boolean(),
})

// « Reporter » : motif court parmi une liste fermée, ou null pour retirer.
const SNOOZE_REASONS = ['attente_client', 'attente_materiel', 'meteo', 'autre'] as const
const SnoozeSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid().optional(),
  reason: z.enum(SNOOZE_REASONS).nullable(),
})

export async function markActionProgressAction(
  input: z.input<typeof ProgressSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ProgressSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const access = await requireSiteActionWriteAccess(parsed.data.id)
  if (!access.ok) return access
  try {
    await markSiteActionProgress(parsed.data.id, parsed.data.on)
    revalidateActionSurfaces(parsed.data.site_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

/** « Reporter » une action : pose un motif (ou null pour le retirer). L'action
 *  reste 'open' — c'est une explication, pas une clôture ni un blocage formel. */
export async function snoozeActionAction(
  input: z.input<typeof SnoozeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SnoozeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const access = await requireSiteActionWriteAccess(parsed.data.id)
  if (!access.ok) return access
  try {
    await setSiteActionSnooze(parsed.data.id, parsed.data.reason)
    revalidateActionSurfaces(parsed.data.site_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

// ── Associer une action à un ÉLÉMENT à mémoriser (chemin direct Action → Élément) ──
// Hors décisions, le graphe ne se remplit pas : beaucoup d'actions naissent à la
// volée. On NE demande PAS « est-ce un sujet ? » mais « concerne-t-elle un élément
// durable ? ». Déterministe (humain choisit/crée), anti-doublon réutilisé, jamais auto.
// Manager/admin seulement (cohérent avec la doctrine sujets).
// Manager/admin porté par la frontière d'écriture SITE (`requireSiteWriteAccess`,
// politique `managerOrAdmin`) : membership actif à l'org du site + rôle, en UN point.

/** Éléments à mémoriser (sujets non clos) d'un site — pour « utiliser un élément existant ». */
export async function listSiteSubjectsForAssociationAction(siteId: string): Promise<Array<{ id: string; name: string }>> {
  if (!IdSchema.safeParse(siteId).success) return []
  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return []
  const { data } = await createAdminClient().from('subjects').select('id, name').eq('site_id', siteId).neq('status', 'closed').order('name')
  return (data ?? []) as Array<{ id: string; name: string }>
}

const AssociateSchema = z.object({
  actionId: z.string().uuid(),
  siteId: z.string().uuid(),
  mode: z.enum(['existing', 'create']),
  subjectId: z.string().uuid().nullable(),
  name: z.string().trim().max(160).nullable(),
})

/** Rattache une action à un élément : existant (subjectId) ou nouveau (name, anti-doublon). */
export async function associateActionToElementAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = AssociateSchema.safeParse({
    actionId: formData.get('actionId'),
    siteId: formData.get('siteId'),
    mode: formData.get('mode'),
    subjectId: ((formData.get('subjectId') as string | null) ?? '') || null,
    name: ((formData.get('name') as string | null) ?? '') || null,
  })
  if (!parsed.success) return { ok: false, error: 'Saisie invalide' }
  const { actionId, siteId, mode, subjectId, name } = parsed.data
  // Ce geste touche DEUX ressources : l'action (on pose son `subject_id`) et le
  // site (on peut y créer un sujet). On exige donc les deux, et qu'elles soient
  // de la MÊME organisation — sinon un couple (mon action, site étranger) ou
  // (action étrangère, mon site) passerait la frontière.
  const access = await requireSiteActionWriteAccess(actionId, 'managerOrAdmin')
  if (!access.ok) return access
  const siteAccess = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!siteAccess.ok || siteAccess.organizationId !== access.organizationId) {
    return { ok: false, error: 'Accès refusé' }
  }
  try {
    let targetSubjectId: string
    if (mode === 'existing') {
      if (!subjectId) return { ok: false, error: 'Choisissez un élément existant.' }
      targetSubjectId = subjectId
    } else {
      const clean = (name ?? '').trim()
      if (!clean) return { ok: false, error: 'Nom de l’élément requis.' }
      targetSubjectId = await findOrCreateSubjectByName(siteId, clean, access.userId)
    }
    await attachToSubject('site_actions', actionId, targetSubjectId)
    revalidateActionSurfaces(siteId)
    revalidatePath(`/sites/${siteId}/subjects`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec' }
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

  const access = await requireSiteActionWriteAccess(id)
  if (!access.ok) return access

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
    await markSiteActionDone(id, { comment: cParsed.data, photoPath }, access.userId)
  } catch {
    return { ok: false, error: 'Échec de la clôture' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}

/**
 * ROUVRIR une action clôturée par erreur.
 *
 * L'anomalie se rouvre. L'intervention se rouvre. Le dossier de preuve se rouvre.
 * L'action, non : un clic sur « Terminé » était définitif — et il n'existait aucun
 * recours. Une clôture par mégarde effaçait le suivi d'un engagement, sans retour.
 *
 * La clôture n'est pas une preuve : c'est une déclaration. Elle peut être fausse,
 * et donc se défaire. Ce qu'on ne détruit pas, en revanche, c'est ce qui a été
 * DÉCLARÉ à la clôture (commentaire, photo) : la trace reste, même rouverte —
 * on ne réécrit pas ce qui a été dit.
 */
export async function reopenActionAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = formData.get('id')
  if (typeof id !== 'string' || !IdSchema.safeParse(id).success) {
    return { ok: false, error: 'Action invalide' }
  }
  const siteId = typeof formData.get('site_id') === 'string' ? (formData.get('site_id') as string) : undefined
  const reason = typeof formData.get('reason') === 'string' ? (formData.get('reason') as string).trim() || null : null

  const access = await requireSiteActionWriteAccess(id)
  if (!access.ok) return access

  // Réouverture ATOMIQUE : repasse open/done_at=null ET journalise l'événement
  // `reopened` dans la même transaction (mig 221). L'événement `completed` antérieur
  // reste dans le journal → l'histoire de clôture n'est plus détruite. No-op si
  // l'action n'est pas terminée.
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('fn_reopen_action', { p_id: id, p_actor_id: access.userId, p_reason: reason })
  if (error) return { ok: false, error: 'Échec de la réouverture' }

  revalidateActionSurfaces(siteId)
  return { ok: true }
}

/** Missions du site (pour le sélecteur de planification). Chargé à la demande. */
export async function listSiteMissionsForPlanningAction(
  siteId: string,
): Promise<Array<{ id: string; name: string; cadence: string }>> {
  if (!IdSchema.safeParse(siteId).success) return []
  const access = await requireSiteWriteAccess(siteId)
  if (!access.ok) return []
  const missions = await listMissionsBySite(siteId).catch(() => [])
  return missions
    .filter((m) => m.active !== false)
    .map((m) => ({ id: m.id, name: m.name, cadence: m.cadence }))
}

/**
 * Équipes actives de l'org — pour attribuer une action planifiée directement.
 *
 * ⚠️ SEUL point de ce fichier qui dépend encore de `getOrgId()`. C'est DÉLIBÉRÉ :
 * la fonction n'a AUCUN contexte de ressource (signature `()`), donc aucune
 * organisation ne peut en être déduite. La contextualiser exigerait de changer sa
 * signature (recevoir un `siteId`) — hors périmètre M2C. Elle est CLASSÉE M3 (vue
 * agrégée : équipes de `getOrgIdsOfUser()`). Tant que M3 n'est pas fait, un compte
 * multi-org y verra `getOrgId()` lever — comportement inchangé, assumé.
 */
export async function listActiveTeamsForPlanningAction(): Promise<
  Array<{ id: string; name: string; color: string | null }>
> {
  const auth = await requireOperator()
  if (!auth.ok) return []
  const orgId = await getOrgId()
  if (!orgId) return []
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('teams')
    .select('id, name, color')
    .eq('organization_id', orgId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name')
  return (data ?? []) as Array<{ id: string; name: string; color: string | null }>
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
  const id = formData.get('id')
  if (typeof id !== 'string' || !IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const siteId = formData.get('site_id')
  if (typeof siteId !== 'string' || !IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  // L'action est la racine (elle passe en 'planned') ; la mission/intervention
  // naît sur le site. On exige les deux, MÊME organisation — la hiérarchie va du
  // site vers l'org, jamais de `user.organization_id`.
  const access = await requireSiteActionWriteAccess(id)
  if (!access.ok) return access
  const siteAccess = await requireSiteWriteAccess(siteId)
  if (!siteAccess.ok || siteAccess.organizationId !== access.organizationId) {
    return { ok: false, error: 'Accès refusé' }
  }

  const dParsed = DateSchema.safeParse(formData.get('scheduled_for'))
  if (!dParsed.success) return { ok: false, error: 'Date invalide' }
  const sParsed = SlotSchema.safeParse(formData.get('slot'))
  if (!sParsed.success) return { ok: false, error: 'Créneau invalide' }

  // Équipe : 'inherit' (défaut, hérite de la mission) | 'unassigned' | uuid.
  const teamRaw = formData.get('team')
  const teamChoice = typeof teamRaw === 'string' && teamRaw ? teamRaw : 'inherit'

  const supabase = createAdminClient()
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
      missionId = await createMission({ site_id: siteId, name, cadence: 'on_demand', created_by: access.userId })
    }

    // Résolution de l'équipe (même logique que la vue Semaine) :
    //   'inherit'    → équipe par défaut de la mission (peut être null)
    //   'unassigned' → null (Non-affecté)
    //   uuid         → équipe précise, validée active + même org
    let finalTeamId: string | null = null
    if (teamChoice === 'unassigned') {
      finalTeamId = null
    } else if (teamChoice === 'inherit') {
      const { data: m } = await supabase
        .from('missions')
        .select('assigned_team_id')
        .eq('id', missionId)
        .maybeSingle()
      finalTeamId = (m as { assigned_team_id: string | null } | null)?.assigned_team_id ?? null
    } else {
      if (!IdSchema.safeParse(teamChoice).success) return { ok: false, error: 'Équipe invalide' }
      const { data: t } = await supabase
        .from('teams')
        .select('id, active, deleted_at, organization_id')
        .eq('id', teamChoice)
        .maybeSingle()
      const team = t as { active: boolean; deleted_at: string | null; organization_id: string } | null
      if (!team || team.deleted_at !== null || team.active === false || team.organization_id !== access.organizationId) {
        return { ok: false, error: 'Équipe inconnue ou archivée' }
      }
      finalTeamId = teamChoice
    }

    const interventionId = await createIntervention({
      mission_id: missionId,
      scheduled_for: dParsed.data,
      slot: sParsed.data,
      created_by: access.userId,
    })
    // L'intervention naît directement affectée (assigned_team_id), pas besoin de
    // passer par le drag & drop de la Semaine.
    if (finalTeamId) {
      await supabase.from('interventions').update({ assigned_team_id: finalTeamId }).eq('id', interventionId)
    }
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
  const access = await requireSiteActionWriteAccess(id)
  if (!access.ok) return access
  try {
    await cancelSiteAction(id)
  } catch {
    return { ok: false, error: 'Échec de la mise à jour' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}

const TitleSchema = z.string().trim().min(1, 'Titre requis').max(200)
const VALID_SOURCES = ['mobile_site', 'desktop_site', 'actions_list'] as const

/**
 * Création STANDALONE d'une action (capture terrain), SANS compte-rendu ni
 * réunion. Débloque la boucle Observation → Action, l'événement le plus
 * fréquent sur un chantier.
 *
 * Minimal volontaire : site (obligatoire) + titre. Échéance optionnelle. Aucun
 * champ ERP (corps d'état, responsable, priorité…) : le terrain capture, le
 * bureau enrichit ensuite. Sujet = le LIEU, jamais une personne.
 */
export async function createQuickActionAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const siteIdRaw = formData.get('site_id')
  if (typeof siteIdRaw !== 'string' || !IdSchema.safeParse(siteIdRaw).success) {
    return { ok: false, error: 'Site requis' }
  }
  const siteId = siteIdRaw

  // Frontière d'écriture SITE : membership actif à l'org du site + rôle terrain.
  // Remplace `getOrgId()` (org du caller) + la comparaison scalaire.
  const access = await requireSiteWriteAccess(siteId)
  if (!access.ok) return access

  const tParsed = TitleSchema.safeParse(formData.get('title'))
  if (!tParsed.success) return { ok: false, error: tParsed.error.issues[0]?.message ?? 'Titre requis' }

  // Échéance optionnelle.
  let dueDate: string | null = null
  const rawDue = formData.get('due_date')
  if (typeof rawDue === 'string' && rawDue.trim()) {
    if (!DateSchema.safeParse(rawDue).success) return { ok: false, error: 'Échéance invalide' }
    dueDate = rawDue
  }

  const rawFrom = formData.get('created_from')
  const createdFrom = typeof rawFrom === 'string' && (VALID_SOURCES as readonly string[]).includes(rawFrom)
    ? rawFrom
    : null

  // Règle métier distincte de la frontière d'org : un site archivé n'accepte
  // pas de nouvelle action. `requireSiteWriteAccess` a déjà garanti l'existence
  // et l'appartenance ; il reste à écarter l'archivé.
  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('deleted_at')
    .eq('id', siteId)
    .maybeSingle()
  if ((site as { deleted_at: string | null } | null)?.deleted_at) return { ok: false, error: 'Site introuvable' }

  try {
    const id = await createSiteAction({
      site_id: siteId,
      title: tParsed.data,
      due_date: dueDate,
      created_by: access.userId,
      created_from: createdFrom,
    })
    // Usage produit (best-effort) — sert la corrélation brief → action.
    void logUsageEvent({ event: 'action_created', siteId })
    revalidateActionSurfaces(siteId)
    return { ok: true, id }
  } catch {
    return { ok: false, error: 'Échec de la création' }
  }
}
