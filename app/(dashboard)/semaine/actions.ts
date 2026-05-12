'use server'

// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Server actions pour la grille semaine :
//   - moveInterventionToDayAction : replanification (change `scheduled_for`)
//   - reassignInterventionTeamAction : réaffectation équipe (change `assigned_team_id`)
//
// Doctrine V2 impérative (cf. docs/superpowers/doctrines/planning-doctrine.md) :
//
//   « On organise la couverture des engagements. On ne mesure jamais les humains. »
//
// Garde-fous appliqués :
//   - Auth manager+ (admin OU manager)
//   - Une intervention non `planned` est IMMUABLE (preuve) : refus net.
//   - Replanifier vers une date passée : refus (info, pas alarme).
//   - Réassigner vers une équipe inexistante / archivée / inactive : refus.
//   - JAMAIS d'assignment à un user individuel : la cible est une équipe ou
//     `null` (désaffectation). Une PR future qui ajouterait `assigned_to_user_id`
//     est explicitement refusée.
//   - Une PR = un changement à la fois (pas de batch update ici).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { logAuditEvent } from '@/lib/audit/log'
import { createIntervention, bulkInsertChecklistItems } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import type { ChecklistTemplateItem, InterventionSlot } from '@/types/db'

// ----------------------------------------------------------------------------
// Auth helper
// ----------------------------------------------------------------------------

type AuthOk = { userId: string }
type AuthFail = { error: string }

async function requireManagerOrAdmin(): Promise<AuthOk | AuthFail> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }
  return { userId: user.id }
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const ymdRe = /^\d{4}-\d{2}-\d{2}$/
const slotSchema = z.enum(['morning', 'afternoon', 'evening'])

const moveSchema = z.object({
  interventionId: z.string().uuid(),
  newScheduledFor: z.string().regex(ymdRe, 'Format YYYY-MM-DD requis'),
  // Phase 10 — Slice 9.7 : permet de changer le créneau en même temps que la date.
  // undefined = créneau préservé. Le helper hourForSlot ci-dessous gère la
  // synthèse de scheduled_at.
  newSlot: slotSchema.optional(),
})

const reassignSchema = z.object({
  interventionId: z.string().uuid(),
  newTeamId: z.string().uuid().nullable(),
})

// ----------------------------------------------------------------------------
// Result type
// ----------------------------------------------------------------------------

export interface MoveResult {
  ok: boolean
  error?: string
  /** Vrai si l'erreur est un conflit d'affectation équipe — UI affiche toast long. */
  conflict?: boolean
  /** Vrai si l'intervention était `skipped` et vient d'être rattrapée (statut → planned). */
  rescheduled?: boolean
}

