// lib/db/clients.ts
// Helpers pour la page Client 360°.
//
// Architecture :
//   clients → sites (FK client_id) → missions → interventions
//   clients ↔ contracts (matching par client_name ILIKE — pas de FK)

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getSiteRecentRhythm, type SiteRhythmDay } from '@/lib/db/site-cockpit'

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000'

/**
 * Rythme agrégé d'un client : somme des traces de TOUS ses sites par jour,
 * sur N jours glissants. Réutilise getSiteRecentRhythm par site puis fusionne
 * (counts additionnés, tooltips dédupliqués). Même type que la page site.
 */
export async function getClientRecentRhythm(
  clientId: string,
  daysBack = 14,
): Promise<SiteRhythmDay[]> {
  const supabase = createAdminClient()

  const { data: siteRows } = await supabase
    .from('sites')
    .select('id')
    .eq('client_id', clientId)
    .is('deleted_at', null)
  const siteIds = (siteRows ?? []).map((s) => (s as { id: string }).id)

  const perSite = await Promise.all(
    siteIds.map((id) => getSiteRecentRhythm(id, daysBack)),
  )

  // Squelette des N jours : depuis le premier site, ou via un site vide.
  const base = perSite[0] ?? (await getSiteRecentRhythm(EMPTY_UUID, daysBack))
  const merged: SiteRhythmDay[] = base.map((d) => ({
    ...d,
    count: 0,
    tooltipLines: [],
  }))
  const idxByDate = new Map(merged.map((d, i) => [d.date, i]))

  for (const site of perSite) {
    for (const day of site) {
      const idx = idxByDate.get(day.date)
      if (idx === undefined) continue
      merged[idx].count += day.count
      for (const line of day.tooltipLines) {
        if (!merged[idx].tooltipLines.includes(line)) {
          merged[idx].tooltipLines.push(line)
        }
      }
    }
  }
  merged.forEach((d) => d.tooltipLines.sort())
  return merged
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  notes: string | null
}

export interface ClientWithStats extends ClientRow {
  siteCount: number
  contractCount: number
}

