'use server'

// Intervention ponctuelle mobile (A2, mig 189).
//
// Le conducteur crée depuis le terrain une intervention « une fois » : chantier +
// équipe + date + créneau/heure + objet. Elle s'accroche à la mission système
// « Interventions ponctuelles » du chantier (invisible comme concept), mais reste
// un VRAI événement terrain, affiché partout via `intervention.label`.
//
// Le mot « mission » n'apparaît jamais dans ce flux.

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeams } from '@/lib/db/teams'
import { ensurePonctuelMission } from '@/lib/db/system-missions'
import { createIntervention } from '@/lib/db/interventions'

export interface FieldTeamOption {
  id: string
  name: string
  color: string | null
}

/** Équipes de l'organisation, pour le sélecteur du bottom sheet. */
export async function listFieldTeamsAction(): Promise<FieldTeamOption[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  const teams = await listTeams().catch(() => [])
  return teams.map((t) => ({ id: t.id, name: t.name, color: t.color ?? null }))
}

const Schema = z.object({
  siteId: z.string().uuid(),
  teamId: z.string().uuid(),
  // yyyy-mm-dd
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['morning', 'afternoon', 'evening']).optional(),
  // HH:MM (24h) — optionnel ; affine le créneau si fourni.
  hhmm: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  label: z.string().trim().min(1).max(200),
  comment: z.string().trim().max(1000).optional(),
})

export async function createPonctuelInterventionAction(
  input: unknown,
): Promise<{ ok: true; interventionId: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const { siteId, teamId, date, slot, hhmm, label, comment } = parsed.data

  const supabase = createAdminClient()
  const orgId = await getOrgId()

  // Scope org : le chantier ET l'équipe doivent appartenir à l'organisation.
  const [{ data: site }, { data: team }] = await Promise.all([
    supabase.from('sites').select('id, organization_id').eq('id', siteId).is('deleted_at', null).maybeSingle(),
    supabase.from('teams').select('id, organization_id').eq('id', teamId).is('deleted_at', null).maybeSingle(),
  ])
  if (!site) return { ok: false, error: 'Chantier introuvable' }
  if (!team) return { ok: false, error: 'Équipe introuvable' }
  if (orgId && (site as { organization_id: string | null }).organization_id && (site as { organization_id: string }).organization_id !== orgId) {
    return { ok: false, error: 'Chantier hors organisation' }
  }
  if (orgId && (team as { organization_id: string | null }).organization_id && (team as { organization_id: string }).organization_id !== orgId) {
    return { ok: false, error: 'Équipe hors organisation' }
  }

  try {
    const mission = await ensurePonctuelMission(siteId, auth.userId)
    const interventionId = await createIntervention({
      mission_id: mission.id,
      scheduled_for: date,
      // createIntervention exige (scheduled_for + slot) ; l'heure précise, si
      // fournie, recalcule le créneau derrière. Défaut : matin.
      slot: slot ?? 'morning',
      ...(hhmm ? { planned_start_hhmm: hhmm } : {}),
      assigned_team_id: teamId,
      label,
      note: comment ?? null,
      created_by: auth.userId,
    })
    return { ok: true, interventionId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur'
    return { ok: false, error: `Création impossible : ${msg}` }
  }
}
