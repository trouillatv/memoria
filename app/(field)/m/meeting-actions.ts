'use server'

// Démarrer une réunion DEPUIS l'accueil /m : il faut d'abord savoir sur quel
// chantier. Même scoping que l'annuaire /m/sites : admin/manager → tous les
// sites de l'org ; chef_equipe → ses sites (via assigned_team_id). Lecture seule.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { createAdminClient } from '@/lib/supabase/admin'

// M3 (migré). Sélecteur d'entrée « sur quel chantier démarrer » : liste AGRÉGÉE
// des sites, sans ressource de contexte (signature `()`). C'est la source UNIQUE
// du choix de chantier pour Visite, Réunion, Intervention ET partage WhatsApp
// (`/m/partage`) — un défaut ici se voit sur les quatre.
//
// LECTURE. `user.organization_id` n'est plus qu'une organisation PAR DÉFAUT
// (cf. lib/db/users.ts) : la garder ici montrait à un compte multi-org les seuls
// sites d'UNE org, sans erreur ni trace — un chantier Becib simplement absent du
// sélecteur. On agrège donc sur les appartenances ACTIVES, comme le desktop
// (`listSitesGlobal`), et fail-closed : aucune appartenance → aucun site.
//
// ⚠️ `getOrgIdsOfUser()`, JAMAIS `getOrgId()` : ce dernier lève en multi-org
// parce qu'il garde les ÉCRITURES, où une seule org peut être propriétaire.
export async function listMeetingSitesAction(): Promise<{ id: string; name: string }[]> {
  const user = await getCurrentUserWithProfile()
  if (!user) return []
  const supabase = createAdminClient()

  if (user.role === 'admin' || user.role === 'manager') {
    const orgIds = await getOrgIdsOfUser()
    if (orgIds.length > 0) {
      const { data } = await supabase
        .from('sites')
        .select('id, name')
        .in('organization_id', orgIds)
        .is('deleted_at', null)
        .order('name')
      return (data ?? []) as { id: string; name: string }[]
    }
    // Aucune appartenance : on ne rend pas l'org par défaut en repli — ce serait
    // rouvrir la porte qu'on ferme. On retombe sur le périmètre d'équipe.
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
