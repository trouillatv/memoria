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
import { getOrganizationMembershipsOfUser } from '@/lib/auth/memberships'
import { decideOwnership, type OwnershipDecision } from './ownership-policy'
import type { DbUser, UserRole } from '@/types/db'

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
  // P2-B item D (16/08, mandat Vincent) : si l'appelant a DÉJÀ résolu le user
  // de la requête, on lui évite un aller-retour supplémentaire de session.
  // Optionnel — omis, comportement inchangé (résolution dans `memberships.ts`).
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<OwnershipDecision> {
  // 1. L'organisation DE LA RESSOURCE (toutes les OwnedTable portent
  //    `organization_id` en direct) — jamais l'org de l'appelant.
  // 2. Les appartenances ACTIVES de l'appelant (primitive M1 — jamais
  //    `getOrgId()`, aucune exemption admin).
  // Les deux lectures sont INDÉPENDANTES : l'org de l'objet ne dépend pas de
  // qui appelle, et les appartenances de l'appelant ne dépendent pas de
  // l'objet visé. Auparavant sérielles (1 puis 2, la seconde filtrée par le
  // résultat de la première) ; l'audit P2-B a confirmé qu'il suffit de lire
  // TOUTES les appartenances actives de l'appelant en parallèle, puis d'y
  // chercher l'org de l'objet une fois les deux lectures revenues — même
  // décision finale, un seul aller-retour au lieu de deux.
  const [objectOrgResult, memberships] = await Promise.all([
    createAdminClient().from(table).select('organization_id').eq('id', id).maybeSingle(),
    getOrganizationMembershipsOfUser(currentUser),
  ])
  // `undefined` = objet inexistant ; `null` = objet orphelin (sans org).
  const objectOrgId = objectOrgResult.data
    ? ((objectOrgResult.data as { organization_id: string | null }).organization_id ?? null)
    : undefined

  const isMemberOfObjectOrg = objectOrgId ? memberships.some((m) => m.organizationId === objectOrgId) : false

  return decideOwnership({ objectOrgId, isMemberOfObjectOrg })
}
