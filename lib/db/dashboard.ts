import type { EngagementComplianceRatios } from '@/types/db'

// Phase 11 — Slice 11.0 : helpers DB cockpit dashboard.
//
// Doctrine V3 stricte appliquée :
//   - Aucune métrique par agent / par équipe / par utilisateur.
//   - Tout est agrégé par engagement, contrat, intervention ou compteur anonyme.
//   - Les labels d'activité ne contiennent JAMAIS de nom d'agent.
//   - Test ultime : « si tous les humains étaient remplacés par des
//     identifiants abstraits, la valeur métier reste-t-elle intacte ? » Oui.
//
// Le dashboard répond à 4 questions DG :
//   1. Tout tient ce matin ? (bandeau 4 stats + anomalies)
//   2. Où regarder ? (engagements à surveiller, contrats sous tension)
//   3. Qu'a-t-on accompli cette semaine ? (week pulse, activité récente)
//   4. Mon capital de preuves grandit-il ? (capital depuis démarrage)

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

// ============================================================================
// Bandeau — 4 stats du cockpit du matin
// ============================================================================

export interface WeekPulse {
  interventionsExecuted: number
  photosCount: number
  validationsCount: number
  unassignedCount: number
  conflictCount: number
}

export interface CapitalPreuves {
  totalPhotos: number
  totalInterventionsExecuted: number
  totalContractsActive: number
}

export interface TenantCumulativeStats {
  totalInterventions: number
  totalPhotos: number
  totalAnomaliesResolved: number
}

export interface AOPipeline {
  analyzing: number
  ready: number
  submitted: number
  renewalsDue: number
}

export interface AOSnapshot {
  activeCount: number
  dueSoonCount: number
  wonThisMonthCount: number
}

export interface TenderDueSoonRow {
  id: string
  title: string
  client_name: string | null
  deadline: string
  daysUntilDeadline: number
  status: string
}

export interface OpenAnomaliesStats {
  total: number
  oldCount: number
}

const EXECUTED_STATUSES = ['completed', 'validated'] as const

function startOfWeekIso(now: Date = new Date()): string {
  const d = new Date(now.toISOString())
  const jsDay = d.getUTCDay()
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1
  d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getWeekPulse(): Promise<WeekPulse> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const since = startOfWeekIso()

  const sinceDate = new Date(since)
  const endDate = new Date(sinceDate)
  endDate.setUTCDate(endDate.getUTCDate() + 6)
  endDate.setUTCHours(23, 59, 59, 999)
  const weekStartIso = since.slice(0, 10)
  const weekEndIso = endDate.toISOString().slice(0, 10)

  let q = supabase
    .from('interventions')
    .select('id')
    .in('status', EXECUTED_STATUSES as unknown as string[])
    .gte('executed_at', since)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data: interventions, error: intErr } = await q
  if (intErr) throw intErr

  const ids = (interventions ?? []).map((i) => i.id as string)

  const { getWeekVigilance } = await import('@/lib/db/week-vigilance')
  const vigilancePromise = getWeekVigilance(weekStartIso, weekEndIso)

  if (ids.length === 0) {
    const v = await vigilancePromise
    return {
      interventionsExecuted: 0,
      photosCount: 0,
      validationsCount: 0,
      unassignedCount: v.unassigned.length,
      conflictCount: v.conflicts.length,
    }
  }

  const [photosRes, validationsRes, vigilance] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', ids),
    supabase
      .from('intervention_validations')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', ids),
    vigilancePromise,
  ])
  if (photosRes.error) throw photosRes.error
  if (validationsRes.error) throw validationsRes.error

  return {
    interventionsExecuted: ids.length,
    photosCount: photosRes.count ?? 0,
    validationsCount: validationsRes.count ?? 0,
    unassignedCount: vigilance.unassigned.length,
    conflictCount: vigilance.conflicts.length,
  }
}

