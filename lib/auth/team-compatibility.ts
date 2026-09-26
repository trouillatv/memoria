import 'server-only'

// PLAN-SEC-1 (mandat Vincent 2026-09-26) — garde de COMPATIBILITÉ ressource-vs-
// ressource, distincte de `requireOwned` (caller-vs-ressource, lib/auth/ownership.ts).
//
// `requireOwned(role, 'teams', teamId)` répond uniquement à « l'appelant a-t-il
// le droit d'agir sur CETTE équipe (i.e. est-il membre de l'organisation de
// l'équipe) ? ». Il ne dit RIEN sur la compatibilité entre l'équipe choisie et
// l'objet métier (mission, site, intervention, cycle de roulement) auquel on
// l'affecte. Un appelant multi-organisation, membre légitime des deux org,
// pouvait donc affecter une équipe de l'organisation B à un objet de
// l'organisation A — c'est CE trou que cette primitive ferme.
//
// Usage type, APRÈS requireOwned sur l'objet ET sur l'équipe :
//
//   const team = await requireTeamCompatibleWithOrg(teamId, missionOrgId)
//   if (!team.allowed) return { error: team.error }
//
// Un même message générique est retourné pour équipe introuvable, supprimée,
// archivée (active=false) et organisation différente : aucun oracle sur la
// raison exacte du refus depuis une autre organisation.

import { createAdminClient } from '@/lib/supabase/admin'
import type { OwnershipDecision } from './ownership-policy'

const TEAM_INCOMPATIBLE = 'Équipe inconnue ou incompatible avec cette organisation'

export async function requireTeamCompatibleWithOrg(
  teamId: string,
  targetOrganizationId: string,
): Promise<OwnershipDecision> {
  const { data: team } = await createAdminClient()
    .from('teams')
    .select('id, organization_id, active, deleted_at')
    .eq('id', teamId)
    .maybeSingle()

  if (!team) return { allowed: false, error: TEAM_INCOMPATIBLE }
  const t = team as { organization_id: string | null; active: boolean; deleted_at: string | null }
  if (t.deleted_at !== null) return { allowed: false, error: TEAM_INCOMPATIBLE }
  if (t.active === false) return { allowed: false, error: TEAM_INCOMPATIBLE }
  if (t.organization_id !== targetOrganizationId) return { allowed: false, error: TEAM_INCOMPATIBLE }

  return { allowed: true }
}
