import 'server-only'

// Lot S — garde d'appartenance sur les ÉCRITURES : le POINT D'ENTRÉE.
//
// Usage type, en tête d'une server action, APRÈS la garde de rôle :
//
//   const auth = await requireManagerOrAdmin()
//   if (!auth.ok) return { error: auth.error }
//   const guard = await requireOwned(auth.role, 'interventions', id)
//   if (!guard.allowed) return { error: guard.error }
//
// Une action qui oublie cette ligne accepte encore un id d'un autre tenant :
// toute NOUVELLE action qui mute un objet par id DOIT l'appeler. La décision
// est dans ownership-policy.ts (pure, testée) ; ici on ne fait que lire
// l'organisation de l'objet.

import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { decideOwnership, type OwnershipDecision } from './ownership-policy'
import type { UserRole } from '@/types/db'

/** Tables portant `organization_id` et mutées par id depuis une server action. */
export type OwnedTable =
  | 'interventions'
  | 'missions'
  | 'teams'
  | 'sites'
  | 'clients'
  | 'contracts'
  | 'site_reports'
  | 'site_actions'

export async function requireOwned(
  // Conservé pour la STABILITÉ DE SIGNATURE (les ~24 appelants passent `auth.role`) :
  // il ne sert PLUS à exempter qui que ce soit. Le rôle métier est gardé en amont
  // par `requireManagerOrAdmin` ; ici on ne décide que de l'APPARTENANCE.
  _role: UserRole,
  table: OwnedTable,
  id: string,
): Promise<OwnershipDecision> {
  // 1. L'organisation DE LA RESSOURCE (toutes les OwnedTable portent
  //    `organization_id` en direct) — jamais l'org de l'appelant.
  const { data } = await createAdminClient()
    .from(table)
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()
  // `undefined` = objet inexistant ; `null` = objet orphelin (sans org).
  const objectOrgId = data ? ((data as { organization_id: string | null }).organization_id ?? null) : undefined

  // 2. L'appelant est-il MEMBRE ACTIF de cette organisation ? (primitive M1 —
  //    lit la session, jamais `getOrgId()`, aucune exemption admin.)
  const isMemberOfObjectOrg = objectOrgId ? (await requireOrganizationMembership(objectOrgId)).ok : false

  return decideOwnership({ objectOrgId, isMemberOfObjectOrg })
}
