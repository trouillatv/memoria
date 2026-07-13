'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { requireOwned } from '@/lib/auth/ownership'
import {
  countInterventionsForMission,
  softDeleteMission,
  hardDeleteMission,
} from '@/lib/db/missions'
import { decideMissionRemoval } from '@/lib/removal/policy'
import { logAuditEvent } from '@/lib/audit/log'

const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'on_demand'] as const

const createMissionSchema = z.object({
  site_id: z.string().uuid('Site requis'),
  name: z.string().min(1, 'Nom requis').max(200),
  cadence: z.enum(CADENCES),
  description: z.string().max(500).optional(),
})

export type CreateMissionResult = { ok: true; missionId: string } | { error: string }

export async function createMissionAction(formData: FormData): Promise<CreateMissionResult> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }

  const parsed = createMissionSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    cadence: formData.get('cadence'),
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }

  // Lot S : on ne crée pas une mission dans le chantier d'un autre tenant.
  const owned = await requireOwned(role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { error: owned.error }

  const admin = createAdminClient()
  // P1 isolation : l'organisation vient du CHANTIER (pas de la session) —
  // une mission sans org serait invisible sur toute surface scopée
  // (bug réel : « Entretien du magasin » née orpheline le 2026-07-13).
  const { data: site } = await admin
    .from('sites')
    .select('organization_id')
    .eq('id', parsed.data.site_id)
    .maybeSingle()
  if (!site?.organization_id) return { error: 'Chantier sans organisation — création impossible' }

  const { data, error } = await admin
    .from('missions')
    .insert({
      site_id: parsed.data.site_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      description: parsed.data.description ?? null,
      created_by: user.id,
      organization_id: site.organization_id,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Impossible de créer la mission' }

  // Règle d'or (lot R) : la mission apparaît aussi dans le picker de /semaine.
  revalidatePath('/missions')
  revalidatePath('/semaine')
  return { ok: true, missionId: data.id }
}

// ── Retirer une mission (lot D) ─────────────────────────────────────────────
// Un seul verbe côté utilisateur : « Retirer ». En interne, la doctrine
// (audit/03) décide : essai vierge → supprimé pour de bon ; mission avec des
// interventions → retirée des écrans, preuves conservées.

export type RemoveMissionResult =
  | { ok: true; mode: 'hard' | 'soft' }
  | { error: string }

export async function removeMissionAction(missionId: string): Promise<RemoveMissionResult> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }

  if (!z.string().uuid().safeParse(missionId).success) return { error: 'Identifiant invalide' }

  // Lot S : on ne retire pas la mission d'un autre tenant.
  const owned = await requireOwned(role, 'missions', missionId)
  if (!owned.allowed) return { error: owned.error }

  const admin = createAdminClient()
  const { data: mission } = await admin
    .from('missions')
    .select('id, site_id')
    .eq('id', missionId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!mission) return { error: 'Mission introuvable' }

  const count = await countInterventionsForMission(missionId)
  const decision = decideMissionRemoval(count)
  if (!decision.allowed) return { error: decision.reason }

  if (decision.mode === 'hard') await hardDeleteMission(missionId)
  else await softDeleteMission(missionId)

  await logAuditEvent({
    userId: user.id,
    entityType: 'mission',
    entityId: missionId,
    action: 'removed',
    metadata: { kind: 'mission_removed', mode: decision.mode, intervention_count: count },
  })

  // Règle d'or : tous les paths qui affichaient la mission.
  revalidatePath('/missions')
  revalidatePath('/semaine')
  const siteId = (mission as { site_id: string }).site_id
  if (siteId) {
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}`)
  }
  return { ok: true, mode: decision.mode }
}
