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
import { getOrgId } from '@/lib/db/users'
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
  role: UserRole,
  table: OwnedTable,
  id: string,
): Promise<OwnershipDecision> {
  // L'admin plateforme passe sans lire l'objet (il n'est scopé à aucune org).
  if (role === 'admin') return { allowed: true }

  const callerOrgId = await getOrgId()
  const { data } = await createAdminClient()
    .from(table)
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()

  return decideOwnership({
    role,
    callerOrgId,
    // `undefined` = objet inexistant ; `null` = objet orphelin (sans org).
    objectOrgId: data ? ((data as { organization_id: string | null }).organization_id ?? null) : undefined,
  })
}
