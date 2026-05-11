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

const moveSchema = z.object({
  interventionId: z.string().uuid(),
  newScheduledFor: z.string().regex(ymdRe, 'Format YYYY-MM-DD requis'),
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
}

// ----------------------------------------------------------------------------
// Helper : "aujourd'hui" UTC yyyy-mm-dd
// ----------------------------------------------------------------------------

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ----------------------------------------------------------------------------
// moveInterventionToDayAction
// ----------------------------------------------------------------------------

/**
 * Replanifie une intervention sur une nouvelle date.
 *
 * Refus :
 *   - intervention introuvable
 *   - intervention non `planned` (immuabilité preuve)
 *   - newScheduledFor < aujourd'hui UTC (pas de replanif rétroactive)
 *
 * Note : on touche UNIQUEMENT `scheduled_for` (date yyyy-mm-dd). `scheduled_at`
 * (timestamp legacy) reste cohérent avec la nouvelle date — on aligne sur
 * 00:00:00 UTC du nouveau jour pour rester déterministe.
 */
export async function moveInterventionToDayAction(
  input: { interventionId: string; newScheduledFor: string }
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
    .select('id, status, scheduled_for, mission_id')
    .eq('id', parsed.data.interventionId)
    .maybeSingle()
  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!existing) return { ok: false, error: 'Intervention introuvable' }
  if (existing.status !== 'planned') {
    return { ok: false, error: 'Intervention déjà démarrée — replanification refusée' }
  }
  if (existing.scheduled_for === parsed.data.newScheduledFor) {
    // No-op : on retourne ok sans toucher la DB pour éviter un audit-log inutile.
    return { ok: true }
  }

  const newScheduledAt = `${parsed.data.newScheduledFor}T00:00:00.000Z`
  const { error: updErr } = await admin
    .from('interventions')
    .update({
      scheduled_for: parsed.data.newScheduledFor,
      scheduled_at: newScheduledAt,
    })
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
    },
  })

  revalidatePath('/semaine')
  return { ok: true }
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
    .select('id, status, assigned_team_id, mission_id')
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
