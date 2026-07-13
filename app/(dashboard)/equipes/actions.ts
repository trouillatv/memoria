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
import { requireOwned } from '@/lib/auth/ownership'
import type { UserRole } from '@/types/db'
import { TEAM_BADGE_COLORS } from '@/components/ui/team-badge'
// team-meta = SERVER-SAFE. Ne JAMAIS réimporter ces constantes depuis
// team-icon-picker / team-specialties ('use client') : côté serveur elles
// deviennent des références client opaques et l'action plante (bug 2026-06-23).
import { TEAM_ICON_KEYS, TEAM_SPECIALTY_MAX } from '@/components/ui/team-meta'

// ----------------------------------------------------------------------------
// Auth helper
// ----------------------------------------------------------------------------

type AuthOk = { userId: string; role: UserRole }
type AuthFail = { error: string }

async function requireManagerOrAdmin(): Promise<AuthOk | AuthFail> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }
  return { userId: user.id, role }
}

/** Lot S — l'équipe mutée doit appartenir à l'organisation de l'appelant
 *  (getTeam() n'est pas scopé : sans cette garde, un teamId d'un autre tenant
 *  passait). Admin = super-admin plateforme, exempté. */
async function guardTeam(role: UserRole, teamId: string): Promise<string | null> {
  const owned = await requireOwned(role, 'teams', teamId)
  return owned.allowed ? null : owned.error
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

// Vincent 2026-05-21 (migration 077) — color accepte :
//   - null (« Aucune »)
//   - un des noms historiques (sky/emerald/amber/violet/rose/slate)
//   - un hex #rrggbb (insensible casse)
// Le CHECK DB `chk_teams_color_format` redouble la validation côté Postgres.
const NAMED_COLOR_VALUES = TEAM_BADGE_COLORS as unknown as readonly string[]
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const colorSchema = z
  .union([
    z.null(),
    z.string().refine(
      (v) => NAMED_COLOR_VALUES.includes(v) || HEX_RE.test(v),
      'Couleur invalide : nom whitelisté ou #rrggbb attendu',
    ),
  ])
  .optional()

// Vincent 2026-05-21 (migration 077) — icône lucide (kebab-case),
// whitelist applicative côté UI (TEAM_ICON_KEYS).
const ICON_VALUES = TEAM_ICON_KEYS as unknown as readonly string[]
const iconSchema = z
  .union([
    z.null(),
    z.string().refine(
      (v) => ICON_VALUES.includes(v),
      'Icône non reconnue',
    ),
  ])
  .optional()

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(50, '50 caractères max'),
  color: colorSchema,
  icon: iconSchema,
})

const updateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().trim().min(1).max(50).optional(),
  color: colorSchema,
  icon: iconSchema,
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
  icon?: string | null
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
      color: parsed.data.color ?? null,
      icon: parsed.data.icon ?? null,
      created_by: auth.userId,
    })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: team.id,
      action: 'created',
      metadata: { kind: 'team', name: team.name, color: team.color, icon: team.icon },
    })
    // Règle d'or (lot R) : l'équipe apparaît aussi dans le sélecteur de /semaine.
    revalidatePath('/equipes')
    revalidatePath('/semaine')
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
  icon?: string | null
  active?: boolean
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    const team = await updateTeam(parsed.data.teamId, {
      name: parsed.data.name,
      color: parsed.data.color,
      icon: parsed.data.icon,
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
        icon: team.icon,
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
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

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
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

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
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

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
// setTeamSpecialtiesAction — Sprint Équipes B (Vincent 2026-05-21)
//
// Spécialités déclarées (catalogue métier de l'org). Doctrine V2 :
//   - Tags DÉCLARATIFS par le manager
//   - Jamais inférés, jamais comparatifs
//   - Max 12 (cf. TEAM_SPECIALTY_MAX + chk_teams_specialties_format)
//
// Validation = FORMAT (pas une whitelist figée) : on miroite exactement le
// CHECK SQL `chk_teams_specialties_format` (^[a-z0-9-]+$, ≤32 car., ≤12). Ça
// laisse passer les clés de n'importe quel métier (catalogue construction/
// maintenance), tout en gardant l'invariant de sécurité côté base.
// ----------------------------------------------------------------------------

const SPECIALTY_KEY_RE = /^[a-z0-9-]+$/
const setSpecialtiesSchema = z.object({
  teamId: z.string().uuid(),
  specialties: z
    .array(
      z
        .string()
        .min(1)
        .max(32)
        .regex(SPECIALTY_KEY_RE, 'Format de spécialité invalide'),
    )
    .max(TEAM_SPECIALTY_MAX, `Max ${TEAM_SPECIALTY_MAX} spécialités`),
})

export async function setTeamSpecialtiesAction(input: {
  teamId: string
  specialties: string[]
}): Promise<MutateTeamResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = setSpecialtiesSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

  const existing = await getTeam(parsed.data.teamId)
  if (!existing) return { ok: false, error: 'Équipe introuvable' }

  try {
    // Dédup + tri pour stabilité (impact UI minimal entre 2 saisies équivalentes)
    const dedup = Array.from(new Set(parsed.data.specialties)).sort()
    await updateTeam(parsed.data.teamId, { specialties: dedup })
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'site',
      entityId: parsed.data.teamId,
      action: 'updated',
      metadata: {
        kind: 'team_specialties_changed',
        team_id: parsed.data.teamId,
        specialties: dedup,
      },
    })
    revalidatePath('/equipes')
    revalidatePath(`/equipes/${parsed.data.teamId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur mise à jour des spécialités'
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
  const denied = await guardTeam(auth.role, parsed.data.teamId)
  if (denied) return { ok: false, error: denied }

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
