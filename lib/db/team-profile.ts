// Page Fiche Équipe — helpers DB.
//
// Vincent 2026-05-21 — Sprint Équipes B (fiche enrichie).
//
// Doctrine V2 ABSOLUE (cf. lib/db/teams.ts pour la liste rouge) :
//   ✅ Compteurs DESCRIPTIFS — sites couverts, interventions documentées,
//      photos déposées, anomalies signalées. Cumul brut, jamais ratio.
//   ✅ Sites favoris = sites les plus fréquemment couverts par cette équipe
//      (fréquence cumulée, jamais "% complétion")
//   ✅ Compagnons = équipes voisines par membres communs OU sites communs.
//      Pas de scoring de la proximité, juste l'enumeration.
//   ✅ Spécialités déclarées = tags posés à la main par le manager. Jamais
//      inférés. Jamais comparés.
//
//   ❌ JAMAIS getTeamCharge / getTeamLoad / getTeamSaturation
//   ❌ JAMAIS getTeamPerformance / getTeamProductivity / getTeamCompletionRate
//   ❌ JAMAIS de comparaison inter-équipes (chaque fonction prend UN teamId,
//      retourne SA vue, jamais 2 équipes en parallèle)
//
// Convention nommage : on évite `*ByTeam` (interdit côté pages utilisateur)
// au profit de `getTeam*` / `listTeam*` — ce fichier est l'allowlist pour
// les agrégats par team_id (parallèle à intervenants.ts).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import type { DbTeam } from '@/types/db'

// ----------------------------------------------------------------------------
// Types exposés
// ----------------------------------------------------------------------------

export interface TeamOverview {
  id: string
  name: string
  /** P1 isolation — pour la garde d'appartenance au tenant côté page. */
  organizationId: string | null
  color: string | null
  icon: string | null
  specialties: string[]
  active: boolean
  createdAt: string
  /** Ancienneté en jours depuis created_at. */
  ageDays: number
  /** Référent désigné (si présent). */
  referent: { id: string; full_name: string | null; email: string } | null
  /** Effectif courant (left_at IS NULL). Descriptif. */
  memberCount: number
  /** Compteurs descriptifs uniquement. */
  counters: {
    sitesCovered: number
    contractsCovered: number
    interventionsDocumented: number
    photosDeposited: number
    anomaliesHandled: number
  }
}

export interface TeamFavoriteSite {
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  interventionCount: number
  lastInterventionDate: string | null
}

export interface TeamContractCovered {
  contract_id: string
  contract_name: string
  client_name: string | null
  interventionCount: number
  lastInterventionDate: string | null
}

export interface TeamRhythmDay {
  date: string
  weekdayLabel: string
  dayMonthLabel: string
  isToday: boolean
  isWeekend: boolean
  count: number
  tooltipLines: string[]
}

export interface TeamHeatmapCell {
  /** yyyy-mm-dd */
  date: string
  count: number
}

export interface TeamCompanion {
  team_id: string
  team_name: string
  team_color: string | null
  team_icon: string | null
  /** Membres actifs en commun (left_at IS NULL pour les deux). */
  sharedActiveMembers: number
  /** Sites couverts en commun (intersection des sites favoris). */
  sharedSites: number
}

export interface TeamRecentIntervention {
  intervention_id: string
  scheduled_for: string | null
  status: string
  planned_start: string | null
  planned_end: string | null
  mission_name: string
  site_id: string
  site_name: string
}

export interface TeamRecentPhoto {
  id: string
  signedUrl: string
  caption: string | null
  takenAt: string
  interventionId: string
  siteId: string | null
  siteName: string | null
}

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

type InterventionRow = {
  id: string
  scheduled_for: string | null
  status: string
  planned_start: string | null
  planned_end: string | null
  mission: unknown
}

interface ResolvedTeamIntervention {
  intervention_id: string
  scheduled_for: string | null
  status: string
  planned_start: string | null
  planned_end: string | null
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
}

/**
 * Source unique des interventions d'une équipe.
 *
 * On passe par `interventions.assigned_team_id` directement (pas besoin du
 * détour `team_members` car l'équipe EST l'unité d'affectation V2). Filtre les
 * missions système (« Traces libres du site » etc.) pour ne pas polluer.
 */