// ----------------------------------------------------------------------------
// Helper : "aujourd'hui" UTC yyyy-mm-dd
// ----------------------------------------------------------------------------

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ----------------------------------------------------------------------------
// Helpers : formatage humain pour les messages d'erreur
// ----------------------------------------------------------------------------

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_FR_FULL[(m ?? 1) - 1]} ${y}`
}

function slotLabelFr(slot: InterventionSlot): string {
  return slot === 'morning' ? 'matin' : slot === 'afternoon' ? 'après-midi' : 'soir'
}

// ----------------------------------------------------------------------------
// findTeamSiteConflict — Phase 10
// ----------------------------------------------------------------------------
//
// Vérifie qu'une équipe n'est pas déjà affectée à un AUTRE site au même
// créneau (date+slot). Renvoie le premier conflit trouvé (info nom équipe +
// nom site) ou null si OK.
//
// Règle :
//   - Même équipe sur AUTRE site même créneau = CONFLIT (refus)
//   - Même équipe sur MÊME site même créneau = OK (multi-missions/site)
//   - Pas d'équipe affectée (null) = jamais conflit (skip côté caller)
//   - Interventions terminées (completed/validated) ne comptent PAS — preuve
//     verrouillée, l'équipe historique n'est pas "occupée maintenant"

async function findTeamSiteConflict(args: {
  admin: ReturnType<typeof createAdminClient>
  teamId: string
  /** Mission de l'intervention source — pour résoudre son site_id et l'exclure. */
  missionId: string
  scheduledFor: string
  slot: InterventionSlot
  /** Pour exclure l'intervention en cours de modification de la recherche. */
  excludeInterventionId: string
}): Promise<{ siteName: string; teamName: string } | null> {
  // 1) Résoudre le site de la mission source (à exclure)
  const { data: sourceMission } = await args.admin
    .from('missions')
    .select('site_id')
    .eq('id', args.missionId)
    .maybeSingle()
  const sourceSiteId = sourceMission?.site_id

  // 2) Récupérer toutes les interventions actives de cette équipe au même créneau
  const { data: candidates, error } = await args.admin
    .from('interventions')
    .select(
      `id, mission_id, assigned_team_id,
       team:teams(name),
       mission:missions!inner(site_id, site:sites!inner(id, name))`,
    )
    .neq('id', args.excludeInterventionId)
    .eq('assigned_team_id', args.teamId)
    .eq('scheduled_for', args.scheduledFor)
    .eq('slot', args.slot)
    .in('status', ['planned', 'in_progress'])
  if (error) throw error

  for (const row of (candidates ?? []) as Array<{
    mission: { site: { id: string; name: string } | { id: string; name: string }[] | null } | Array<{ site: { id: string; name: string } | { id: string; name: string }[] | null }> | null
    team: { name: string } | { name: string }[] | null
  }>) {
    const mission = Array.isArray(row.mission) ? row.mission[0] : row.mission
    if (!mission) continue
    const site = Array.isArray(mission.site) ? mission.site[0] : mission.site
    if (!site) continue
    // Conflit uniquement si site DIFFÉRENT du site source
    if (site.id === sourceSiteId) continue
    const team = Array.isArray(row.team) ? row.team[0] : row.team
    return { siteName: site.name, teamName: team?.name ?? 'l\'équipe' }
  }
  return null
}

// ----------------------------------------------------------------------------
// moveInterventionToDayAction
// ----------------------------------------------------------------------------

/**
 * Replanifie une intervention sur une nouvelle date — et optionnellement un
 * nouveau créneau (matin/après-midi/soir).
 *
 * Doctrine V3 — Slice 9.7 :
 *   - Modifie UNIQUEMENT cette intervention. Ne touche jamais la mission
 *     (template). Pour changer le créneau par défaut de toute la récurrence
 *     d'une mission, passer par /missions ou la page édition de la mission.
 *   - L'audit log porte `old_slot` / `new_slot` pour traçabilité.
 *
 * Refus :
 *   - intervention introuvable
 *   - intervention non `planned` (immuabilité preuve)
 *   - newScheduledFor < aujourd'hui UTC (pas de replanif rétroactive)
 *
 * `scheduled_at` (timestamp legacy) est resynthétisé depuis le nouveau créneau
 * via `hourForSlot()` pour rester cohérent avec le seed et l'export.
 */
export async function moveInterventionToDayAction(
  input: {
    interventionId: string
    newScheduledFor: string
    /** Optionnel — si présent, change le créneau en même temps que la date. */
    newSlot?: InterventionSlot
  }
): Promise<MoveResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = moveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  if (parsed.data.newScheduledFor < todayUtcIso()) {
    return { ok: false, error: 'Replanification vers une date passée refusée' }
  }

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await admin
    .from('interventions')
    .select('id, status, scheduled_for, slot, mission_id, assigned_team_id')
    .eq('id', parsed.data.interventionId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'Intervention introuvable' }
  // Doctrine V2 : preuves verrouillées dès in_progress/completed/validated.
  // `planned` = libre. `skipped` = rattrapable (on remet en planned ci-dessous).
  if (existing.status !== 'planned' && existing.status !== 'skipped') {
    return { ok: false, error: 'Intervention déjà démarrée — replanification refusée' }
  }

  // No-op : date identique ET (slot non précisé OU slot identique) ET statut planned
  const slotUnchanged = !parsed.data.newSlot || parsed.data.newSlot === existing.slot
  if (
    existing.status === 'planned' &&
    existing.scheduled_for === parsed.data.newScheduledFor &&
    slotUnchanged
  ) {
    return { ok: true }
  }

  // ----- Détection de conflit équipe vs site/slot -----
  // Règle Vincent (2026-05-12) : une équipe ne peut pas être affectée à deux
  // SITES différents au même créneau (date+slot). Même site multi-mission =
  // OK (plusieurs missions sur le même site, même créneau). Si l'intervention
  // n'a pas d'équipe (Non-affecté) → aucun conflit possible, skip.
  const effectiveSlotForCheck = (parsed.data.newSlot ?? existing.slot) as InterventionSlot | null
  if (existing.assigned_team_id && effectiveSlotForCheck) {
    const conflict = await findTeamSiteConflict({
      admin,
      teamId: existing.assigned_team_id,
      missionId: existing.mission_id,
      scheduledFor: parsed.data.newScheduledFor,
      slot: effectiveSlotForCheck,
      excludeInterventionId: parsed.data.interventionId,
    })
    if (conflict) {
      return {
        ok: false,
        conflict: true,
        error:
          `Conflit : l'équipe ${conflict.teamName} est déjà affectée à ${conflict.siteName}` +
          ` le ${formatDateFr(parsed.data.newScheduledFor)} créneau ${slotLabelFr(effectiveSlotForCheck)}.` +
          ` Une équipe ne peut pas couvrir deux sites au même créneau.`,
      }
    }
  }

  // Synthèse de scheduled_at (timestamp legacy) : date + heure du créneau cible.
  // Si newSlot non fourni, on conserve le slot existant pour l'heure ; sinon 0h.
  const effectiveSlot = (parsed.data.newSlot ?? existing.slot) as InterventionSlot | null
  const hour = effectiveSlot ? hourForSlot(effectiveSlot) : 0
  const newScheduledAt = `${parsed.data.newScheduledFor}T${String(hour).padStart(2, '0')}:00:00.000Z`

  const updates: Record<string, unknown> = {
    scheduled_for: parsed.data.newScheduledFor,
    scheduled_at: newScheduledAt,
  }
  if (parsed.data.newSlot) {
    updates.slot = parsed.data.newSlot
  }
  // Si on rattrape une intervention `skipped`, on la repasse en `planned` et
  // on efface les marqueurs de skip (raison, date, auteur). C'est le sens
  // exact de "rattraper" : redonner la possibilité de l'exécuter.
  if (existing.status === 'skipped') {
    updates.status = 'planned'
    updates.skipped_at = null
    updates.skipped_reason = null
    updates.skipped_by = null
  }

  const { error: updErr } = await admin
    .from('interventions')
    .update(updates)
    .eq('id', parsed.data.interventionId)
  if (updErr) return { ok: false, error: updErr.message }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: existing.mission_id,
    action: 'updated',
    metadata: {
      kind: 'intervention_moved',
      intervention_id: parsed.data.interventionId,
      old_scheduled_for: existing.scheduled_for,
      new_scheduled_for: parsed.data.newScheduledFor,
      old_slot: existing.slot,
      new_slot: parsed.data.newSlot ?? existing.slot,
    },
  })

  revalidatePath('/semaine')
  return { ok: true, rescheduled: existing.status === 'skipped' }
}