export async function getCapitalPreuves(): Promise<CapitalPreuves> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → zéros, jamais les
  // compteurs de tous les tenants.
  if (!orgId) return { totalPhotos: 0, totalInterventionsExecuted: 0, totalContractsActive: 0 }

  const [photosRes, interventionsRes, contractsRes] = await Promise.all([
    // intervention_photos n'a pas org_id — scope via le join interventions.
    supabase
      .from('intervention_photos')
      .select('id, intervention:interventions!inner(organization_id)', { count: 'exact', head: true })
      .eq('intervention.organization_id', orgId),
    supabase.from('interventions').select('id', { count: 'exact', head: true })
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .eq('organization_id', orgId),
    supabase.from('contracts').select('id', { count: 'exact', head: true })
      .eq('status', 'active').is('deleted_at', null)
      .eq('organization_id', orgId),
  ])
  if (photosRes.error) throw photosRes.error
  if (interventionsRes.error) throw interventionsRes.error
  if (contractsRes.error) throw contractsRes.error

  return {
    totalPhotos: photosRes.count ?? 0,
    totalInterventionsExecuted: interventionsRes.count ?? 0,
    totalContractsActive: contractsRes.count ?? 0,
  }
}

export async function getTenantCumulativeStats(): Promise<TenantCumulativeStats> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → zéros.
  if (!orgId) return { totalInterventions: 0, totalPhotos: 0, totalAnomaliesResolved: 0 }

  const [interventionsRes, photosRes, anomaliesRes] = await Promise.all([
    supabase.from('interventions').select('id', { count: 'exact', head: true })
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .eq('organization_id', orgId),
    // Tables sans org_id — scope via le join interventions.
    supabase
      .from('intervention_photos')
      .select('id, intervention:interventions!inner(organization_id)', { count: 'exact', head: true })
      .eq('intervention.organization_id', orgId),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention:interventions!inner(organization_id)', { count: 'exact', head: true })
      .not('resolved_at', 'is', null)
      .eq('intervention.organization_id', orgId),
  ])
  if (interventionsRes.error) throw interventionsRes.error
  if (photosRes.error) throw photosRes.error
  if (anomaliesRes.error) throw anomaliesRes.error

  return {
    totalInterventions: interventionsRes.count ?? 0,
    totalPhotos: photosRes.count ?? 0,
    totalAnomaliesResolved: anomaliesRes.count ?? 0,
  }
}

const TENDER_ACTIVE_STATUSES = ['draft', 'extracting', 'analyzing', 'ready', 'submitted'] as const

export async function getAOPipeline(): Promise<AOPipeline> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const today = todayLocalIso()
  const horizonIso = addDaysLocal(today, 60)

  const base = () => {
    let q = supabase.from('tenders').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    if (orgId) q = q.eq('organization_id', orgId)
    return q
  }
  const baseContracts = () => {
    let q = supabase.from('contracts').select('id', { count: 'exact', head: true })
    if (orgId) q = q.eq('organization_id', orgId)
    return q
  }

  const [analyzingRes, readyRes, submittedRes, renewalsRes] = await Promise.all([
    base().in('status', ['analyzing', 'extracting']),
    base().eq('status', 'ready'),
    base().eq('status', 'submitted'),
    baseContracts().gte('end_date', today).lte('end_date', horizonIso).in('status', ['active', 'paused']),
  ])
  if (analyzingRes.error) throw analyzingRes.error
  if (readyRes.error) throw readyRes.error
  if (submittedRes.error) throw submittedRes.error
  if (renewalsRes.error) throw renewalsRes.error

  return {
    analyzing: analyzingRes.count ?? 0,
    ready: readyRes.count ?? 0,
    submitted: submittedRes.count ?? 0,
    renewalsDue: renewalsRes.count ?? 0,
  }
}

export async function getAOSnapshot(): Promise<AOSnapshot> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const today = todayLocalIso()
  const dueSoonHorizon = addDaysLocal(today, 7)
  const now = new Date()
  const monthStartIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

  const base = () => {
    let q = supabase.from('tenders').select('id', { count: 'exact', head: true })
      .in('status', TENDER_ACTIVE_STATUSES as unknown as string[])
      .is('deleted_at', null)
      .or('outcome.is.null,outcome.eq.pending')
    if (orgId) q = q.eq('organization_id', orgId)
    return q
  }

  const [activeRes, dueSoonRes, wonRes] = await Promise.all([
    base(),
    base().gte('deadline', today).lte('deadline', dueSoonHorizon),
    (() => {
      let q = supabase.from('tenders').select('id', { count: 'exact', head: true })
        .eq('outcome', 'won').gte('outcome_at', monthStartIso).is('deleted_at', null)
      if (orgId) q = q.eq('organization_id', orgId)
      return q
    })(),
  ])

  if (activeRes.error) throw activeRes.error
  if (dueSoonRes.error) throw dueSoonRes.error
  if (wonRes.error) throw wonRes.error

  return {
    activeCount: activeRes.count ?? 0,
    dueSoonCount: dueSoonRes.count ?? 0,
    wonThisMonthCount: wonRes.count ?? 0,
  }
}