async function fetchTeamInterventions(
  teamId: string,
): Promise<ResolvedTeamIntervention[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('interventions')
    .select(`
      id,
      scheduled_for,
      status,
      planned_start,
      planned_end,
      mission:missions!inner(
        name,
        site:sites!inner(
          id,
          name,
          contract:contracts(id, name),
          client:clients(name)
        )
      )
    `)
    .eq('assigned_team_id', teamId)
  if (error) throw error

  const out: ResolvedTeamIntervention[] = []
  for (const r of (data ?? []) as InterventionRow[]) {
    const mission = pickOne(r.mission) as { name?: string; site?: unknown } | null
    if (!mission?.name) continue
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(mission.site) as {
      id?: string
      name?: string
      contract?: unknown
      client?: unknown
    } | null
    if (!site?.id || !site.name) continue
    const contract = pickOne(site.contract) as { id?: string; name?: string } | null
    const client = pickOne(site.client) as { name?: string } | null

    out.push({
      intervention_id: r.id,
      scheduled_for: r.scheduled_for,
      status: r.status,
      planned_start: r.planned_start,
      planned_end: r.planned_end,
      mission_name: mission.name,
      site_id: site.id,
      site_name: site.name,
      contract_id: contract?.id ?? null,
      contract_name: contract?.name ?? null,
      client_name: client?.name ?? null,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// getTeamOverview — header + compteurs
// ----------------------------------------------------------------------------

export async function getTeamOverview(teamId: string): Promise<TeamOverview | null> {
  const admin = createAdminClient()

  const { data: teamRow, error } = await admin
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  if (!teamRow) return null
  const team = teamRow as DbTeam

  // Effectif
  const { count: memberCount } = await admin
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .is('left_at', null)

  // Référent
  let referent: TeamOverview['referent'] = null
  if (team.referent_user_id) {
    const { data: ref } = await admin
      .from('users')
      .select('id, full_name, email')
      .eq('id', team.referent_user_id)
      .maybeSingle()
    referent = ref
      ? { id: ref.id, full_name: ref.full_name, email: ref.email }
      : null
  }

  // Interventions documentées (in_progress + completed + validated)
  const interventions = await fetchTeamInterventions(teamId)
  const documented = interventions.filter((i) =>
    ['in_progress', 'completed', 'validated'].includes(i.status),
  )
  const sites = new Set(documented.map((i) => i.site_id))
  const contracts = new Set(
    documented.map((i) => i.contract_id).filter((id): id is string => !!id),
  )

  // Photos déposées sur les interventions de l'équipe
  const interventionIds = interventions.map((i) => i.intervention_id)
  let photosDeposited = 0
  if (interventionIds.length > 0) {
    const { count } = await admin
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', interventionIds)
    photosDeposited = count ?? 0
  }

  // Anomalies signalées sur les interventions de l'équipe (descriptif ;
  // pas d'inférence "qui a traité quoi")
  let anomaliesHandled = 0
  if (interventionIds.length > 0) {
    const { count } = await admin
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', interventionIds)
    anomaliesHandled = count ?? 0
  }

  const createdAt = team.created_at
  const ageDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24),
    ),
  )

  return {
    id: team.id,
    name: team.name,
    organizationId: team.organization_id ?? null,
    color: team.color,
    icon: team.icon,
    specialties: team.specialties ?? [],
    active: team.active,
    createdAt,
    ageDays,
    referent,
    memberCount: memberCount ?? 0,
    counters: {
      sitesCovered: sites.size,
      contractsCovered: contracts.size,
      interventionsDocumented: documented.length,
      photosDeposited,
      anomaliesHandled,
    },
  }
}

// ----------------------------------------------------------------------------
// listTeamFavoriteSites — top sites par fréquence
// ----------------------------------------------------------------------------

export async function listTeamFavoriteSites(
  teamId: string,
  limit = 8,
): Promise<TeamFavoriteSite[]> {
  const interventions = await fetchTeamInterventions(teamId)
  const documented = interventions.filter((i) =>
    ['in_progress', 'completed', 'validated', 'planned'].includes(i.status),
  )

  const bySite = new Map<string, TeamFavoriteSite>()
  for (const i of documented) {
    const cur = bySite.get(i.site_id)
    if (!cur) {
      bySite.set(i.site_id, {
        site_id: i.site_id,
        site_name: i.site_name,
        contract_id: i.contract_id,
        contract_name: i.contract_name,
        interventionCount: 1,
        lastInterventionDate: i.scheduled_for,
      })
    } else {
      cur.interventionCount += 1
      if (
        i.scheduled_for &&
        (!cur.lastInterventionDate || i.scheduled_for > cur.lastInterventionDate)
      ) {
        cur.lastInterventionDate = i.scheduled_for
      }
    }
  }
  return Array.from(bySite.values())
    .sort((a, b) => {
      if (b.interventionCount !== a.interventionCount) {
        return b.interventionCount - a.interventionCount
      }
      return (b.lastInterventionDate ?? '').localeCompare(a.lastInterventionDate ?? '')
    })
    .slice(0, limit)
}

// ----------------------------------------------------------------------------
// listTeamContractsCovered — contrats touchés
// ----------------------------------------------------------------------------

export async function listTeamContractsCovered(
  teamId: string,
): Promise<TeamContractCovered[]> {
  const interventions = await fetchTeamInterventions(teamId)
  const byContract = new Map<string, TeamContractCovered>()
  for (const i of interventions) {
    if (!i.contract_id) continue
    if (!['in_progress', 'completed', 'validated', 'planned'].includes(i.status)) continue
    const cur = byContract.get(i.contract_id)
    if (!cur) {
      byContract.set(i.contract_id, {
        contract_id: i.contract_id,
        contract_name: i.contract_name ?? '(Contrat sans nom)',
        client_name: i.client_name,
        interventionCount: 1,
        lastInterventionDate: i.scheduled_for,
      })
    } else {
      cur.interventionCount += 1
      if (
        i.scheduled_for &&
        (!cur.lastInterventionDate || i.scheduled_for > cur.lastInterventionDate)
      ) {
        cur.lastInterventionDate = i.scheduled_for
      }
    }
  }
  return Array.from(byContract.values()).sort(
    (a, b) => b.interventionCount - a.interventionCount,
  )
}

// ----------------------------------------------------------------------------
// getTeamRhythm — 14 derniers jours
// ----------------------------------------------------------------------------

function yyyymmddInTz(d: Date, tz = 'Pacific/Noumea'): string {
  // Date-only ISO, en time zone NC (équivalent .toLocaleDateString fr-CA)
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

const FR_WEEKDAY_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

export async function getTeamRhythm14d(teamId: string): Promise<TeamRhythmDay[]> {
  const interventions = await fetchTeamInterventions(teamId)
  const today = new Date()
  const todayKey = yyyymmddInTz(today)

  // Map date → liste interventions (pour tooltip)
  const byDate = new Map<string, ResolvedTeamIntervention[]>()
  for (const i of interventions) {
    if (!i.scheduled_for) continue
    if (!['in_progress', 'completed', 'validated', 'planned'].includes(i.status)) continue
    const date = i.scheduled_for.slice(0, 10)
    const arr = byDate.get(date) ?? []
    arr.push(i)
    byDate.set(date, arr)
  }

  const out: TeamRhythmDay[] = []
  for (let offset = 13; offset >= 0; offset--) {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    const dateKey = yyyymmddInTz(d)
    const items = byDate.get(dateKey) ?? []
    const wkIndex = d.getDay()
    const tooltipLines = items.slice(0, 5).map((i) => `${i.mission_name} · ${i.site_name}`)
    out.push({
      date: dateKey,
      weekdayLabel: FR_WEEKDAY_SHORT[wkIndex],
      dayMonthLabel: `${String(d.getDate()).padStart(2, '0')}/${String(
        d.getMonth() + 1,
      ).padStart(2, '0')}`,
      isToday: dateKey === todayKey,
      isWeekend: wkIndex === 0 || wkIndex === 6,
      count: items.length,
      tooltipLines,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// getTeamHeatmap — 90 derniers jours
// ----------------------------------------------------------------------------

export async function getTeamHeatmap90d(teamId: string): Promise<TeamHeatmapCell[]> {
  const interventions = await fetchTeamInterventions(teamId)
  const byDate = new Map<string, number>()
  for (const i of interventions) {
    if (!i.scheduled_for) continue
    if (!['in_progress', 'completed', 'validated', 'planned'].includes(i.status)) continue
    const date = i.scheduled_for.slice(0, 10)
    byDate.set(date, (byDate.get(date) ?? 0) + 1)
  }

  const out: TeamHeatmapCell[] = []
  for (let offset = 89; offset >= 0; offset--) {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    const dateKey = yyyymmddInTz(d)
    out.push({
      date: dateKey,
      count: byDate.get(dateKey) ?? 0,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// listTeamCompanions — équipes voisines
// ----------------------------------------------------------------------------

export async function listTeamCompanions(teamId: string): Promise<TeamCompanion[]> {
  const admin = createAdminClient()

  // 1) Sites couverts par cette équipe
  const favorites = await listTeamFavoriteSites(teamId, 9999)
  const mySiteIds = new Set(favorites.map((f) => f.site_id))

  // 2) Membres actuels de cette équipe
  const { data: myMembers } = await admin
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)
    .is('left_at', null)
  const myMemberIds = new Set(
    ((myMembers ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
  )

  // 3) Toutes les autres équipes actives
  const { data: otherTeams } = await admin
    .from('teams')
    .select('id, name, color, icon')
    .neq('id', teamId)
    .is('deleted_at', null)

  const companions: TeamCompanion[] = []
  for (const t of (otherTeams ?? []) as Array<{
    id: string
    name: string
    color: string | null
    icon: string | null
  }>) {
    // Membres communs
    const { data: theirMembers } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', t.id)
      .is('left_at', null)
    const theirMemberIds = new Set(
      ((theirMembers ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
    )
    let sharedActiveMembers = 0
    for (const uid of myMemberIds) {
      if (theirMemberIds.has(uid)) sharedActiveMembers += 1
    }

    // Sites communs (via leurs interventions assignées)
    const { data: theirInterventions } = await admin
      .from('interventions')
      .select('mission:missions!inner(site_id)')
      .eq('assigned_team_id', t.id)
    type Row = { mission: { site_id?: string } | { site_id?: string }[] | null }
    const theirSiteIds = new Set<string>()
    for (const r of (theirInterventions ?? []) as Row[]) {
      const m = pickOne(r.mission) as { site_id?: string } | null
      if (m?.site_id) theirSiteIds.add(m.site_id)
    }
    let sharedSites = 0
    for (const sid of mySiteIds) {
      if (theirSiteIds.has(sid)) sharedSites += 1
    }

    // On garde l'équipe si au moins 1 lien (membre OU site)
    if (sharedActiveMembers > 0 || sharedSites > 0) {
      companions.push({
        team_id: t.id,
        team_name: t.name,
        team_color: t.color,
        team_icon: t.icon,
        sharedActiveMembers,
        sharedSites,
      })
    }
  }

  // Tri descriptif : d'abord par sites communs, puis par membres communs
  return companions.sort((a, b) => {
    if (b.sharedSites !== a.sharedSites) return b.sharedSites - a.sharedSites
    return b.sharedActiveMembers - a.sharedActiveMembers
  })
}

// ----------------------------------------------------------------------------
// listTeamRecentInterventions — activité récente
// ----------------------------------------------------------------------------

export async function listTeamRecentInterventions(
  teamId: string,
  limit = 20,
): Promise<TeamRecentIntervention[]> {
  const interventions = await fetchTeamInterventions(teamId)
  return interventions
    .filter((i) => i.scheduled_for)
    .sort((a, b) => (b.scheduled_for ?? '').localeCompare(a.scheduled_for ?? ''))
    .slice(0, limit)
    .map((i) => ({
      intervention_id: i.intervention_id,
      scheduled_for: i.scheduled_for,
      status: i.status,
      planned_start: i.planned_start,
      planned_end: i.planned_end,
      mission_name: i.mission_name,
      site_id: i.site_id,
      site_name: i.site_name,
    }))
}

// ----------------------------------------------------------------------------
// listTeamRecentPhotos — galerie thumbnails
// ----------------------------------------------------------------------------

export async function listTeamRecentPhotos(
  teamId: string,
  limit = 12,
): Promise<TeamRecentPhoto[]> {
  const admin = createAdminClient()
  const interventions = await fetchTeamInterventions(teamId)
  const interventionIds = interventions.map((i) => i.intervention_id)
  if (interventionIds.length === 0) return []

  const { data: photos, error } = await admin
    .from('intervention_photos')
    .select('id, caption, taken_at, intervention_id, storage_path')
    .in('intervention_id', interventionIds)
    .order('taken_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  // Map intervention → site pour enrichir
  const interventionToSite = new Map<string, { id: string; name: string }>()
  for (const i of interventions) {
    interventionToSite.set(i.intervention_id, { id: i.site_id, name: i.site_name })
  }

  type PhotoRow = {
    id: string
    caption: string | null
    taken_at: string
    intervention_id: string
    storage_path: string
  }

  const photoRows = (photos ?? []) as PhotoRow[]
  // Batch des URLs signées (thumbnails 400x400) — un seul aller-retour
  const urlByPath = await getSignedPhotoUrlsThumb(photoRows.map((p) => p.storage_path))

  const out: TeamRecentPhoto[] = []
  for (const p of photoRows) {
    const signed = urlByPath.get(p.storage_path)
    if (!signed) continue
    const site = interventionToSite.get(p.intervention_id) ?? null
    out.push({
      id: p.id,
      signedUrl: signed,
      caption: p.caption,
      takenAt: p.taken_at,
      interventionId: p.intervention_id,
      siteId: site?.id ?? null,
      siteName: site?.name ?? null,
    })
  }
  return out
}
