'use server'

// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Server actions de gestion des équipes. Auth manager+ (admin OU manager).
//
// Doctrine V2 :
//   L'équipe = conteneur logistique. Ces actions n'exposent jamais de
//   métrique ; elles ne touchent qu'à la composition + au cycle de vie.
//
// archiveTeamAction = soft-delete via deleted_at + désaffectation des
// missions/interventions PLANIFIÉES (cf. lib/db/teams.ts pour la règle
// d'immuabilité de la preuve sur les statuts terminaux).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  createTeam,
  updateTeam,
  archiveTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  getTeam,
  setTeamReferent,
} from '@/lib/db/teams'
import { logAuditEvent } from '@/lib/audit/log'
import { TEAM_BADGE_COLORS } from '@/components/ui/team-badge'

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

const colorSchema = z
  .enum(TEAM_BADGE_COLORS as unknown as [string, ...string[]])
  .nullable()
  .optional()

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(50, '50 caractères max'),
  color: colorSchema,
})

const updateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().trim().min(1).max(50).optional(),
  color: colorSchema,
  active: z.boolean().optional(),
})

const archiveSchema = z.object({
  teamId: z.string().uuid(),
})

const memberSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
})

// ----------------------------------------------------------------------------
// Results
// ----------------------------------------------------------------------------

export interface CreateTeamResult {
  ok: boolean
  error?: string
  teamId?: string
}
export interface MutateTeamResult {
  ok: boolean
  error?: string
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

export async function createTeamAction(input: {
  name: string
  color?: string | null
}): Promise<CreateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  try {
    const team = await createTeam({
      name: parsed.data.name,
      color: parsed.data.color ?? undefined,
      created_by: auth.userId,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: team.id,
      action: 'created',
      metadata: { kind: 'team', name: team.name, color: team.color },
    })
    revalidatePath('/equipes')
    return { ok: true, teamId: team.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création équipe'
    // Erreur d'unicité Postgres (idx_teams_name_active)
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: false, error: 'Une équipe avec ce nom existe déjà' }
    }
    return { ok: false, error: msg }
  }
}

export async function updateTeamAction(input: {
  teamId: string
  name?: string
  color?: string | null
  active?: boolean
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    const team = await updateTeam(parsed.data.teamId, {
      name: parsed.data.name,
      color: parsed.data.color,
      active: parsed.data.active,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: team.id,
      action: 'updated',
      metadata: {
        kind: 'team',
        name: team.name,
        color: team.color,
        active: team.active,
      },
    })
    revalidatePath('/equipes')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur modification équipe'
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: false, error: 'Une équipe avec ce nom existe déjà' }
    }
    return { ok: false, error: msg }
  }
}

export async function archiveTeamAction(input: {
  teamId: string
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = archiveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    await archiveTeam(parsed.data.teamId)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.teamId,
      action: 'soft_deleted',
      metadata: { kind: 'team', name: existing.name },
    })
    revalidatePath('/equipes')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur archivage équipe'
    return { ok: false, error: msg }
  }
}

export async function addMemberToTeamAction(input: {
  teamId: string
  userId: string
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    await addMemberToTeam(parsed.data.teamId, parsed.data.userId)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.teamId,
      action: 'updated',
      metadata: {
        kind: 'team_member_added',
        team_id: parsed.data.teamId,
        user_id: parsed.data.userId,
      },
    })
    revalidatePath('/equipes')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur ajout du membre"
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: false, error: 'Cette personne est déjà membre de l’équipe' }
    }
    return { ok: false, error: msg }
  }
}

export async function removeMemberFromTeamAction(input: {
  teamId: string
  userId: string
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    await removeMemberFromTeam(parsed.data.teamId, parsed.data.userId)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.teamId,
      action: 'updated',
      metadata: {
        kind: 'team_member_removed',
        team_id: parsed.data.teamId,
        user_id: parsed.data.userId,
      },
    })
    revalidatePath('/equipes')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur retrait du membre'
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// setTeamReferentAction — Phase 10
// ----------------------------------------------------------------------------

const setReferentSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
})

/**
 * Désigne un référent d'équipe (point de contact stable). `null` = retire le
 * référent sans remplaçant (transition tolérée, doctrine V3).
 *
 * Pas de vérif "le user doit être membre de l'équipe" — toléré pour ne pas
 * bloquer les transitions (départ, congé). L'UI signalera mais ne bloquera pas.
 */
export async function setTeamReferentAction(input: {
  teamId: string
  userId: string | null
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = setReferentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    await setTeamReferent({
      teamId: parsed.data.teamId,
      userId: parsed.data.userId,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.teamId,
      action: 'updated',
      metadata: {
        kind: 'team_referent_changed',
        team_id: parsed.data.teamId,
        new_referent_user_id: parsed.data.userId,
      },
    })
    revalidatePath('/equipes')
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur changement de référent'
    return { ok: false, error: msg }
  }
}
