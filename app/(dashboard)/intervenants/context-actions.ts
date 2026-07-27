'use server'

// Contexte opérationnel d'un acteur (dernières interactions datées), chargé à la
// demande quand un nœud du graphe est sélectionné. Manager/admin uniquement (surface
// Acteurs) + garde org fail-closed dans le read model. Aucune écriture.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getActorContext, type ActorContext } from '@/lib/db/actor-context'

export async function getActorContextAction(kind: 'person' | 'company', id: string): Promise<{ ok: true; context: ActorContext } | { ok: false }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false }
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: false }
  const context = await getActorContext(kind, id, orgIds)
  return { ok: true, context }
}
