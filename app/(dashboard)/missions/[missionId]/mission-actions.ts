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
import { requireTeamCompatibleWithOrg } from '@/lib/auth/team-compatibility'
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

  // L'équipe cible doit exister, être active et venir de la même organisation
  // que le CHANTIER RÉEL de la mission (PLAN-SEC-1 — resource-vs-resource,
  // insuffisant de vérifier que l'appelant a accès à l'équipe).
  if (parsed.data.teamId) {
    const admin = createAdminClient()
    const { data: mission } = await admin.from('missions').select('site_id').eq('id', parsed.data.missionId).maybeSingle()
    if (!mission) return { error: 'Mission introuvable' }
    const { data: site } = await admin.from('sites').select('organization_id').eq('id', mission.site_id).maybeSingle()
    if (!site) return { error: 'Chantier introuvable' }
    const compatibleTeam = await requireTeamCompatibleWithOrg(parsed.data.teamId, site.organization_id)
    if (!compatibleTeam.allowed) return { error: compatibleTeam.error }
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
