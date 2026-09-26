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
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeamsForSite } from '@/lib/db/teams'
import { ensurePonctuelMission } from '@/lib/db/system-missions'
import { createIntervention } from '@/lib/db/interventions'

export interface FieldTeamOption {
  id: string
  name: string
  color: string | null
}

/**
 * Équipes affectables à CE chantier, pour le sélecteur du bottom sheet.
 * PLAN-SEC-1 (mandat Vincent 2026-09-26) : jamais l'agrégat multi-org — un
 * conducteur qui gère plusieurs organisations ne doit pas voir l'équipe d'un
 * autre chantier proposée ici.
 */
export async function listFieldTeamsAction(siteId: string): Promise<FieldTeamOption[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  if (!z.string().uuid().safeParse(siteId).success) return []
  const teams = await listTeamsForSite(siteId).catch(() => [])
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

  // Scope org : le chantier ET l'équipe doivent appartenir à l'organisation.
  const [{ data: site }, { data: team }] = await Promise.all([
    supabase.from('sites').select('id, organization_id').eq('id', siteId).is('deleted_at', null).maybeSingle(),
    supabase.from('teams').select('id, organization_id').eq('id', teamId).is('deleted_at', null).maybeSingle(),
  ])
  if (!site) return { ok: false, error: 'Chantier introuvable' }
  if (!site.organization_id) return { ok: false, error: 'Chantier introuvable' }
  if (!team) return { ok: false, error: 'Équipe introuvable' }
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) return { ok: false, error: membership.error }
  if (team.organization_id && team.organization_id !== site.organization_id) {
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