// ----------------------------------------------------------------------------
// createInterventionFromWeekAction
// ----------------------------------------------------------------------------

const slotEnum = z.enum(['morning', 'afternoon', 'evening'])

const createFromWeekSchema = z.object({
  missionId: z.string().uuid(),
  scheduledFor: z.string().regex(ymdRe, 'Format YYYY-MM-DD requis'),
  slot: slotEnum,
  // null = "Non-affecté" explicite ; undefined = hériter de la mission.
  teamId: z.string().uuid().nullable().optional(),
})

/** Heure UTC associée à un créneau (doctrine V2 : pas d'heure exposée à l'UX,
 * mais il faut une valeur stable pour `scheduled_at` legacy). */
function hourForSlot(slot: InterventionSlot): number {
  return slot === 'morning' ? 7 : slot === 'afternoon' ? 13 : 18
}

export interface CreateFromWeekResult {
  ok: boolean
  error?: string
  interventionId?: string
}

/**
 * Crée une intervention `planned` depuis la Vue Semaine. Mission obligatoire.
 *
 * - Refus si date passée (pas de planif rétroactive — même règle que `move`).
 * - Matérialise la checklist depuis `mission.default_checklist` (instance =
 *   copie indépendante du template, doctrine "instance vs template" Phase 5).
 * - Réutilise l'équipe par défaut de la mission (`assigned_team_id`) si présente.
 */
