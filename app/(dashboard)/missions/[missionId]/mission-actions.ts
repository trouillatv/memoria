'use server'

// La mission dit QUI la porte.
//
// `missions.assigned_team_id` existait depuis la mig 023 et n'était écrit par
// AUCUN écran — seuls les scripts de seed le posaient. Conséquence en
// production : toute intervention générée par un rythme naissait
// « Non-affectée », et le planning ne disait pas qui y allait.
//
// C'est une ÉQUIPE, jamais une personne (doctrine : le planning nominatif est
// une ligne rouge). Une équipe d'une personne est autorisée.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateMission } from '@/lib/db/missions'
import { logAuditEvent } from '@/lib/audit/log'

type Result = { ok: true } | { error: string }

const schema = z.object({
  missionId: z.string().uuid(),
  /** null = « Non affectée » (choix explicite, pas un oubli). */
  teamId: z.string().uuid().nullable(),
})

export async function setMissionTeamAction(input: unknown): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: 'Champs invalides' }

  // Garde d'appartenance (lot S) : jamais la mission d'un autre tenant.
  const owned = await requireOwned(auth.role, 'missions', parsed.data.missionId)
  if (!owned.allowed) return { error: owned.error }

  // L'équipe cible doit exister, être active et venir de la même organisation.
  if (parsed.data.teamId) {
    const ownedTeam = await requireOwned(auth.role, 'teams', parsed.data.teamId)
    if (!ownedTeam.allowed) return { error: 'Équipe inconnue' }
    const { data: team } = await createAdminClient()
      .from('teams')
      .select('id, active, deleted_at')
      .eq('id', parsed.data.teamId)
      .maybeSingle()
    if (!team || (team as { deleted_at: string | null }).deleted_at !== null || (team as { active: boolean }).active === false) {
      return { error: 'Équipe inconnue ou archivée' }
    }
  }

  await updateMission(parsed.data.missionId, { assigned_team_id: parsed.data.teamId })

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'mission',
    entityId: parsed.data.missionId,
    action: 'updated',
    metadata: { kind: 'mission_team', team_id: parsed.data.teamId },
  })

  // Règle d'or : tous les paths qui affichent l'équipe de la mission.
  revalidatePath(`/missions/${parsed.data.missionId}`)
  revalidatePath('/missions')
  revalidatePath('/semaine')
  return { ok: true }
}
