'use server'

// Relations d'un acteur (« Travaille principalement avec » + écosystème), chargées
// à la demande à la sélection d'un nœud. Manager/admin + org (surface Acteurs) ;
// asOf injecté ICI, une seule fois, pour toute la lecture serveur.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getActorRelations, type ActorRelationsResult } from '@/lib/db/actor-relation-view'

export async function getActorRelationsAction(kind: 'person' | 'company', id: string): Promise<{ ok: true; data: ActorRelationsResult } | { ok: false }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false }
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: false }
  const data = await getActorRelations(kind, id, orgIds, new Date())
  return { ok: true, data }
}
