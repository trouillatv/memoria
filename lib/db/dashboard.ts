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
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

// ============================================================================
// Bandeau — 4 stats du cockpit du matin
// ============================================================================

export interface WeekPulse {
  /** Interventions terminées ou validées depuis lundi 00:00 local. */
  interventionsExecuted: number
  /** Photos prises sur ces interventions (compteur anonyme). */
  photosCount: number
  /** Validations superviseur sur ces interventions (compteur anonyme). */
  validationsCount: number
  /** Vigilance semaine — interventions sans équipe sur la semaine en cours
   *  (planned/in_progress). Signal proactif pour rapatrier les oubliés. */
  unassignedCount: number
  /** Vigilance semaine — équipes affectées à 2+ sites différents sur le
   *  même créneau (date+slot) dans la semaine en cours. Donnée historique
   *  ou bypass : ne devrait jamais arriver en pratique. */
  conflictCount: number
}

export interface CapitalPreuves {
  /** Photos totales depuis le démarrage produit — count exact. */
  totalPhotos: number
  /** Interventions exécutées (completed ou validated) depuis le démarrage. */
  totalInterventionsExecuted: number
  /** Contrats actifs non supprimés. */
  totalContractsActive: number
}

/**
 * Sprint 5 UX-9 — Capital cumulé tenant (Doctrine V5).
 *
 * Compteurs factuels passifs pour le bandeau pied de dashboard. Pas de score,
 * pas de comparaison, pas de classement. Argument commercial par l'évidence.
 *
 * Verrou V1 (mémoire ≠ recommandation) : faits bruts uniquement.
 */
export interface TenantCumulativeStats {
  /** Interventions executed (completed|validated) tous contrats actifs confondus. */
  totalInterventions: number
  /** Photos archivées (lien intervention.mission.site.contract actif). */
  totalPhotos: number
  /** Anomalies clôturées (resolved_at non null). */
  totalAnomaliesResolved: number
}

export interface AOPipeline {
  /** AO en cours d'analyse ou d'extraction. */
  analyzing: number
  /** AO prêts (mémoire technique générée). */
  ready: number
  /** AO soumis. */
  submitted: number
  /** Contrats actifs/paused dont la fin tombe dans les 60 prochains jours
   *  — signal proactif de renouvellement à anticiper. */
  renewalsDue: number
}

export interface OpenAnomaliesStats {
  /** Anomalies non résolues actuellement (status='open'). */
  total: number
  /** Sous-ensemble créé depuis > 3 jours — signal "ça traîne". */
  oldCount: number
}

const EXECUTED_STATUSES = ['completed', 'validated'] as const

/**
 * Lundi 00:00:00 UTC de la semaine courante.
 * On utilise UTC pour la stabilité des comparaisons SQL.
 */
