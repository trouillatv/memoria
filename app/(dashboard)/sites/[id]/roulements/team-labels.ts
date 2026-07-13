import 'server-only'

// « Marie-Thérèse », pas « Équipe 3 ».
//
// L'unité planifiée reste l'ÉQUIPE — toutes les écritures portent un `team_id`,
// jamais un user_id (le planning nominatif est une ligne rouge). Mais quand une
// équipe n'a QU'UN membre — ce qui est le cas normal dans le nettoyage — le
// produit l'affiche par le nom de cette personne.
//
// C'est la façon dont MemorIA parle des gens sans jamais les planifier
// nominativement. Guillaume lit sa feuille ; le modèle, lui, ne bouge pas.

import { createAdminClient } from '@/lib/supabase/admin'
import { listTeams } from '@/lib/db/teams'

export interface TeamLabel {
  id: string
  label: string
}

export async function listTeamsWithDisplayName(): Promise<TeamLabel[]> {
  const teams = (await listTeams().catch(() => []))
    .filter((t) => t.active && !t.deleted_at)
    .map((t) => ({ id: t.id, name: t.name }))
  if (teams.length === 0) return []

  const { data } = await createAdminClient()
    .from('team_members')
    .select('team_id, user:users(full_name)')
    .in('team_id', teams.map((t) => t.id))
    .is('left_at', null)

  // Un seul membre → on affiche SON nom. Plusieurs → le nom de l'équipe.
  const membersByTeam = new Map<string, string[]>()
  for (const row of (data ?? []) as Array<{ team_id: string; user: unknown }>) {
    const u = Array.isArray(row.user) ? row.user[0] : row.user
    const name = (u as { full_name?: string | null } | null)?.full_name?.trim()
    if (!name) continue
    const list = membersByTeam.get(row.team_id) ?? []
    list.push(name)
    membersByTeam.set(row.team_id, list)
  }

  return teams.map((t) => {
    const members = membersByTeam.get(t.id) ?? []
    return { id: t.id, label: members.length === 1 ? members[0] : t.name }
  })
}
