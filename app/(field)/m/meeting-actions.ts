'use server'

// Démarrer une réunion DEPUIS l'accueil /m : il faut d'abord savoir sur quel
// chantier. Même scoping que l'annuaire /m/sites : admin/manager → tous les
// sites de l'org ; chef_equipe → ses sites (via assigned_team_id). Lecture seule.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { createAdminClient } from '@/lib/supabase/admin'

export async function listMeetingSitesAction(): Promise<{ id: string; name: string }[]> {
  const user = await getCurrentUserWithProfile()
  if (!user) return []
  const supabase = createAdminClient()

  if ((user.role === 'admin' || user.role === 'manager') && user.organization_id) {
    const { data } = await supabase
      .from('sites')
      .select('id, name')
      .eq('organization_id', user.organization_id)
      .is('deleted_at', null)
      .order('name')
    return (data ?? []) as { id: string; name: string }[]
  }

  const teamIds = await listActiveTeamIdsForUser(user.id)
  if (teamIds.length === 0) return []
  const { data: missionRows } = await supabase
    .from('missions')
    .select('site_id')
    .in('assigned_team_id', teamIds)
    .is('deleted_at', null)
  const siteIds = Array.from(new Set(
    (missionRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)
  ))
  if (siteIds.length === 0) return []
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .in('id', siteIds)
    .is('deleted_at', null)
    .order('name')
  return (data ?? []) as { id: string; name: string }[]
}