export async function createInterventionFromWeekAction(
  input: {
    missionId: string
    scheduledFor: string
    slot: InterventionSlot
    /** `null` = "Non-affecté" explicite. `undefined` = hériter de `mission.assigned_team_id`. */
    teamId?: string | null
  }
): Promise<CreateFromWeekResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = createFromWeekSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  if (parsed.data.scheduledFor < todayUtcIso()) {
    return { ok: false, error: 'Planification vers une date passée refusée' }
  }

  const mission = await getMission(parsed.data.missionId)
  if (!mission) return { ok: false, error: 'Mission introuvable' }

  const admin = createAdminClient()

  // Résolution de l'équipe :
  //   undefined  → hériter de mission.assigned_team_id
  //   null       → forcer "Non-affecté"
  //   uuid       → valider que l'équipe est active + non archivée
  const teamFromInput = parsed.data.teamId
  let finalTeamId: string | null
  if (teamFromInput === undefined) {
    finalTeamId = mission.assigned_team_id
  } else if (teamFromInput === null) {
    finalTeamId = null
  } else {
    const { data: team, error: tErr } = await admin
      .from('teams')
      .select('id, active, deleted_at')
      .eq('id', teamFromInput)
      .maybeSingle()
    if (tErr) return { ok: false, error: tErr.message }
    if (!team || team.deleted_at !== null || team.active === false) {
      return { ok: false, error: 'Équipe inconnue ou archivée' }
    }
    finalTeamId = teamFromInput
  }

  // Vérif conflit d'équipe AVANT insertion : si l'équipe finale est non-null,
  // on s'assure qu'elle n'est pas déjà sur un autre site au même créneau.
  if (finalTeamId) {
    const conflict = await findTeamSiteConflict({
      admin,
      teamId: finalTeamId,
      missionId: parsed.data.missionId,
      scheduledFor: parsed.data.scheduledFor,
      slot: parsed.data.slot,
      excludeInterventionId: '00000000-0000-0000-0000-000000000000', // pas encore créée
    })
    if (conflict) {
      return {
        ok: false,
        error:
          `Conflit : l'équipe ${conflict.teamName} est déjà affectée à ${conflict.siteName}` +
          ` le ${formatDateFr(parsed.data.scheduledFor)} créneau ${slotLabelFr(parsed.data.slot)}.` +
          ` Une équipe ne peut pas couvrir deux sites au même créneau.`,
      }
    }
  }

  const hour = hourForSlot(parsed.data.slot)
  const scheduledAt = `${parsed.data.scheduledFor}T${String(hour).padStart(2, '0')}:00:00.000Z`

  const interventionId = await createIntervention({
    mission_id: parsed.data.missionId,
    scheduled_at: scheduledAt,
    created_by: auth.userId,
  })

  // Matérialiser la checklist de la mission (template → instance)
  const template = (mission.default_checklist ?? []) as ChecklistTemplateItem[]
  if (template.length > 0) {
    await bulkInsertChecklistItems(
      template.map((item, idx) => ({
        intervention_id: interventionId,
        engagement_id: item.engagement_id ?? null,
        label: item.label,
        position: item.position ?? idx + 1,
        required: item.required ?? false,
      })),
    )
  }

  if (finalTeamId !== null) {
    await admin
      .from('interventions')
      .update({ assigned_team_id: finalTeamId })
      .eq('id', interventionId)
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: parsed.data.missionId,
    action: 'created',
    metadata: {
      kind: 'intervention_created_from_week',
      intervention_id: interventionId,
      scheduled_for: parsed.data.scheduledFor,
      slot: parsed.data.slot,
      team_id: finalTeamId,
    },
  })

  revalidatePath('/semaine')
  return { ok: true, interventionId }
}

// ----------------------------------------------------------------------------
// reassignInterventionTeamAction
// ----------------------------------------------------------------------------

/**
 * Réaffecte une intervention à une nouvelle équipe (ou désaffecte si `null`).
 *
 * Refus :
 *   - intervention introuvable
 *   - intervention non `planned` (immuabilité preuve)
 *   - newTeamId pointe vers une équipe archivée (`deleted_at NOT NULL`) ou inactive
 *
 * Note doctrinale : on accepte explicitement `newTeamId = null` (désaffectation
 * = signal "Non-affecté" ambre discret). C'est un signal logistique normal,
 * jamais une alarme.
 */