function startOfWeekIso(now: Date = new Date()): string {
  const d = new Date(now.toISOString())
  // ISO weekday : lundi=1, dimanche=7. JS getUTCDay : dimanche=0, samedi=6.
  const jsDay = d.getUTCDay()
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1
  d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * getWeekPulse : pouls de la semaine en cours.
 *
 * Filtre sur interventions executed_at >= lundi 00:00 UTC.
 * Photos et validations sont jointes via les interventions correspondantes.
 * Aucune agrégation par personne — pur compteur d'événements.
 */
export async function getWeekPulse(): Promise<WeekPulse> {
  const supabase = createAdminClient()
  const since = startOfWeekIso()

  // Borne fin de semaine (dimanche 23:59:59 UTC) pour la vigilance.
  const sinceDate = new Date(since)
  const endDate = new Date(sinceDate)
  endDate.setUTCDate(endDate.getUTCDate() + 6)
  endDate.setUTCHours(23, 59, 59, 999)
  const weekStartIso = since.slice(0, 10)
  const weekEndIso = endDate.toISOString().slice(0, 10)

  const { data: interventions, error: intErr } = await supabase
    .from('interventions')
    .select('id')
    .in('status', EXECUTED_STATUSES as unknown as string[])
    .gte('executed_at', since)
  if (intErr) throw intErr

  const ids = (interventions ?? []).map((i) => i.id as string)

  // Vigilance — chargée en parallèle (helper indépendant).
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

/**
 * getCapitalPreuves : compteurs totaux depuis le démarrage produit.
 * Trois nombres factuels : photos, interventions exécutées, contrats actifs.
 */
export async function getCapitalPreuves(): Promise<CapitalPreuves> {
  const supabase = createAdminClient()

  const [photosRes, interventionsRes, contractsRes] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .in('status', EXECUTED_STATUSES as unknown as string[]),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .is('deleted_at', null),
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

/**
 * getTenantCumulativeStats : capital cumulé tenant (Sprint 5 UX-9, Doctrine V5).
 *
 * Trois compteurs factuels pour le bandeau pied de dashboard :
 *   - interventions executed (completed|validated)
 *   - photos archivées (count global)
 *   - anomalies clôturées (resolved_at non null)
 *
 * Doctrine : aucune agrégation par personne, aucun classement, aucun score.
 */
export async function getTenantCumulativeStats(): Promise<TenantCumulativeStats> {
  const supabase = createAdminClient()

  const [interventionsRes, photosRes, anomaliesRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .in('status', EXECUTED_STATUSES as unknown as string[]),
    supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .not('resolved_at', 'is', null),
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

/**
 * getAOPipeline : pulse AO côté commercial.
 * 3 compteurs : analyzing/extracting · ready · submitted.
 */
export async function getAOPipeline(): Promise<AOPipeline> {
  const supabase = createAdminClient()
  const today = todayLocalIso()
  const horizonIso = addDaysLocal(today, 60)

  const [analyzingRes, readyRes, submittedRes, renewalsRes] = await Promise.all([
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['analyzing', 'extracting'])
      .is('deleted_at', null),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ready')
      .is('deleted_at', null),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .is('deleted_at', null),
    supabase
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .gte('end_date', today)
      .lte('end_date', horizonIso)
      .in('status', ['active', 'paused']),
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

/**
 * getOpenAnomaliesStats : total ouvert + sous-compte "ça traîne >3j".
 *
 * Note schéma : la spec parle de `reported_at` mais le schéma actuel
 * (cf. migration 018) expose `created_at` comme timestamp de signalement.
 * On utilise `created_at` qui est la source de vérité.
 */
export async function getOpenAnomaliesStats(): Promise<OpenAnomaliesStats> {
  const supabase = createAdminClient()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const [totalRes, oldRes] = await Promise.all([
    supabase
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null),
    supabase
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null)
      .lt('created_at', threeDaysAgo),
  ])
  if (totalRes.error) throw totalRes.error
  if (oldRes.error) throw oldRes.error

  return {
    total: totalRes.count ?? 0,
    oldCount: oldRes.count ?? 0,
  }
}

// ============================================================================
// Signalements récents (dernières 24h) — notification in-app manager
// ============================================================================

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
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('intervention_anomalies')
    .select(`
      id,
      intervention_id,
      category,
      category_other,
      description,
      created_at,
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

  if (error) {
    console.error('[getRecentAnomalies]', error)
    return []
  }

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

// ============================================================================
// Engagements à surveiller
// ============================================================================

export interface AtRiskEngagement {
  engagement_id: string
  short_label: string
  contract_id: string
  contract_name: string
  reason: 'no_intervention_recent' | 'deadline_close' | 'high_skip_rate'
  reasonDetail: string
}

// MVP minimal Slice 11.0 : on implémente la détection #1
// (no_intervention_recent) — la plus impactante et la plus testable.
// Les détections #2 (deadline_close) et #3 (high_skip_rate) requièrent
// soit un champ deadline sur engagement (n'existe pas en DB), soit
// une lecture transversale missions↔interventions↔engagements via
// missions.engagement_ids[] qui demande un join exotique. Reporté Phase 11.bis.
const ATRISK_NO_INTERVENTION_DAYS = 7
const ATRISK_LIMIT = 5

/**
 * getAtRiskEngagements : engagements actifs qui méritent un coup d'œil.
 *
 * MVP : un engagement est at-risk si son contrat est actif et qu'aucune
 * intervention completed/validated n'a été enregistrée dans les 7 derniers
 * jours sur les missions qui couvrent cet engagement.
 *
 * Tri : engagement le plus ancien sans activité d'abord (proxy d'urgence).
 * Limite : 5 max (le DG regarde le dashboard en 30s, pas 50 items).
 *
 * Doctrine V3 : on parle d'engagements, pas de personnes. Aucune mention
 * d'agent dans le résultat. reason et reasonDetail sont des FAITS.
 */
export async function getAtRiskEngagements(): Promise<AtRiskEngagement[]> {
  const supabase = createAdminClient()

  // 1) Engagements actifs sur contrats actifs non supprimés.
  const { data: contracts, error: cErr } = await supabase
    .from('contracts')
    .select('id, name')
    .eq('status', 'active')
    .is('deleted_at', null)
  if (cErr) throw cErr
  const activeContracts = contracts ?? []
  if (activeContracts.length === 0) return []
  const contractById = new Map(activeContracts.map((c) => [c.id as string, c.name as string]))

  const { data: engagements, error: eErr } = await supabase
    .from('engagements')
    .select('id, contract_id, short_label')
    .in('status', ['active', 'curated'])
    .in('contract_id', Array.from(contractById.keys()))
  if (eErr) throw eErr
  const allEngagements = (engagements ?? []) as Array<{
    id: string
    contract_id: string
    short_label: string
  }>
  if (allEngagements.length === 0) return []

  // 2) Pour chaque engagement, on cherche les missions qui le couvrent puis
  //    on regarde s'il existe une intervention completed/validated dans la
  //    fenêtre. On le fait en 2 queries globales (pas 1 par engagement) :
  //    - missions.overlaps(engagement_ids[]) → ensemble des missions concernées
  //    - interventions récentes sur ces missions
  const engagementIds = allEngagements.map((e) => e.id)
  const { data: missions, error: mErr } = await supabase
    .from('missions')
    .select('id, engagement_ids')
    .overlaps('engagement_ids', engagementIds)
    .is('deleted_at', null)
  if (mErr) throw mErr
  const allMissions = (missions ?? []) as Array<{ id: string; engagement_ids: string[] }>

  // engagement_id → mission_ids qui le couvrent
  const missionsByEngagement = new Map<string, string[]>()
  for (const m of allMissions) {
    for (const eId of m.engagement_ids ?? []) {
      if (!missionsByEngagement.has(eId)) missionsByEngagement.set(eId, [])
      missionsByEngagement.get(eId)!.push(m.id)
    }
  }

  // 3) Charger les interventions exécutées récentes sur ces missions
  const cutoffIso = new Date(
    Date.now() - ATRISK_NO_INTERVENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const allMissionIds = Array.from(new Set(allMissions.map((m) => m.id)))

  let recentByMission = new Map<string, number>()
  if (allMissionIds.length > 0) {
    const { data: recentInterventions, error: riErr } = await supabase
      .from('interventions')
      .select('mission_id, executed_at, status')
      .in('mission_id', allMissionIds)
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .gte('executed_at', cutoffIso)
    if (riErr) throw riErr
    for (const intv of recentInterventions ?? []) {
      const k = (intv as { mission_id: string }).mission_id
      recentByMission.set(k, (recentByMission.get(k) ?? 0) + 1)
    }
  }

  // 4) Dernière exécution par engagement (pour formuler le delta de jours)
  let lastExecutedByMission = new Map<string, string>()
  if (allMissionIds.length > 0) {
    const { data: lastExec, error: leErr } = await supabase
      .from('interventions')
      .select('mission_id, executed_at')
      .in('mission_id', allMissionIds)
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .order('executed_at', { ascending: false })
      .limit(500)
    if (leErr) throw leErr
    for (const row of lastExec ?? []) {
      const r = row as { mission_id: string; executed_at: string | null }
      if (!r.executed_at) continue
      if (!lastExecutedByMission.has(r.mission_id)) {
        lastExecutedByMission.set(r.mission_id, r.executed_at)
      }
    }
  }

  // 5) Calculer at-risk : aucune intervention récente parmi les missions
  //    couvrant l'engagement, ALORS QUE des missions existent (sinon l'engagement
  //    n'est pas "planifié" et c'est un autre signal — hors scope MVP).
  const now = Date.now()
  const candidates: AtRiskEngagement[] = []
  for (const e of allEngagements) {
    const mIds = missionsByEngagement.get(e.id)
    if (!mIds || mIds.length === 0) continue // pas couvert : signal différent
    const hasRecent = mIds.some((mid) => (recentByMission.get(mid) ?? 0) > 0)
    if (hasRecent) continue

    // Dernière exec (max parmi les missions de l'engagement)
    let lastExecIso: string | null = null
    for (const mid of mIds) {
      const t = lastExecutedByMission.get(mid)
      if (t && (!lastExecIso || t > lastExecIso)) lastExecIso = t
    }
    const daysSince = lastExecIso
      ? Math.floor((now - new Date(lastExecIso).getTime()) / (1000 * 60 * 60 * 24))
      : null

    const reasonDetail = daysSince === null
      ? `Aucune intervention exécutée à ce jour`
      : `Aucune intervention exécutée depuis ${daysSince} jour${daysSince > 1 ? 's' : ''}`

    candidates.push({
      engagement_id: e.id,
      short_label: e.short_label,
      contract_id: e.contract_id,
      contract_name: contractById.get(e.contract_id) ?? '',
      reason: 'no_intervention_recent',
      reasonDetail,
    })
  }

  // Tri : plus longue absence d'exec en premier. Les engagements sans dernière
  // exec connue (jamais exécutés) sont considérés comme les plus urgents.
  // Comme on n'a pas conservé daysSince dans le type, on retrie via lookup local.
  const sortKey = new Map<string, number>()
  for (const c of candidates) {
    const m = c.reasonDetail.match(/depuis (\d+) jour/)
    sortKey.set(c.engagement_id, m ? -parseInt(m[1], 10) : -Number.MAX_SAFE_INTEGER)
  }
  candidates.sort((a, b) => (sortKey.get(a.engagement_id)! - sortKey.get(b.engagement_id)!))

  return candidates.slice(0, ATRISK_LIMIT)
}

// ============================================================================
// Contrats sous tension
// ============================================================================

export interface ContractUnderTension {
  contract_id: string
  contract_name: string
  segmentScores: {
    promised: number
    planned: number
    executed: number
    proven: number
    validated: number
  }
  /** Moyenne (non pondérée) des 5 segments — simple, lisible, suffisant en MVP. */
  globalScore: number
  reasonDetail: string
}

const TENSION_GLOBAL_THRESHOLD = 0.7
const TENSION_SEGMENT_THRESHOLD = 0.5
const TENSION_RECENT_DAYS = 30
const TENSION_LIMIT = 5

/**
 * getContractsUnderTension : contrats actifs dont la boucle de preuve faiblit
 * sur les 30 derniers jours.
 *
 * Pour chaque contrat actif non supprimé :
 *   PROMIS    = (engagements curated|active > 0) ? 1 : 0
 *   PLANIFIÉ  = #engagements couverts par >= 1 mission / #engagements
 *   EXÉCUTÉ   = #engagements ayant >= 1 intervention completed/validated <30j
 *               / #engagements
 *   PROUVÉ    = #engagements ayant >= 1 intervention completed/validated <30j
 *               avec >= 1 photo / #engagements
 *   VALIDÉ    = #engagements ayant >= 1 intervention validated <30j
 *               / #engagements
 *
 * Un contrat est "sous tension" si globalScore < 0.7 OU un segment < 0.5.
 * Trié globalScore asc (le plus tendu en tête), limit 5.
 */
export async function getContractsUnderTension(): Promise<ContractUnderTension[]> {
  const supabase = createAdminClient()

  const { data: contracts, error: cErr } = await supabase
    .from('contracts')
    .select('id, name')
    .eq('status', 'active')
    .is('deleted_at', null)
  if (cErr) throw cErr
  const activeContracts = (contracts ?? []) as Array<{ id: string; name: string }>
  if (activeContracts.length === 0) return []

  const contractIds = activeContracts.map((c) => c.id)

  // 1) Engagements actifs/curated par contrat
  const { data: engagements, error: eErr } = await supabase
    .from('engagements')
    .select('id, contract_id')
    .in('contract_id', contractIds)
    .in('status', ['active', 'curated'])
  if (eErr) throw eErr
  const engagementsByContract = new Map<string, string[]>()
  for (const e of engagements ?? []) {
    const row = e as { id: string; contract_id: string }
    if (!engagementsByContract.has(row.contract_id)) {
      engagementsByContract.set(row.contract_id, [])
    }
    engagementsByContract.get(row.contract_id)!.push(row.id)
  }

  const allEngagementIds = (engagements ?? []).map((e) => (e as { id: string }).id)

  // 2) Missions couvrant ces engagements → mission_id → engagement_ids[]
  let missionToEngagements = new Map<string, string[]>()
  let missionIdsCovering: string[] = []
  if (allEngagementIds.length > 0) {
    const { data: missions, error: mErr } = await supabase
      .from('missions')
      .select('id, engagement_ids')
      .overlaps('engagement_ids', allEngagementIds)
      .is('deleted_at', null)
    if (mErr) throw mErr
    for (const m of missions ?? []) {
      const row = m as { id: string; engagement_ids: string[] }
      const filtered = (row.engagement_ids ?? []).filter((eId) => allEngagementIds.includes(eId))
      missionToEngagements.set(row.id, filtered)
    }
    missionIdsCovering = Array.from(missionToEngagements.keys())
  }

  // 3) Interventions exécutées dans la fenêtre 30j sur ces missions, + photos
  const cutoffIso = new Date(
    Date.now() - TENSION_RECENT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  let executedByMission = new Map<string, Array<{ id: string; status: string }>>()
  let interventionIds: string[] = []
  if (missionIdsCovering.length > 0) {
    const { data: interventions, error: iErr } = await supabase
      .from('interventions')
      .select('id, mission_id, status, executed_at')
      .in('mission_id', missionIdsCovering)
      .in('status', EXECUTED_STATUSES as unknown as string[])
      .gte('executed_at', cutoffIso)
    if (iErr) throw iErr
    for (const row of interventions ?? []) {
      const r = row as { id: string; mission_id: string; status: string }
      if (!executedByMission.has(r.mission_id)) executedByMission.set(r.mission_id, [])
      executedByMission.get(r.mission_id)!.push({ id: r.id, status: r.status })
      interventionIds.push(r.id)
    }
  }

  let photosByIntervention = new Set<string>()
  if (interventionIds.length > 0) {
    const { data: photos, error: pErr } = await supabase
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', interventionIds)
    if (pErr) throw pErr
    for (const p of photos ?? []) {
      photosByIntervention.add((p as { intervention_id: string }).intervention_id)
    }
  }

  // 4) Calcul des segments par contrat
  const results: ContractUnderTension[] = []
  for (const c of activeContracts) {
    const eIds = engagementsByContract.get(c.id) ?? []
    const totalE = eIds.length

    const promised = totalE > 0 ? 1 : 0
    if (totalE === 0) {
      // Contrat actif sans engagement actif : tension max sur planifié/exécuté/etc.
      // On le considère sous tension (globalScore très bas).
      results.push({
        contract_id: c.id,
        contract_name: c.name,
        segmentScores: { promised: 0, planned: 0, executed: 0, proven: 0, validated: 0 },
        globalScore: 0,
        reasonDetail: 'Aucune promesse active à ce contrat',
      })
      continue
    }

    // Engagement → set des mission_ids qui le couvrent
    const engagementToMissions = new Map<string, string[]>()
    for (const [mid, eList] of missionToEngagements.entries()) {
      for (const eId of eList) {
        if (!engagementToMissions.has(eId)) engagementToMissions.set(eId, [])
        engagementToMissions.get(eId)!.push(mid)
      }
    }

    let plannedCount = 0
    let executedCount = 0
    let provenCount = 0
    let validatedCount = 0

    for (const eId of eIds) {
      const mIds = engagementToMissions.get(eId) ?? []
      if (mIds.length === 0) continue
      plannedCount += 1

      const intvs = mIds.flatMap((mid) => executedByMission.get(mid) ?? [])
      if (intvs.length === 0) continue
      executedCount += 1

      const hasProof = intvs.some((iv) => photosByIntervention.has(iv.id))
      if (hasProof) provenCount += 1

      const hasValidated = intvs.some((iv) => iv.status === 'validated')
      if (hasValidated) validatedCount += 1
    }

    const segmentScores = {
      promised,
      planned: plannedCount / totalE,
      executed: executedCount / totalE,
      proven: provenCount / totalE,
      validated: validatedCount / totalE,
    }
    const globalScore =
      (segmentScores.promised +
        segmentScores.planned +
        segmentScores.executed +
        segmentScores.proven +
        segmentScores.validated) /
      5

    // Inclus si tension
    const weakest = Object.entries(segmentScores)
      .sort((a, b) => a[1] - b[1])[0]
    const weakestSegment = weakest[0]
    const weakestValue = weakest[1]

    if (globalScore >= TENSION_GLOBAL_THRESHOLD && weakestValue >= TENSION_SEGMENT_THRESHOLD) {
      continue
    }

    const labelByKey: Record<string, string> = {
      promised: 'promesses',
      planned: 'planification',
      executed: 'exécution',
      proven: 'preuves',
      validated: 'validation',
    }
    const reasonDetail = `Maillon faible : ${labelByKey[weakestSegment]} (${Math.round(weakestValue * 100)}%)`

    results.push({
      contract_id: c.id,
      contract_name: c.name,
      segmentScores,
      globalScore,
      reasonDetail,
    })
  }

  results.sort((a, b) => a.globalScore - b.globalScore)
  return results.slice(0, TENSION_LIMIT)
}

// ============================================================================
// Activité récente — timeline événementielle anonyme
// ============================================================================

export type RecentActivityType =
  | 'intervention_executed'
  | 'intervention_validated'
  | 'anomaly_resolved'
  | 'tender_ready'
  | 'contract_activated'
  | 'evidence_inserted'

export interface RecentActivityEvent {
  type: RecentActivityType
  /** ISO timestamp. Antichronologique. */
  occurredAt: string
  /**
   * Texte court FR factuel. JAMAIS de nom d'agent.
   * Format : « Bionettoyage CHU sanitaires exécuté · 6 photos ».
   */
  label: string
  /** Contexte court : nom du contrat, du site, etc. Jamais une personne. */
  contextLabel: string
  /** Lien vers la page concernée (optionnel). */
  href?: string
}

const RECENT_DEFAULT_LIMIT = 10
const RECENT_LOOKBACK_DAYS = 30

/**
 * getRecentActivity : timeline cross-domaine pour le widget « Activité récente ».
 *
 * Union de 6 sources, triées par timestamp DESC, limit configurable.
 * Doctrine V3 absolue : labels factuels, jamais de prénom/nom d'agent.
 */
export async function getRecentActivity(limit = RECENT_DEFAULT_LIMIT): Promise<RecentActivityEvent[]> {
  const supabase = createAdminClient()
  const cutoffIso = new Date(
    Date.now() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const fetchLimit = Math.max(limit * 2, 30) // sur-fetch pour permettre le merge sort

  // Helpers pour le label
  function compact(text: string, max = 80): string {
    if (text.length <= max) return text
    return text.slice(0, max - 1) + '…'
  }

  // 1) Interventions exécutées (completed) + 2) validées : un seul fetch
  const { data: intvData } = await supabase
    .from('interventions')
    .select(
      `id, status, executed_at, completed_at:executed_at, scheduled_at,
       mission:missions(name, site:sites(name, contract:contracts(name)))`,
    )
    .in('status', ['completed', 'validated'])
    .gte('executed_at', cutoffIso)
    .order('executed_at', { ascending: false })
    .limit(fetchLimit)

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  type IntvRaw = {
    id: string
    status: string
    executed_at: string | null
    mission?: unknown
  }

  const interventionIdsForPhotos: string[] = []
  const intvBase: Array<{
    id: string
    status: string
    executed_at: string
    missionName: string
    siteName: string
    contractName: string
  }> = []
  for (const row of (intvData ?? []) as unknown as IntvRaw[]) {
    if (!row.executed_at) continue
    const missionRaw = pickOne<{ name: string; site?: unknown }>(row.mission)
    const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
    const contractRaw = siteRaw ? pickOne<{ name: string }>(siteRaw.contract) : null
    intvBase.push({
      id: row.id,
      status: row.status,
      executed_at: row.executed_at,
      missionName: missionRaw?.name ?? 'Intervention',
      siteName: siteRaw?.name ?? '',
      contractName: contractRaw?.name ?? '',
    })
    interventionIdsForPhotos.push(row.id)
  }

  // Compteur photos par intervention (pour enrichir le label)
  const photosByIntv = new Map<string, number>()
  if (interventionIdsForPhotos.length > 0) {
    const { data: photos } = await supabase
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', interventionIdsForPhotos)
    for (const p of photos ?? []) {
      const k = (p as { intervention_id: string }).intervention_id
      photosByIntv.set(k, (photosByIntv.get(k) ?? 0) + 1)
    }
  }

  const events: RecentActivityEvent[] = []
  for (const row of intvBase) {
    const photos = photosByIntv.get(row.id) ?? 0
    const photoSuffix = photos > 0 ? ` · ${photos} photo${photos > 1 ? 's' : ''}` : ''
    events.push({
      type: 'intervention_executed',
      occurredAt: row.executed_at,
      label: compact(`${row.missionName} exécutée${photoSuffix}`),
      contextLabel: row.contractName || row.siteName,
      href: `/preuves/${row.id}`,
    })
    if (row.status === 'validated') {
      events.push({
        type: 'intervention_validated',
        occurredAt: row.executed_at,
        label: compact(`${row.missionName} validée`),
        contextLabel: row.contractName || row.siteName,
        href: `/preuves/${row.id}`,
      })
    }
  }

  // 3) Anomalies résolues
  const { data: anomData } = await supabase
    .from('intervention_anomalies')
    .select('id, resolved_at, category, intervention_id')
    .not('resolved_at', 'is', null)
    .gte('resolved_at', cutoffIso)
    .order('resolved_at', { ascending: false })
    .limit(fetchLimit)
  // Enrichir avec contexte contrat — léger join par batch
  const anomIntvIds = Array.from(
    new Set(((anomData ?? []) as Array<{ intervention_id: string }>).map((a) => a.intervention_id)),
  )
  const ctxByIntv = new Map<string, { siteName: string; contractName: string }>()
  if (anomIntvIds.length > 0) {
    const { data: intvForAnom } = await supabase
      .from('interventions')
      .select(`id, mission:missions(site:sites(name, contract:contracts(name)))`)
      .in('id', anomIntvIds)
    for (const row of (intvForAnom ?? []) as unknown as Array<{ id: string; mission?: unknown }>) {
      const missionRaw = pickOne<{ site?: unknown }>(row.mission)
      const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
      const contractRaw = siteRaw ? pickOne<{ name: string }>(siteRaw.contract) : null
      ctxByIntv.set(row.id, {
        siteName: siteRaw?.name ?? '',
        contractName: contractRaw?.name ?? '',
      })
    }
  }
  for (const a of (anomData ?? []) as Array<{
    id: string
    resolved_at: string
    category: string
    intervention_id: string
  }>) {
    const ctx = ctxByIntv.get(a.intervention_id)
    events.push({
      type: 'anomaly_resolved',
      occurredAt: a.resolved_at,
      label: 'Anomalie résolue',
      contextLabel: ctx?.contractName || ctx?.siteName || '',
      href: `/preuves/${a.intervention_id}`,
    })
  }

  // 4) Tenders ready (mémoire technique générée)
  const { data: tendersReady } = await supabase
    .from('tenders')
    .select('id, title, client_name, created_at')
    .eq('status', 'ready')
    .gte('created_at', cutoffIso)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(fetchLimit)
  for (const t of (tendersReady ?? []) as Array<{
    id: string
    title: string
    client_name: string | null
    created_at: string
  }>) {
    events.push({
      type: 'tender_ready',
      occurredAt: t.created_at,
      label: compact(`Mémoire technique « ${t.title} » générée`),
      contextLabel: t.client_name ?? '',
      href: `/tenders/${t.id}`,
    })
  }

  // 5) Contrats activés — proxy : status=active + created_at récent.
  //    Schéma actuel sans champ activated_at dédié ; created_at suffit MVP.
  const { data: contractsRecent } = await supabase
    .from('contracts')
    .select('id, name, client_name, created_at')
    .eq('status', 'active')
    .is('deleted_at', null)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(fetchLimit)
  for (const c of (contractsRecent ?? []) as Array<{
    id: string
    name: string
    client_name: string
    created_at: string
  }>) {
    events.push({
      type: 'contract_activated',
      occurredAt: c.created_at,
      label: compact(`Contrat « ${c.name} » activé`),
      contextLabel: c.client_name,
      href: `/contracts/${c.id}`,
    })
  }

  // 6) Evidence inserted : engagement passé en status='active' (via Slice 4.3
  //    insertion 1-clic dans un mémoire). Proxy : updated_at récent + status active.
  const { data: engagementsActivated } = await supabase
    .from('engagements')
    .select('id, short_label, contract_id, updated_at, status')
    .eq('status', 'active')
    .gte('updated_at', cutoffIso)
    .order('updated_at', { ascending: false })
    .limit(fetchLimit)
  // On enrichit avec le nom du contrat
  const engContractIds = Array.from(
    new Set(
      ((engagementsActivated ?? []) as Array<{ contract_id: string | null }>)
        .map((e) => e.contract_id)
        .filter((id): id is string => !!id),
    ),
  )
  const contractNameById = new Map<string, string>()
  if (engContractIds.length > 0) {
    const { data: cNames } = await supabase
      .from('contracts')
      .select('id, name')
      .in('id', engContractIds)
    for (const row of (cNames ?? []) as Array<{ id: string; name: string }>) {
      contractNameById.set(row.id, row.name)
    }
  }
  for (const e of (engagementsActivated ?? []) as Array<{
    id: string
    short_label: string
    contract_id: string | null
    updated_at: string
  }>) {
    events.push({
      type: 'evidence_inserted',
      occurredAt: e.updated_at,
      label: compact(`Engagement activé : « ${e.short_label} »`),
      contextLabel: e.contract_id ? contractNameById.get(e.contract_id) ?? '' : '',
      href: e.contract_id ? `/contracts/${e.contract_id}` : undefined,
    })
  }

  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
  return events.slice(0, limit)
}

// ============================================================================
// getContractSummaries — wrapper sur RPC contract_summaries (migration 039)
// Remplace la boucle JS Promise.all(contracts.map(summarizeContract)) qui
// faisait ~120 requêtes en parallèle pour 30 contrats.
// ============================================================================

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
  if (error) {
    console.error('[getContractSummaries]', error)
    return new Map()
  }
  const map = new Map<string, ContractSummary>()
  for (const row of (data ?? []) as Array<{
    contract_id: string
    engagements_total: number
    planned: number
    executed: number
    proven: number
    validated: number
    proof_coverage: number
    confidence_level: ContractConfidenceLevel
    needs_attention: boolean
  }>) {
    map.set(row.contract_id, {
      contractId: row.contract_id,
      engagementsTotal: row.engagements_total,
      averageRatios: {
        promised: row.engagements_total > 0,
        planned: Number(row.planned ?? 0),
        executed: Number(row.executed ?? 0),
        proven: Number(row.proven ?? 0),
        validated: Number(row.validated ?? 0),
      },
      proofCoverage: Number(row.proof_coverage ?? 0),
      confidenceLevel: row.confidence_level ?? 'low',
      needsAttention: row.needs_attention,
    })
  }
  return map
}