export async function listTendersDueSoon(days: number = 7): Promise<TenderDueSoonRow[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const today = todayLocalIso()
  const horizon = addDaysLocal(today, days)

  let q = supabase
    .from('tenders')
    .select('id, title, client_name, deadline, status')
    .in('status', TENDER_ACTIVE_STATUSES as unknown as string[])
    .is('deleted_at', null)
    .or('outcome.is.null,outcome.eq.pending')
    .gte('deadline', today)
    .lte('deadline', horizon)
    .order('deadline', { ascending: true })
  if (orgId) q = q.eq('organization_id', orgId)

  const { data, error } = await q
  if (error) throw error

  const todayMs = new Date(today + 'T00:00:00Z').getTime()
  return (data ?? []).map((row) => {
    const r = row as { id: string; title: string; client_name: string | null; deadline: string; status: string }
    const deadlineMs = new Date(r.deadline + 'T00:00:00Z').getTime()
    return {
      id: r.id,
      title: r.title,
      client_name: r.client_name,
      deadline: r.deadline,
      daysUntilDeadline: Math.floor((deadlineMs - todayMs) / (24 * 60 * 60 * 1000)),
      status: r.status,
    }
  })
}

export async function getOpenAnomaliesStats(): Promise<OpenAnomaliesStats> {
  const supabase = createAdminClient()
  const orgId = await getOrgId() // scope ORG (admin client bypasse les RLS)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  let totalQ = supabase.from('intervention_anomalies').select('id', { count: 'exact', head: true }).is('resolved_at', null)
  let oldQ = supabase.from('intervention_anomalies').select('id', { count: 'exact', head: true })
    .is('resolved_at', null).lt('created_at', threeDaysAgo)
  if (orgId) { totalQ = totalQ.eq('organization_id', orgId); oldQ = oldQ.eq('organization_id', orgId) }
  const [totalRes, oldRes] = await Promise.all([totalQ, oldQ])
  if (totalRes.error) throw totalRes.error
  if (oldRes.error) throw oldRes.error
  return { total: totalRes.count ?? 0, oldCount: oldRes.count ?? 0 }
}

export async function getOpenAnomaliesStrict(): Promise<OpenAnomaliesStats> {
  const supabase = createAdminClient()
  const orgId = await getOrgId() // scope ORG (admin client bypasse les RLS)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  let totalQ = supabase.from('intervention_anomalies').select('id', { count: 'exact', head: true }).eq('status', 'open')
  let oldQ = supabase.from('intervention_anomalies').select('id', { count: 'exact', head: true })
    .eq('status', 'open').lt('created_at', threeDaysAgo)
  if (orgId) { totalQ = totalQ.eq('organization_id', orgId); oldQ = oldQ.eq('organization_id', orgId) }
  const [totalRes, oldRes] = await Promise.all([totalQ, oldQ])
  if (totalRes.error) throw totalRes.error
  if (oldRes.error) throw oldRes.error
  return { total: totalRes.count ?? 0, oldCount: oldRes.count ?? 0 }
}

export interface RecentAnomalyItem {
  id: string
  interventionId: string
  category: string
  categoryOther: string | null
  description: string | null
  siteName: string | null
  createdAt: string
}