export async function reassignInterventionTeamAction(
  input: { interventionId: string; newTeamId: string | null }
): Promise<MoveResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = reassignSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await admin
    .from('interventions')
    .select('id, status, scheduled_for, slot, assigned_team_id, mission_id')
    .eq('id', parsed.data.interventionId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'Intervention introuvable' }
  if (existing.status !== 'planned') {
    return { ok: false, error: 'Intervention déjà démarrée — réassignation refusée' }
  }

  // Vérifie l'équipe cible si non nulle
  if (parsed.data.newTeamId !== null) {
    const { data: team, error: tErr } = await admin
      .from('teams')
      .select('id, active, deleted_at')
      .eq('id', parsed.data.newTeamId)
      .maybeSingle()
    if (tErr) return { ok: false, error: tErr.message }
    if (!team || team.deleted_at !== null || team.active === false) {
      return { ok: false, error: 'Équipe inconnue ou archivée' }
    }
  }

  if (existing.assigned_team_id === parsed.data.newTeamId) {
    // No-op
    return { ok: true }
  }

  // Détection de conflit d'équipe : la nouvelle équipe ne doit pas déjà être
  // sur un autre site au même créneau (si elle a un slot connu).
  if (parsed.data.newTeamId && existing.slot && existing.scheduled_for) {
    const conflict = await findTeamSiteConflict({
      admin,
      teamId: parsed.data.newTeamId,
      missionId: existing.mission_id,
      scheduledFor: existing.scheduled_for,
      slot: existing.slot as InterventionSlot,
      excludeInterventionId: parsed.data.interventionId,
    })
    if (conflict) {
      return {
        ok: false,
        conflict: true,
        error:
          `Conflit : l'équipe ${conflict.teamName} est déjà affectée à ${conflict.siteName}` +
          ` le ${formatDateFr(existing.scheduled_for)} créneau ${slotLabelFr(existing.slot as InterventionSlot)}.` +
          ` Une équipe ne peut pas couvrir deux sites au même créneau.`,
      }
    }
  }

  const { error: updErr } = await admin
    .from('interventions')
    .update({ assigned_team_id: parsed.data.newTeamId })
    .eq('id', parsed.data.interventionId)
  if (updErr) return { ok: false, error: updErr.message }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: existing.mission_id,
    action: 'updated',
    metadata: {
      kind: 'intervention_team_reassigned',
      intervention_id: parsed.data.interventionId,
      old_team_id: existing.assigned_team_id,
      new_team_id: parsed.data.newTeamId,
    },
  })

  revalidatePath('/semaine')
  return { ok: true }
}

// ----------------------------------------------------------------------------
// extendMoveToTemplateAction — DÉSACTIVÉE (doctrine /semaine punctuel-only)
// ----------------------------------------------------------------------------
//
// 🚫 Décision Vincent 2026-05-12 : la page /semaine ne doit JAMAIS modifier
// une mission ou son template. Toute modification depuis /semaine est PONCTUELLE
// (une seule intervention). Pour modifier une mission complète (récurrence,
// fréquence, équipe par défaut, créneaux), l'utilisateur doit aller dans
// /missions ou la page édition de la mission.
//
// Cette action existait dans un premier jet ; elle est désactivée pour rester
// alignée avec la doctrine. Le code est conservé en `false &&` pour pouvoir
// être réactivé si la doctrine change un jour — mais ce serait une rupture
// produit majeure (cf. docs/superpowers/doctrines/refusals-log.md).
//
// Si tu lis ce commentaire et envisages de réactiver : relis d'abord la
// doctrine V3 § "L'UI parle d'événements" et le refusals-log.

const extendSchema = z.object({
  interventionId: z.string().uuid(),
})

export interface ExtendResult {
  ok: boolean
  error?: string
  summary?: string
}