export interface ClientDetail extends ClientRow {
  sites: Array<{
    id: string
    name: string
    address: string | null
    missionCount: number
  }>
  contracts: Array<{
    id: string
    name: string
    status: string
    end_date: string | null
    start_date: string | null
  }>
  recentInterventions: Array<{
    id: string
    missionName: string
    siteName: string
    scheduled_for: string | null
    status: string
    slot: string | null
  }>
  openAnomalyCount: number
  totalInterventionCount: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Liste tous les clients avec le compte de sites et de contrats. */
export async function listClientsWithStats(): Promise<ClientWithStats[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  let clientQ = supabase
    .from('clients')
    .select('id, name, contact_name, contact_email, contact_phone, address, notes')
    .is('deleted_at', null)
    .order('name')
  if (orgId) clientQ = clientQ.eq('organization_id', orgId)
  const { data: clients, error } = await clientQ
  if (error) throw error
  if (!clients || clients.length === 0) return []

  const clientIds = (clients as ClientRow[]).map((c) => c.id)

  // Sites par client_id
  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, client_id')
    .in('client_id', clientIds)
    .is('deleted_at', null)

  const siteCountByClient = new Map<string, number>()
  for (const s of (siteRows ?? []) as Array<{ id: string; client_id: string }>) {
    siteCountByClient.set(s.client_id, (siteCountByClient.get(s.client_id) ?? 0) + 1)
  }

  // Contrats : match par client_name (texte libre) vs client.name
  // On charge tous les contrats puis on regroupe côté JS par nom normalisé.
  const { data: contractRows } = await supabase
    .from('contracts')
    .select('id, client_name')
  const contractCountByClient = new Map<string, number>()
  const clientNameMap = new Map<string, string>() // normalized → client id
  for (const c of (clients as ClientRow[])) {
    clientNameMap.set(c.name.toLowerCase().trim(), c.id)
  }
  for (const cr of (contractRows ?? []) as Array<{ id: string; client_name: string }>) {
    const key = cr.client_name.toLowerCase().trim()
    const clientId = clientNameMap.get(key)
    if (clientId) {
      contractCountByClient.set(clientId, (contractCountByClient.get(clientId) ?? 0) + 1)
    }
  }

  return (clients as ClientRow[]).map((c) => ({
    ...c,
    siteCount: siteCountByClient.get(c.id) ?? 0,
    contractCount: contractCountByClient.get(c.id) ?? 0,
  }))
}

/** Charge le détail complet d'un client pour la vue 360°. */
export async function getClientDetail(id: string): Promise<ClientDetail | null> {
  const supabase = createAdminClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, contact_name, contact_email, contact_phone, address, notes')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!client) return null

  const c = client as ClientRow

  // Sites du client
  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, name, address')
    .eq('client_id', id)
    .is('deleted_at', null)
    .order('name')

  const sites = (siteRows ?? []) as Array<{ id: string; name: string; address: string | null }>
  const siteIds = sites.map((s) => s.id)

  // Contrats liés par nom (ILIKE)
  const { data: contractRows } = await supabase
    .from('contracts')
    .select('id, name, status, start_date, end_date')
    .ilike('client_name', c.name.trim())
    .order('end_date', { ascending: false })

  const contracts = (contractRows ?? []) as Array<{
    id: string
    name: string
    status: string
    start_date: string | null
    end_date: string | null
  }>

  if (siteIds.length === 0) {
    return {
      ...c,
      sites: [],
      contracts,
      recentInterventions: [],
      openAnomalyCount: 0,
      totalInterventionCount: 0,
    }
  }

  // Missions par site (pour afficher le compte)
  const { data: missionRows } = await supabase
    .from('missions')
    .select('id, site_id')
    .in('site_id', siteIds)
    .is('deleted_at', null)

  const missionCountBySite = new Map<string, number>()
  const allMissionIds: string[] = []
  for (const m of (missionRows ?? []) as Array<{ id: string; site_id: string }>) {
    missionCountBySite.set(m.site_id, (missionCountBySite.get(m.site_id) ?? 0) + 1)
    allMissionIds.push(m.id)
  }

  const sitesWithCount = sites.map((s) => ({
    ...s,
    missionCount: missionCountBySite.get(s.id) ?? 0,
  }))

  if (allMissionIds.length === 0) {
    return {
      ...c,
      sites: sitesWithCount,
      contracts,
      recentInterventions: [],
      openAnomalyCount: 0,
      totalInterventionCount: 0,
    }
  }

  // Interventions récentes (30 dernières) + total + anomalies ouvertes
  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (v === null) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  const [interventionRes, anomalyRes, totalRes] = await Promise.all([
    supabase
      .from('interventions')
      .select(
        'id, status, slot, scheduled_for, mission:missions!inner(name, site:sites!inner(name))',
      )
      .in('mission_id', allMissionIds)
      .order('scheduled_for', { ascending: false })
      .limit(30),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention_id', { count: 'exact', head: true })
      .eq('status', 'open')
      .in(
        'intervention_id',
        // Sous-requête émulée : on passe les IDs d'interventions récentes
        // (Supabase ne supporte pas les sous-requêtes natives côté JS)
        // → on fera le compte après avoir récupéré les IDs d'intervention
        ['00000000-0000-0000-0000-000000000000'], // placeholder, remplacé ci-dessous
      ),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .in('mission_id', allMissionIds),
  ])

  type MRow = { name: string; site: { name: string } | { name: string }[] | null }
  const recentInterventions = (
    (interventionRes.data ?? []) as Array<{
      id: string
      status: string
      slot: string | null
      scheduled_for: string | null
      mission: MRow | MRow[] | null
    }>
  ).map((r) => {
    const mission = pickOne(r.mission)
    const site = pickOne(mission?.site ?? null)
    return {
      id: r.id,
      missionName: mission?.name ?? '—',
      siteName: (site as { name: string } | null)?.name ?? '—',
      scheduled_for: r.scheduled_for,
      status: r.status,
      slot: r.slot,
    }
  })

  // Anomalies ouvertes : on récupère le compte via les IDs d'intervention réels
  const allInterventionIds = recentInterventions.map((r) => r.id)
  let openAnomalyCount = 0
  if (allInterventionIds.length > 0) {
    const { count } = await supabase
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .in('intervention_id', allInterventionIds)
    openAnomalyCount = count ?? 0
  }

  return {
    ...c,
    sites: sitesWithCount,
    contracts,
    recentInterventions,
    openAnomalyCount,
    totalInterventionCount: totalRes.count ?? 0,
  }
}

// ── Cockpit client : signaux d'attention, pas d'historique ─────────────────
// Doctrine (Vincent) : pas de score % inventé — des SIGNAUX concrets et
// déterministes. « Risques en cours » + « À faire cette semaine ».

const CRITICAL_ANOMALY_CATEGORIES = new Set([
  'danger_securite', 'electricite_coupee', 'eau_coupee',
])
const SITE_STALE_DAYS = 21

export type SiteHealthLevel = 'green' | 'orange' | 'red'

export interface ClientSiteHealth {
  siteId: string
  siteName: string
  level: SiteHealthLevel
  reason: string
  interventionCount: number
}

export interface ClientCockpit {
  /** Résumé « client aujourd'hui » — lecture 4 s. */
  today: {
    sitesGreen: number
    sitesOrange: number
    sitesRed: number
    criticalAnomalies: number
    proofCount: number
    next: { siteName: string; missionName: string; scheduled_for: string; slot: string | null } | null
  }
  risks: {
    openAnomalies: number
    criticalAnomalies: number
    missionsWithoutTeam: number
    staleOpenActions: number // actions ouvertes > 7 jours
    sitesNotVisited: Array<{ siteId: string; siteName: string; days: number | null }>
    criticalAnomalySites: string[] // sites portant une anomalie critique
  }
  /** Santé + charge par site (remplace la heatmap). */
  sites: ClientSiteHealth[]
  thisWeek: Array<{
    interventionId: string
    siteName: string
    missionName: string
    scheduled_for: string
    slot: string | null
  }>
}

function daysSinceUtc(iso: string, todayIso: string): number {
  const a = new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime()
  const b = new Date(todayIso + 'T00:00:00Z').getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export async function getClientCockpit(clientId: string, todayIso: string): Promise<ClientCockpit> {
  const supabase = createAdminClient()
  const empty: ClientCockpit = {
    today: { sitesGreen: 0, sitesOrange: 0, sitesRed: 0, criticalAnomalies: 0, proofCount: 0, next: null },
    risks: { openAnomalies: 0, criticalAnomalies: 0, missionsWithoutTeam: 0, staleOpenActions: 0, sitesNotVisited: [], criticalAnomalySites: [] },
    sites: [],
    thisWeek: [],
  }

  // Sites du client
  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, name')
    .eq('client_id', clientId)
    .is('deleted_at', null)
  const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
  if (sites.length === 0) return empty
  const siteIds = sites.map((s) => s.id)
  const siteNameById = new Map(sites.map((s) => [s.id, s.name]))

  // Missions du client (sans équipe = assigned_team_id null)
  const { data: missionRows } = await supabase
    .from('missions')
    .select('id, name, site_id, assigned_team_id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  const missions = (missionRows ?? []) as Array<{ id: string; name: string; site_id: string; assigned_team_id: string | null }>
  const missionIds = missions.map((m) => m.id)
  const missionsWithoutTeam = missions.filter((m) => !m.assigned_team_id).length
  const missionMeta = new Map(missions.map((m) => [m.id, { name: m.name, site_id: m.site_id }]))

  // Actions ouvertes > 7 jours
  const { data: actionRows } = await supabase
    .from('site_actions')
    .select('id, created_at')
    .in('site_id', siteIds)
    .eq('status', 'open')
  const staleOpenActions = ((actionRows ?? []) as Array<{ id: string; created_at: string }>)
    .filter((a) => daysSinceUtc(a.created_at, todayIso) > 7).length

  if (missionIds.length === 0) {
    const sitesHealth: ClientSiteHealth[] = sites.map((s) => ({
      siteId: s.id, siteName: s.name, level: 'green', reason: 'pas d\'activité', interventionCount: 0,
    }))
    return {
      today: { sitesGreen: sites.length, sitesOrange: 0, sitesRed: 0, criticalAnomalies: 0, proofCount: 0, next: null },
      risks: {
        openAnomalies: 0, criticalAnomalies: 0, missionsWithoutTeam, staleOpenActions,
        sitesNotVisited: sites.map((s) => ({ siteId: s.id, siteName: s.name, days: null })),
        criticalAnomalySites: [],
      },
      sites: sitesHealth,
      thisWeek: [],
    }
  }

  // Interventions du client (pour dernière visite/site + à faire cette semaine + anomalies)
  const { data: interventionRows } = await supabase
    .from('interventions')
    .select('id, mission_id, scheduled_for, slot, status, executed_at')
    .in('mission_id', missionIds)
  const interventions = (interventionRows ?? []) as Array<{
    id: string; mission_id: string; scheduled_for: string | null; slot: string | null
    status: string; executed_at: string | null
  }>
  const interventionIds = interventions.map((i) => i.id)

  // Dernière visite par site (max executed_at)
  const lastVisitBySite = new Map<string, string>()
  for (const iv of interventions) {
    if (!iv.executed_at) continue
    const siteId = missionMeta.get(iv.mission_id)?.site_id
    if (!siteId) continue
    const cur = lastVisitBySite.get(siteId)
    if (!cur || iv.executed_at > cur) lastVisitBySite.set(siteId, iv.executed_at)
  }
  const sitesNotVisited = sites
    .map((s) => {
      const last = lastVisitBySite.get(s.id)
      const days = last ? daysSinceUtc(last, todayIso) : null
      return { siteId: s.id, siteName: s.name, days }
    })
    .filter((s) => s.days === null || s.days > SITE_STALE_DAYS)
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999))

  // À faire cette semaine : interventions planifiées dans les 7 prochains jours
  const weekEnd = new Date(todayIso + 'T00:00:00Z')
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
  const weekEndIso = weekEnd.toISOString().slice(0, 10)
  const thisWeek = interventions
    .filter((iv) => iv.status === 'planned' && iv.scheduled_for && iv.scheduled_for >= todayIso && iv.scheduled_for <= weekEndIso)
    .sort((a, b) => (a.scheduled_for! < b.scheduled_for! ? -1 : 1))
    .slice(0, 12)
    .map((iv) => {
      const meta = missionMeta.get(iv.mission_id)
      return {
        interventionId: iv.id,
        siteName: meta ? (siteNameById.get(meta.site_id) ?? '—') : '—',
        missionName: meta?.name ?? '—',
        scheduled_for: iv.scheduled_for!,
        slot: iv.slot,
      }
    })

  // Charge par site (nombre d'interventions) + map intervention → site
  const interventionCountBySite = new Map<string, number>()
  const siteByIntervention = new Map<string, string>()
  for (const iv of interventions) {
    const siteId = missionMeta.get(iv.mission_id)?.site_id
    if (!siteId) continue
    siteByIntervention.set(iv.id, siteId)
    interventionCountBySite.set(siteId, (interventionCountBySite.get(siteId) ?? 0) + 1)
  }

  // Anomalies ouvertes (+ critiques) — comptées globalement ET par site
  let openAnomalies = 0
  let criticalAnomalies = 0
  const anomaliesBySite = new Map<string, number>()
  const criticalBySite = new Map<string, number>()
  if (interventionIds.length > 0) {
    const { data: anomalyRows } = await supabase
      .from('intervention_anomalies')
      .select('category, intervention_id')
      .eq('status', 'open')
      .in('intervention_id', interventionIds)
    const anomalies = (anomalyRows ?? []) as Array<{ category: string; intervention_id: string }>
    openAnomalies = anomalies.length
    for (const a of anomalies) {
      const isCritical = CRITICAL_ANOMALY_CATEGORIES.has(a.category)
      if (isCritical) criticalAnomalies++
      const siteId = siteByIntervention.get(a.intervention_id)
      if (!siteId) continue
      anomaliesBySite.set(siteId, (anomaliesBySite.get(siteId) ?? 0) + 1)
      if (isCritical) criticalBySite.set(siteId, (criticalBySite.get(siteId) ?? 0) + 1)
    }
  }

  // Preuves enregistrées (photos) sur les interventions du client
  let proofCount = 0
  if (interventionIds.length > 0) {
    const { count } = await supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', interventionIds)
    proofCount = count ?? 0
  }

  // Santé par site (déterministe) : red = anomalie critique ; orange = anomalies
  // OU non vu > 21j ; green sinon.
  const sitesHealth: ClientSiteHealth[] = sites.map((s) => {
    const last = lastVisitBySite.get(s.id)
    const days = last ? daysSinceUtc(last, todayIso) : null
    const crit = criticalBySite.get(s.id) ?? 0
    const anoms = anomaliesBySite.get(s.id) ?? 0
    let level: SiteHealthLevel = 'green'
    let reason = 'en rythme'
    if (crit > 0) { level = 'red'; reason = `${crit} anomalie${crit > 1 ? 's' : ''} critique${crit > 1 ? 's' : ''}` }
    else if (anoms > 0) { level = 'orange'; reason = `${anoms} anomalie${anoms > 1 ? 's' : ''} ouverte${anoms > 1 ? 's' : ''}` }
    else if (days !== null && days > SITE_STALE_DAYS) { level = 'orange'; reason = `non vu depuis ${days} j` }
    else if (days === null && (interventionCountBySite.get(s.id) ?? 0) === 0) { reason = 'pas encore d\'activité' }
    return { siteId: s.id, siteName: s.name, level, reason, interventionCount: interventionCountBySite.get(s.id) ?? 0 }
  }).sort((a, b) => b.interventionCount - a.interventionCount)

  const criticalAnomalySites = sites.filter((s) => (criticalBySite.get(s.id) ?? 0) > 0).map((s) => s.name)
  const next = thisWeek[0]
    ? { siteName: thisWeek[0].siteName, missionName: thisWeek[0].missionName, scheduled_for: thisWeek[0].scheduled_for, slot: thisWeek[0].slot }
    : null

  return {
    today: {
      sitesGreen: sitesHealth.filter((s) => s.level === 'green').length,
      sitesOrange: sitesHealth.filter((s) => s.level === 'orange').length,
      sitesRed: sitesHealth.filter((s) => s.level === 'red').length,
      criticalAnomalies,
      proofCount,
      next,
    },
    risks: { openAnomalies, criticalAnomalies, missionsWithoutTeam, staleOpenActions, sitesNotVisited, criticalAnomalySites },
    sites: sitesHealth,
    thisWeek,
  }
}