export async function getRecentAnomalies(windowHours = 24): Promise<RecentAnomalyItem[]> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

  // intervention_anomalies n'a pas org_id — on filtre via le JOIN intervention
  let q = supabase
    .from('intervention_anomalies')
    .select(`
      id, intervention_id, category, category_other, description, created_at,
      intervention:interventions!intervention_id(
        mission:missions!mission_id(
          site:sites!site_id(name)
        )
      )
    `)
    .neq('status', 'ignored')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)

  // Si orgId disponible, on filtre via les interventions pour l'isolation
  if (orgId) {
    const { data: intvIds } = await supabase
      .from('interventions')
      .select('id')
      .eq('organization_id', orgId)
    const ids = (intvIds ?? []).map((i: { id: string }) => i.id)
    if (ids.length === 0) return []
    q = q.in('intervention_id', ids)
  }

  const { data, error } = await q
  if (error) { console.error('[getRecentAnomalies]', error); return [] }

  type Row = typeof data extends Array<infer R> ? R : never
  return (data ?? []).map((r: Row) => {
    const raw = r as Record<string, unknown>
    const intv = raw.intervention as Record<string, unknown> | null
    const mission = (Array.isArray(intv) ? intv[0] : intv)?.mission as Record<string, unknown> | null
    const missionRow = Array.isArray(mission) ? mission[0] : mission
    const site = missionRow?.site as Record<string, unknown> | null
    const siteRow = Array.isArray(site) ? site[0] : site
    return {
      id: r.id,
      interventionId: r.intervention_id,
      category: r.category,
      categoryOther: r.category_other,
      description: r.description,
      siteName: (siteRow?.name as string | null) ?? null,
      createdAt: r.created_at,
    }
  })
}

export interface AtRiskEngagement {
  engagement_id: string
  short_label: string
  contract_id: string
  contract_name: string
  reason: 'no_intervention_recent' | 'deadline_close' | 'high_skip_rate'
  reasonDetail: string
}

const ATRISK_NO_INTERVENTION_DAYS = 7
const ATRISK_LIMIT = 5