async function _extendMoveToTemplateAction_DISABLED(input: {
  interventionId: string
}): Promise<ExtendResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = extendSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const admin = createAdminClient()

  // 1) Récupère l'intervention pour connaître son template_id, slot, scheduled_for
  const { data: intv, error: intvErr } = await admin
    .from('interventions')
    .select('id, template_id, slot, scheduled_for, scheduled_at, mission_id')
    .eq('id', parsed.data.interventionId)
    .maybeSingle()
  if (intvErr) return { ok: false, error: intvErr.message }
  if (!intv) return { ok: false, error: 'Intervention introuvable' }
  if (!intv.template_id) {
    return {
      ok: false,
      error:
        'Cette intervention n\'a pas de récurrence. Pour la rendre récurrente, va dans Missions.',
    }
  }
  if (!intv.scheduled_for || !intv.slot) {
    return { ok: false, error: 'Date ou créneau manquant sur l\'intervention' }
  }

  // 2) Récupère le template
  const { data: tpl, error: tplErr } = await admin
    .from('intervention_templates')
    .select('id, frequency, slots, day_of_week, day_of_month, mission_id')
    .eq('id', intv.template_id)
    .maybeSingle()
  if (tplErr) return { ok: false, error: tplErr.message }
  if (!tpl) return { ok: false, error: 'Template introuvable' }
  if (tpl.frequency === 'one_shot') {
    return {
      ok: false,
      error: 'Récurrence one-shot — rien à étendre (une seule occurrence prévue).',
    }
  }

  // 3) Calcule les nouvelles valeurs
  const updates: Record<string, unknown> = {}

  // Slots : remplace toute occurrence de l'ancien slot par le nouveau, dedup.
  // Si template.slots est null/vide, on initialise avec [newSlot].
  const oldSlots = (tpl.slots as InterventionSlot[] | null) ?? []
  const newSlot = intv.slot as InterventionSlot
  // On ne connaît pas l'ANCIEN slot d'origine (avant déplacement) → on remplace
  // l'absence par le nouveau. Si oldSlots ne contient pas newSlot, on l'ajoute.
  // Si oldSlots contient déjà newSlot, no-op sur ce champ.
  if (!oldSlots.includes(newSlot)) {
    updates.slots = [...oldSlots, newSlot]
  }

  // Day of week / day of month selon fréquence
  if (tpl.frequency === 'weekly') {
    const dow = new Date(intv.scheduled_for + 'T00:00:00Z').getUTCDay()
    // ISO 8601 : lundi=1 ... dimanche=7
    const isoDow = dow === 0 ? 7 : dow
    if (tpl.day_of_week !== isoDow) {
      updates.day_of_week = isoDow
    }
  } else if (tpl.frequency === 'monthly') {
    const dom = Number(intv.scheduled_for.split('-')[2])
    if (tpl.day_of_month !== dom) {
      updates.day_of_month = dom
    }
  }

  if (Object.keys(updates).length === 0) {
    return {
      ok: true,
      summary: 'Le template est déjà aligné avec cette intervention — aucune mise à jour nécessaire.',
    }
  }

  // 4) Update
  const { error: updErr } = await admin
    .from('intervention_templates')
    .update(updates)
    .eq('id', tpl.id)
  if (updErr) return { ok: false, error: updErr.message }

  // 5) Audit
  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: tpl.mission_id,
    action: 'updated',
    metadata: {
      kind: 'template_extended_from_move',
      intervention_id: parsed.data.interventionId,
      template_id: tpl.id,
      updates,
    },
  })

  // 6) Résumé pour toast
  const dayNames = ['', 'lundis', 'mardis', 'mercredis', 'jeudis', 'vendredis', 'samedis', 'dimanches']
  const slotLabels: Record<InterventionSlot, string> = {
    morning: 'matin',
    afternoon: 'après-midi',
    evening: 'soir',
  }
  let summary = 'Récurrence mise à jour'
  if (tpl.frequency === 'weekly' && typeof updates.day_of_week === 'number') {
    summary = `Tous les ${dayNames[updates.day_of_week as number] ?? 'jours'} · ${slotLabels[newSlot]}`
  } else if (tpl.frequency === 'monthly' && typeof updates.day_of_month === 'number') {
    summary = `Le ${updates.day_of_month} du mois · ${slotLabels[newSlot]}`
  } else {
    summary = `Créneau ${slotLabels[newSlot]} ajouté à la récurrence`
  }

  revalidatePath('/semaine')
  return { ok: true, summary }
}
