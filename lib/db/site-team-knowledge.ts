// CT-2 — Bloc « Équipe qui connaît ce site » sur /sites/[id].
//
// Vincent 2026-05-21 : « agents/équipes déjà passés ; dernier passage ;
// nombre de passages ; éventuellement dernière note terrain validée courte ;
// lien vers interventions passées ».
//
// Doctrine respectée :
//   - Sujet = SITE (on liste les équipes qui ont travaillé sur CE site).
//   - Pas de classement entre équipes, pas de score, pas de comparaison.
//   - Pas de moyenne, juste des compteurs absolus.
//   - Distinct de getSiteTeamPresences (30j récent + composition courante) :
//     cette fonction est ALL-TIME et compte les passages cumulés.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'

export interface SiteTeamKnowledge {
  team_id: string
  team_name: string
  team_color: string | null
  /** Nb interventions DOCUMENTÉES (completed/validated) cette équipe sur ce site. */
  interventionsDocumentedCount: number
  /** Nb interventions TOUTES (planned/in_progress incluses) — repère charge. */
  interventionsTotalCount: number
  firstPassageDate: string | null
  lastPassageDate: string | null
  /** Noms uniques de missions réalisées par cette équipe sur ce site. */
  missionNames: string[]
  /** Est-ce que l'équipe est encore active (pas archivée) ? */
  isActive: boolean
}

const DOCUMENTED_STATUSES = ['completed', 'validated'] as const

/**
 * Liste les équipes qui ont travaillé sur ce site, tout temps confondu.
 *
 * Tri : dernier passage descendant (la plus récente en haut).
 * Inclut les équipes archivées (pour transparence historique) — marquées
 * `isActive=false` côté UI pour les afficher en grisé.
 */
export async function getSiteTeamsKnowledge(
  siteId: string,
): Promise<SiteTeamKnowledge[]> {
  const admin = createAdminClient()

  // 1) Missions du site (filtre système)
  const { data: missions } = await admin
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const filteredMissions = (missions ?? []).filter(
    (m) => !isSystemMissionName((m as { name: string }).name),
  ) as Array<{ id: string; name: string }>
  if (filteredMissions.length === 0) return []
  const missionIds = filteredMissions.map((m) => m.id)
  const missionNameById = new Map(filteredMissions.map((m) => [m.id, m.name]))

  // 2) Interventions sur ces missions ayant une équipe assignée
  const { data: interventions } = await admin
    .from('interventions')
    .select('id, mission_id, assigned_team_id, scheduled_for, status')
    .in('mission_id', missionIds)
    .not('assigned_team_id', 'is', null)

  type IntvRow = {
    id: string
    mission_id: string
    assigned_team_id: string
    scheduled_for: string | null
    status: string
  }
  const intvRows = (interventions ?? []) as IntvRow[]
  if (intvRows.length === 0) return []

  // 3) Agréger par team_id
  type Agg = {
    total: number
    documented: number
    firstAt: string | null
    lastAt: string | null
    missions: Set<string>
  }
  const byTeam = new Map<string, Agg>()
  for (const r of intvRows) {
    const agg = byTeam.get(r.assigned_team_id) ?? {
      total: 0,
      documented: 0,
      firstAt: null,
      lastAt: null,
      missions: new Set<string>(),
    }
    agg.total += 1
    if ((DOCUMENTED_STATUSES as readonly string[]).includes(r.status)) {
      agg.documented += 1
    }
    const date = r.scheduled_for
    if (date) {
      if (!agg.firstAt || date < agg.firstAt) agg.firstAt = date
      if (!agg.lastAt || date > agg.lastAt) agg.lastAt = date
    }
    const missionName = missionNameById.get(r.mission_id)
    if (missionName) agg.missions.add(missionName)
    byTeam.set(r.assigned_team_id, agg)
  }

  // 4) Charger les équipes (y compris archivées pour transparence historique)
  const teamIds = Array.from(byTeam.keys())
  const { data: teams } = await admin
    .from('teams')
    .select('id, name, color, deleted_at, active')
    .in('id', teamIds)

  type TeamRow = {
    id: string
    name: string
    color: string | null
    deleted_at: string | null
    active: boolean | null
  }
  const out: SiteTeamKnowledge[] = []
  for (const team of (teams ?? []) as TeamRow[]) {
    const agg = byTeam.get(team.id)
    if (!agg) continue
    out.push({
      team_id: team.id,
      team_name: team.name,
      team_color: team.color,
      interventionsDocumentedCount: agg.documented,
      interventionsTotalCount: agg.total,
      firstPassageDate: agg.firstAt,
      lastPassageDate: agg.lastAt,
      missionNames: Array.from(agg.missions).sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' }),
      ),
      isActive: team.deleted_at === null && team.active !== false,
    })
  }

  return out.sort((a, b) => {
    // Actives d'abord, puis dernier passage desc
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.lastPassageDate && b.lastPassageDate) {
      return b.lastPassageDate.localeCompare(a.lastPassageDate)
    }
    return a.team_name.localeCompare(b.team_name, 'fr', { sensitivity: 'base' })
  })
}

/**
 * CT-3 — Helper léger pour hint « équipe connue de ce site » dans le dialog
 * d'affectation. Retourne juste les IDs des équipes qui ont fait ≥1 intervention
 * DOCUMENTÉE sur ce site (status completed/validated).
 *
 * Volontairement minimaliste : pas de compteur (cf. challenge #2 : un chiffre
 * comparatif EST un score implicite). L'UI affiche un badge binaire « Connue ».
 */
export async function getTeamIdsKnowingSite(siteId: string): Promise<string[]> {
  const admin = createAdminClient()

  const { data: missions } = await admin
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const filteredMissions = (missions ?? []).filter(
    (m) => !isSystemMissionName((m as { name: string }).name),
  ) as Array<{ id: string }>
  if (filteredMissions.length === 0) return []
  const missionIds = filteredMissions.map((m) => m.id)

  const { data: interventions } = await admin
    .from('interventions')
    .select('assigned_team_id')
    .in('mission_id', missionIds)
    .in('status', DOCUMENTED_STATUSES as unknown as string[])
    .not('assigned_team_id', 'is', null)

  const teamIds = new Set<string>()
  for (const r of (interventions ?? []) as Array<{ assigned_team_id: string | null }>) {
    if (r.assigned_team_id) teamIds.add(r.assigned_team_id)
  }
  return Array.from(teamIds)
}