export async function getAtRiskEngagements(): Promise<AtRiskEngagement[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  let contractsQ = supabase.from('contracts').select('id, name').eq('status', 'active').is('deleted_at', null)
  if (orgId) contractsQ = contractsQ.eq('organization_id', orgId)
  const { data: contracts, error: cErr } = await contractsQ
  if (cErr) throw cErr
  const activeContracts = contracts ?? []
  if (activeContracts.length === 0) return []
  const contractById = new Map(activeContracts.map((c) => [c.id as string, c.name as string]))

  let engQ = supabase.from('engagements').select('id, contract_id, short_label')
    .in('status', ['active', 'curated']).in('contract_id', Array.from(contractById.keys()))
  if (orgId) engQ = engQ.eq('organization_id', orgId)
  const { data: engagements, error: eErr } = await engQ
  if (eErr) throw eErr
  const allEngagements = (engagements ?? []) as Array<{ id: string; contract_id: string; short_label: string }>
  if (allEngagements.length === 0) return []

  const engagementIds = allEngagements.map((e) => e.id)
  let mQ = supabase.from('missions').select('id, engagement_ids').overlaps('engagement_ids', engagementIds).is('deleted_at', null)
  if (orgId) mQ = mQ.eq('organization_id', orgId)
  const { data: missions, error: mErr } = await mQ
  if (mErr) throw mErr
  const allMissions = (missions ?? []) as Array<{ id: string; engagement_ids: string[] }>

  const missionsByEngagement = new Map<string, string[]>()
  for (const m of allMissions) {
    for (const eId of m.engagement_ids ?? []) {
      if (!missionsByEngagement.has(eId)) missionsByEngagement.set(eId, [])
      missionsByEngagement.get(eId)!.push(m.id)
    }
  }

  const cutoffIso = new Date(Date.now() - ATRISK_NO_INTERVENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const allMissionIds = Array.from(new Set(allMissions.map((m) => m.id)))
  const recentByMission = new Map<string, number>()

  if (allMissionIds.length > 0) {
    let iQ = supabase.from('interventions').select('mission_id, executed_at, status')
      .in('mission_id', allMissionIds).in('status', EXECUTED_STATUSES as unknown as string[]).gte('executed_at', cutoffIso)
    if (orgId) iQ = iQ.eq('organization_id', orgId)
    const { data: recentInterventions, error: riErr } = await iQ
    if (riErr) throw riErr
    for (const intv of recentInterventions ?? []) {
      const k = (intv as { mission_id: string }).mission_id
      recentByMission.set(k, (recentByMission.get(k) ?? 0) + 1)
    }
  }

  const lastExecutedByMission = new Map<string, string>()
  if (allMissionIds.length > 0) {
    let lQ = supabase.from('interventions').select('mission_id, executed_at')
      .in('mission_id', allMissionIds).in('status', EXECUTED_STATUSES as unknown as string[])
      .order('executed_at', { ascending: false }).limit(500)
    if (orgId) lQ = lQ.eq('organization_id', orgId)
    const { data: lastExec, error: leErr } = await lQ
    if (leErr) throw leErr
    for (const row of lastExec ?? []) {
      const r = row as { mission_id: string; executed_at: string | null }
      if (!r.executed_at) continue
      if (!lastExecutedByMission.has(r.mission_id)) lastExecutedByMission.set(r.mission_id, r.executed_at)
    }
  }

  const now = Date.now()
  const candidates: AtRiskEngagement[] = []
  for (const e of allEngagements) {
    const mIds = missionsByEngagement.get(e.id)
    if (!mIds || mIds.length === 0) continue
    const hasRecent = mIds.some((mid) => (recentByMission.get(mid) ?? 0) > 0)
    if (hasRecent) continue
    let lastExecIso: string | null = null
    for (const mid of mIds) {
      const t = lastExecutedByMission.get(mid)
      if (t && (!lastExecIso || t > lastExecIso)) lastExecIso = t
    }
    const daysSince = lastExecIso ? Math.floor((now - new Date(lastExecIso).getTime()) / (1000 * 60 * 60 * 24)) : null
    const reasonDetail = daysSince === null
      ? 'Aucune intervention exécutée à ce jour'
      : `Aucune intervention exécutée depuis ${daysSince} jour${daysSince > 1 ? 's' : ''}`
    candidates.push({
      engagement_id: e.id, short_label: e.short_label, contract_id: e.contract_id,
      contract_name: contractById.get(e.contract_id) ?? '', reason: 'no_intervention_recent', reasonDetail,
    })
  }

  const sortKey = new Map<string, number>()
  for (const c of candidates) {
    const m = c.reasonDetail.match(/depuis (\d+) jour/)
    sortKey.set(c.engagement_id, m ? -parseInt(m[1], 10) : -Number.MAX_SAFE_INTEGER)
  }
  candidates.sort((a, b) => (sortKey.get(a.engagement_id)! - sortKey.get(b.engagement_id)!))
  return candidates.slice(0, ATRISK_LIMIT)
}

export interface ContractUnderTension {
  contract_id: string
  contract_name: string
  segmentScores: { promised: number; planned: number; executed: number; proven: number; validated: number }
  globalScore: number
  reasonDetail: string
}

const TENSION_GLOBAL_THRESHOLD = 0.7
const TENSION_SEGMENT_THRESHOLD = 0.5
const TENSION_RECENT_DAYS = 30
const TENSION_LIMIT = 5

export async function getContractsUnderTension(): Promise<ContractUnderTension[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  let cQ = supabase.from('contracts').select('id, name').eq('status', 'active').is('deleted_at', null)
  if (orgId) cQ = cQ.eq('organization_id', orgId)
  const { data: contracts, error: cErr } = await cQ
  if (cErr) throw cErr
  const activeContracts = (contracts ?? []) as Array<{ id: string; name: string }>
  if (activeContracts.length === 0) return []

  const contractIds = activeContracts.map((c) => c.id)

  let eQ = supabase.from('engagements').select('id, contract_id').in('contract_id', contractIds).in('status', ['active', 'curated'])
  if (orgId) eQ = eQ.eq('organization_id', orgId)
  const { data: engagements, error: eErr } = await eQ
  if (eErr) throw eErr
  const engagementsByContract = new Map<string, string[]>()
  for (const e of engagements ?? []) {
    const row = e as { id: string; contract_id: string }
    if (!engagementsByContract.has(row.contract_id)) engagementsByContract.set(row.contract_id, [])
    engagementsByContract.get(row.contract_id)!.push(row.id)
  }

  const allEngagementIds = (engagements ?? []).map((e) => (e as { id: string }).id)
  const missionToEngagements = new Map<string, string[]>()
  let missionIdsCovering: string[] = []
  if (allEngagementIds.length > 0) {
    let mQ = supabase.from('missions').select('id, engagement_ids').overlaps('engagement_ids', allEngagementIds).is('deleted_at', null)
    if (orgId) mQ = mQ.eq('organization_id', orgId)
    const { data: missions, error: mErr } = await mQ
    if (mErr) throw mErr
    for (const m of missions ?? []) {
      const row = m as { id: string; engagement_ids: string[] }
      const filtered = (row.engagement_ids ?? []).filter((eId) => allEngagementIds.includes(eId))
      missionToEngagements.set(row.id, filtered)
    }
    missionIdsCovering = Array.from(missionToEngagements.keys())
  }

  const cutoffIso = new Date(Date.now() - TENSION_RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const executedByMission = new Map<string, Array<{ id: string; status: string }>>()
  const interventionIds: string[] = []
  if (missionIdsCovering.length > 0) {
    let iQ = supabase.from('interventions').select('id, mission_id, status, executed_at')
      .in('mission_id', missionIdsCovering).in('status', EXECUTED_STATUSES as unknown as string[]).gte('executed_at', cutoffIso)
    if (orgId) iQ = iQ.eq('organization_id', orgId)
    const { data: interventions, error: iErr } = await iQ
    if (iErr) throw iErr
    for (const row of interventions ?? []) {
      const r = row as { id: string; mission_id: string; status: string }
      if (!executedByMission.has(r.mission_id)) executedByMission.set(r.mission_id, [])
      executedByMission.get(r.mission_id)!.push({ id: r.id, status: r.status })
      interventionIds.push(r.id)
    }
  }

  const photosByIntervention = new Set<string>()
  if (interventionIds.length > 0) {
    const { data: photos, error: pErr } = await supabase
      .from('intervention_photos').select('intervention_id').in('intervention_id', interventionIds)
    if (pErr) throw pErr
    for (const p of photos ?? []) photosByIntervention.add((p as { intervention_id: string }).intervention_id)
  }

  const results: ContractUnderTension[] = []
  for (const c of activeContracts) {
    const eIds = engagementsByContract.get(c.id) ?? []
    const totalE = eIds.length
    const promised = totalE > 0 ? 1 : 0
    if (totalE === 0) {
      results.push({ contract_id: c.id, contract_name: c.name,
        segmentScores: { promised: 0, planned: 0, executed: 0, proven: 0, validated: 0 },
        globalScore: 0, reasonDetail: 'Aucune promesse active à ce contrat' })
      continue
    }
    const engagementToMissions = new Map<string, string[]>()
    for (const [mid, eList] of missionToEngagements.entries()) {
      for (const eId of eList) {
        if (!engagementToMissions.has(eId)) engagementToMissions.set(eId, [])
        engagementToMissions.get(eId)!.push(mid)
      }
    }
    let plannedCount = 0, executedCount = 0, provenCount = 0, validatedCount = 0
    for (const eId of eIds) {
      const mIds = engagementToMissions.get(eId) ?? []
      if (mIds.length === 0) continue
      plannedCount += 1
      const intvs = mIds.flatMap((mid) => executedByMission.get(mid) ?? [])
      if (intvs.length === 0) continue
      executedCount += 1
      if (intvs.some((iv) => photosByIntervention.has(iv.id))) provenCount += 1
      if (intvs.some((iv) => iv.status === 'validated')) validatedCount += 1
    }
    const segmentScores = {
      promised, planned: plannedCount / totalE, executed: executedCount / totalE,
      proven: provenCount / totalE, validated: validatedCount / totalE,
    }
    const globalScore = (segmentScores.promised + segmentScores.planned + segmentScores.executed + segmentScores.proven + segmentScores.validated) / 5
    const weakest = Object.entries(segmentScores).sort((a, b) => a[1] - b[1])[0]
    if (globalScore >= TENSION_GLOBAL_THRESHOLD && weakest[1] >= TENSION_SEGMENT_THRESHOLD) continue
    const labelByKey: Record<string, string> = { promised: 'promesses', planned: 'planification', executed: 'exécution', proven: 'preuves', validated: 'validation' }
    results.push({ contract_id: c.id, contract_name: c.name, segmentScores, globalScore,
      reasonDetail: `Maillon faible : ${labelByKey[weakest[0]]} (${Math.round(weakest[1] * 100)}%)` })
  }
  results.sort((a, b) => a.globalScore - b.globalScore)
  return results.slice(0, TENSION_LIMIT)
}

export type RecentActivityType =
  | 'intervention_executed' | 'intervention_validated' | 'anomaly_resolved'
  | 'tender_ready' | 'contract_activated' | 'evidence_inserted'

export interface RecentActivityEvent {
  type: RecentActivityType
  occurredAt: string
  label: string
  contextLabel: string
  href?: string
}

const RECENT_DEFAULT_LIMIT = 10
const RECENT_LOOKBACK_DAYS = 30

export async function getRecentActivity(limit = RECENT_DEFAULT_LIMIT): Promise<RecentActivityEvent[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const cutoffIso = new Date(Date.now() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const fetchLimit = Math.max(limit * 2, 30)

  function compact(text: string, max = 80): string {
    return text.length <= max ? text : text.slice(0, max - 1) + '…'
  }

  let intvQ = supabase.from('interventions')
    .select(`id, status, executed_at, scheduled_at,
             mission:missions(name, site:sites(name, contract:contracts(name)))`)
    .in('status', ['completed', 'validated'])
    .gte('executed_at', cutoffIso)
    .order('executed_at', { ascending: false })
    .limit(fetchLimit)
  if (orgId) intvQ = intvQ.eq('organization_id', orgId)
  const { data: intvData } = await intvQ

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }
  type IntvRaw = { id: string; status: string; executed_at: string | null; mission?: unknown }

  const interventionIdsForPhotos: string[] = []
  const intvBase: Array<{ id: string; status: string; executed_at: string; missionName: string; siteName: string; contractName: string }> = []
  for (const row of (intvData ?? []) as unknown as IntvRaw[]) {
    if (!row.executed_at) continue
    const missionRaw = pickOne<{ name: string; site?: unknown }>(row.mission)
    const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
    const contractRaw = siteRaw ? pickOne<{ name: string }>(siteRaw.contract) : null
    intvBase.push({ id: row.id, status: row.status, executed_at: row.executed_at,
      missionName: missionRaw?.name ?? 'Intervention', siteName: siteRaw?.name ?? '', contractName: contractRaw?.name ?? '' })
    interventionIdsForPhotos.push(row.id)
  }

  const photosByIntv = new Map<string, number>()
  if (interventionIdsForPhotos.length > 0) {
    const { data: photos } = await supabase.from('intervention_photos').select('intervention_id').in('intervention_id', interventionIdsForPhotos)
    for (const p of photos ?? []) {
      const k = (p as { intervention_id: string }).intervention_id
      photosByIntv.set(k, (photosByIntv.get(k) ?? 0) + 1)
    }
  }

  const events: RecentActivityEvent[] = []
  for (const row of intvBase) {
    const photos = photosByIntv.get(row.id) ?? 0
    const photoSuffix = photos > 0 ? ` · ${photos} photo${photos > 1 ? 's' : ''}` : ''
    events.push({ type: 'intervention_executed', occurredAt: row.executed_at,
      label: compact(`${row.missionName} exécutée${photoSuffix}`),
      contextLabel: row.contractName || row.siteName, href: `/preuves/${row.id}` })
    if (row.status === 'validated') {
      events.push({ type: 'intervention_validated', occurredAt: row.executed_at,
        label: compact(`${row.missionName} validée`),
        contextLabel: row.contractName || row.siteName, href: `/preuves/${row.id}` })
    }
  }

  const anomQ = supabase.from('intervention_anomalies')
    .select('id, resolved_at, category, intervention_id')
    .not('resolved_at', 'is', null).gte('resolved_at', cutoffIso)
    .order('resolved_at', { ascending: false }).limit(fetchLimit)
  const { data: anomData } = await anomQ
  const anomIntvIds = Array.from(new Set(((anomData ?? []) as Array<{ intervention_id: string }>).map((a) => a.intervention_id)))
  const ctxByIntv = new Map<string, { siteName: string; contractName: string }>()
  if (anomIntvIds.length > 0) {
    let cQ = supabase.from('interventions').select(`id, mission:missions(site:sites(name, contract:contracts(name)))`).in('id', anomIntvIds)
    if (orgId) cQ = cQ.eq('organization_id', orgId)
    const { data: intvForAnom } = await cQ
    for (const row of (intvForAnom ?? []) as unknown as Array<{ id: string; mission?: unknown }>) {
      const missionRaw = pickOne<{ site?: unknown }>(row.mission)
      const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
      const contractRaw = siteRaw ? pickOne<{ name: string }>(siteRaw.contract) : null
      ctxByIntv.set(row.id, { siteName: siteRaw?.name ?? '', contractName: contractRaw?.name ?? '' })
    }
  }
  for (const a of (anomData ?? []) as Array<{ id: string; resolved_at: string; category: string; intervention_id: string }>) {
    const ctx = ctxByIntv.get(a.intervention_id)
    events.push({ type: 'anomaly_resolved', occurredAt: a.resolved_at, label: 'Anomalie résolue',
      contextLabel: ctx?.contractName || ctx?.siteName || '', href: `/preuves/${a.intervention_id}` })
  }

  let tendQ = supabase.from('tenders').select('id, title, client_name, created_at')
    .eq('status', 'ready').gte('created_at', cutoffIso).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(fetchLimit)
  if (orgId) tendQ = tendQ.eq('organization_id', orgId)
  const { data: tendersReady } = await tendQ
  for (const t of (tendersReady ?? []) as Array<{ id: string; title: string; client_name: string | null; created_at: string }>) {
    events.push({ type: 'tender_ready', occurredAt: t.created_at,
      label: compact(`Mémoire technique « ${t.title} » générée`),
      contextLabel: t.client_name ?? '', href: `/tenders/${t.id}` })
  }

  let contrQ = supabase.from('contracts').select('id, name, client_name, created_at')
    .eq('status', 'active').is('deleted_at', null).gte('created_at', cutoffIso)
    .order('created_at', { ascending: false }).limit(fetchLimit)
  if (orgId) contrQ = contrQ.eq('organization_id', orgId)
  const { data: contractsRecent } = await contrQ
  for (const c of (contractsRecent ?? []) as Array<{ id: string; name: string; client_name: string; created_at: string }>) {
    events.push({ type: 'contract_activated', occurredAt: c.created_at,
      label: compact(`Contrat « ${c.name} » activé`), contextLabel: c.client_name, href: `/contracts/${c.id}` })
  }

  let engQ2 = supabase.from('engagements').select('id, short_label, contract_id, updated_at, status')
    .eq('status', 'active').gte('updated_at', cutoffIso)
    .order('updated_at', { ascending: false }).limit(fetchLimit)
  if (orgId) engQ2 = engQ2.eq('organization_id', orgId)
  const { data: engagementsActivated } = await engQ2
  const engContractIds = Array.from(new Set(((engagementsActivated ?? []) as Array<{ contract_id: string | null }>)
    .map((e) => e.contract_id).filter((id): id is string => !!id)))
  const contractNameById = new Map<string, string>()
  if (engContractIds.length > 0) {
    const { data: cNames } = await supabase.from('contracts').select('id, name').in('id', engContractIds)
    for (const row of (cNames ?? []) as Array<{ id: string; name: string }>) contractNameById.set(row.id, row.name)
  }
  for (const e of (engagementsActivated ?? []) as Array<{ id: string; short_label: string; contract_id: string | null; updated_at: string }>) {
    events.push({ type: 'evidence_inserted', occurredAt: e.updated_at,
      label: compact(`Engagement activé : « ${e.short_label} »`),
      contextLabel: e.contract_id ? contractNameById.get(e.contract_id) ?? '' : '',
      href: e.contract_id ? `/contracts/${e.contract_id}` : undefined })
  }

  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
  return events.slice(0, limit)
}

export type ContractConfidenceLevel = 'high' | 'medium' | 'low'

export interface ContractSummary {
  contractId: string
  engagementsTotal: number
  averageRatios: EngagementComplianceRatios
  proofCoverage: number
  confidenceLevel: ContractConfidenceLevel
  needsAttention: boolean
}

export async function getContractSummaries(contractIds: string[]): Promise<Map<string, ContractSummary>> {
  if (contractIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('contract_summaries', { p_contract_ids: contractIds })
  if (error) { console.error('[getContractSummaries]', error); return new Map() }
  const map = new Map<string, ContractSummary>()
  for (const row of (data ?? []) as Array<{
    contract_id: string; engagements_total: number; planned: number; executed: number;
    proven: number; validated: number; proof_coverage: number;
    confidence_level: ContractConfidenceLevel; needs_attention: boolean
  }>) {
    map.set(row.contract_id, {
      contractId: row.contract_id, engagementsTotal: row.engagements_total,
      averageRatios: { promised: row.engagements_total > 0, planned: Number(row.planned ?? 0),
        executed: Number(row.executed ?? 0), proven: Number(row.proven ?? 0), validated: Number(row.validated ?? 0) },
      proofCoverage: Number(row.proof_coverage ?? 0),
      confidenceLevel: row.confidence_level ?? 'low', needsAttention: row.needs_attention,
    })
  }
  return map
}
