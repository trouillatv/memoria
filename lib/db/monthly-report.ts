// Chantier E — Slice E.0 : helper getContractMonthlyReport.
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - Le rapport doit sentir la PREUVE, pas ChatGPT.
//   - AUCUN texte généré IA — pas de phrase d'interprétation.
//   - AUCUN score qualité calculé — uniquement des compteurs factuels.
//   - AUCUN nom d'agent — anonymisation totale comme Phase 5.
//   - Compteurs, dates, photos, tendances numériques simples. Point.
//
// Test ultime : un compteur retiré perd un FAIT. Une phrase retirée du rapport
// final ne doit jamais "appauvrir le narratif" — il n'y a pas de narratif. On
// renvoie ici un dataset factuel : le DG voit, le client mesure, point.
//
// Note technique : on suit le pattern existant (createAdminClient + agrégats
// côté code) plutôt que createClient() server : aucun helper lib/db/* ne passe
// par la route server-cookies. La cohérence prime — le rapport mensuel sera
// rendu par une route serveur qui authentifie le DG en amont, le helper lui-
// même reste service en lecture admin.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrls } from '@/lib/storage/intervention-photos'

// ============================================================================
// Types publics
// ============================================================================

export interface MonthlyReportPeriod {
  year: number
  month: number // 1-12
  monthLabel: string // "avril 2026"
  firstDay: string // yyyy-mm-dd (1er du mois)
  lastDay: string // yyyy-mm-dd (28/29/30/31)
}

export interface ReportPhotoCandidate {
  id: string
  url: string // signed URL valide 1h
  thumbnail_url: string
  caption: string | null
  taken_at: string // ISO timestamp
  intervention_id: string
  mission_name: string
  site_name: string
  kind: string // 'before' | 'after' | 'anomaly' | 'proof'
}

export interface ReportAnomalyEntry {
  id: string
  description: string
  reported_at: string
  resolved_at: string | null
  site_name: string
}

export interface ReportSegmentScores {
  promised: number // 0..1
  planned: number
  executed: number
  proven: number
  validated: number
}

export interface MonthlyReportData {
  contract: {
    id: string
    name: string
    client_name: string
    start_date: string
  }
  period: MonthlyReportPeriod

  // Compteurs factuels du mois
  counts: {
    interventionsExecuted: number
    interventionsValidated: number
    interventionsSkipped: number
    photosCount: number
    anomaliesReported: number
    anomaliesResolved: number
    validationsCount: number
    sitesCovered: number
  }

  // Tendance vs mois précédent — deltas numériques bruts, jamais d'interprétation.
  trend: {
    interventionsDelta: number
    photosDelta: number
    anomaliesOpenDelta: number
  }

  // Capital cumulé depuis début du contrat
  cumulative: {
    totalInterventionsExecuted: number
    totalPhotos: number
    totalAnomaliesResolved: number
    daysSinceStart: number
  }

  // Photos candidates (jusqu'à 30, le DG en sélectionnera 6-12 dans l'UI Slice E.1)
  photoCandidates: ReportPhotoCandidate[]

  // Anomalies (résolues ce mois + ouvertes en fin de mois)
  anomaliesResolved: ReportAnomalyEntry[]
  anomaliesStillOpen: ReportAnomalyEntry[]

  // Segments boucle de preuve calculés à fin de mois
  segmentScores: ReportSegmentScores
}

// ============================================================================
// Helpers period (purs, testables sans DB)
// ============================================================================

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/**
 * Parse "YYYY-MM" en MonthlyReportPeriod.
 * Throws si format invalide. monthLabel en français ("avril 2026").
 */
export function parseMonthParam(yearMonth: string): MonthlyReportPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth)
  if (!match) {
    throw new Error(`parseMonthParam: format attendu YYYY-MM, reçu "${yearMonth}"`)
  }
  const year = parseInt(match[1]!, 10)
  const month = parseInt(match[2]!, 10)
  if (month < 1 || month > 12) {
    throw new Error(`parseMonthParam: mois invalide ${month} (1..12)`)
  }
  const lastDayNum = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  const dd = String(lastDayNum).padStart(2, '0')
  return {
    year,
    month,
    monthLabel: `${MONTHS_FR[month - 1]} ${year}`,
    firstDay: `${year}-${mm}-01`,
    lastDay: `${year}-${mm}-${dd}`,
  }
}

/** MonthlyReportPeriod → "YYYY-MM" (roundtrip parseMonthParam). */
export function formatMonthParam(period: MonthlyReportPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`
}

/**
 * Décale une période d'un mois en arrière (utile pour les deltas).
 * Stable cross-year (janvier N → décembre N-1).
 */
function previousMonth(period: MonthlyReportPeriod): MonthlyReportPeriod {
  const prevMonth = period.month === 1 ? 12 : period.month - 1
  const prevYear = period.month === 1 ? period.year - 1 : period.year
  return parseMonthParam(`${prevYear}-${String(prevMonth).padStart(2, '0')}`)
}

// ============================================================================
// Helper principal
// ============================================================================

const EXECUTED_STATUSES = ['completed', 'validated'] as const
const PHOTO_CANDIDATES_MAX = 30

export async function getContractMonthlyReport(
  contractId: string,
  monthParam: string,
): Promise<MonthlyReportData | null> {
  const period = parseMonthParam(monthParam)
  const prevPeriod = previousMonth(period)
  const supabase = createAdminClient()

  // ---- 1. Contract existe et non supprimé.
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('id, name, client_name, start_date')
    .eq('id', contractId)
    .is('deleted_at', null)
    .maybeSingle()
  if (cErr) throw cErr
  if (!contract) return null

  // ---- 2. Sites du contrat -> missions du contrat -> set d'intervention_ids.
  const { data: sites, error: sErr } = await supabase
    .from('sites')
    .select('id, name')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  if (sErr) throw sErr
  const siteList = (sites ?? []) as Array<{ id: string; name: string }>
  const siteIdSet = new Set(siteList.map((s) => s.id))
  const siteNameById = new Map(siteList.map((s) => [s.id, s.name]))

  if (siteList.length === 0) {
    return buildEmptyReport(contract, period)
  }

  const { data: missions, error: mErr } = await supabase
    .from('missions')
    .select('id, name, site_id')
    .in('site_id', Array.from(siteIdSet))
    .is('deleted_at', null)
  if (mErr) throw mErr
  const missionList = (missions ?? []) as Array<{ id: string; name: string; site_id: string }>
  const missionIds = missionList.map((m) => m.id)
  const missionById = new Map(missionList.map((m) => [m.id, m]))

  if (missionIds.length === 0) {
    return buildEmptyReport(contract, period)
  }

  // ---- 3. Bornes ISO du mois (UTC).
  const firstIso = `${period.firstDay}T00:00:00.000Z`
  const lastDayExclusiveIso = isoDayAfter(period.lastDay)
  const prevFirstIso = `${prevPeriod.firstDay}T00:00:00.000Z`
  const prevLastExclusiveIso = isoDayAfter(prevPeriod.lastDay)

  // ---- 4. Toutes les interventions du contrat (volume borné : missions du
  //         contrat). Filtres mois côté code.
  const { data: rawInterventions, error: iErr } = await supabase
    .from('interventions')
    .select('id, mission_id, status, executed_at, scheduled_for, skipped_at, scheduled_at')
    .in('mission_id', missionIds)
  if (iErr) throw iErr

  type RawIntv = {
    id: string
    mission_id: string
    status: string
    executed_at: string | null
    scheduled_for: string | null
    skipped_at: string | null
    scheduled_at: string
  }
  const allInterventions = (rawInterventions ?? []) as RawIntv[]

  const monthInterventions = allInterventions.filter((i) =>
    isInWindow(i.executed_at, firstIso, lastDayExclusiveIso),
  )
  const prevMonthInterventions = allInterventions.filter((i) =>
    isInWindow(i.executed_at, prevFirstIso, prevLastExclusiveIso),
  )
  const cumulativeExecuted = allInterventions.filter(
    (i) => EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated') && i.executed_at,
  )

  const allInterventionIds = allInterventions.map((i) => i.id)
  const safeInterventionIds = allInterventionIds.length > 0 ? allInterventionIds : ['__none__']

  // ---- 5. Photos / Anomalies / Validations en parallèle.
  const [
    photosMonthRes,
    photosPrevRes,
    photosCumulRes,
    anomCreatedRes,
    anomResolvedRes,
    anomAllRes,
    validationsRes,
  ] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('id, intervention_id, storage_path, caption, taken_at, kind')
      .gte('taken_at', firstIso)
      .lt('taken_at', lastDayExclusiveIso)
      .in('intervention_id', safeInterventionIds)
      .order('taken_at', { ascending: false })
      .limit(500),
    supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .gte('taken_at', prevFirstIso)
      .lt('taken_at', prevLastExclusiveIso)
      .in('intervention_id', safeInterventionIds),
    supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', safeInterventionIds),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention_id, description, status, resolved_at, created_at')
      .gte('created_at', firstIso)
      .lt('created_at', lastDayExclusiveIso)
      .in('intervention_id', safeInterventionIds),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention_id, description, status, resolved_at, created_at')
      .gte('resolved_at', firstIso)
      .lt('resolved_at', lastDayExclusiveIso)
      .in('intervention_id', safeInterventionIds),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention_id, description, status, resolved_at, created_at')
      .in('intervention_id', safeInterventionIds),
    supabase
      .from('intervention_validations')
      .select('id, intervention_id', { count: 'exact' })
      .gte('validated_at', firstIso)
      .lt('validated_at', lastDayExclusiveIso)
      .in('intervention_id', safeInterventionIds),
  ])

  if (photosMonthRes.error) throw photosMonthRes.error
  if (photosPrevRes.error) throw photosPrevRes.error
  if (photosCumulRes.error) throw photosCumulRes.error
  if (anomCreatedRes.error) throw anomCreatedRes.error
  if (anomResolvedRes.error) throw anomResolvedRes.error
  if (anomAllRes.error) throw anomAllRes.error
  if (validationsRes.error) throw validationsRes.error

  type RawPhoto = {
    id: string
    intervention_id: string
    storage_path: string
    caption: string | null
    taken_at: string
    kind: string
  }
  const photosMonth = (photosMonthRes.data ?? []) as RawPhoto[]
  const photosMonthCount = photosMonth.length
  const photosPrevCount = photosPrevRes.count ?? 0
  const photosCumulCount = photosCumulRes.count ?? 0

  type RawAnomaly = {
    id: string
    intervention_id: string
    description: string | null
    status?: string
    resolved_at: string | null
    created_at: string
  }
  const anomaliesCreated = (anomCreatedRes.data ?? []) as RawAnomaly[]
  const anomaliesResolvedMonth = (anomResolvedRes.data ?? []) as RawAnomaly[]
  const anomaliesAll = (anomAllRes.data ?? []) as RawAnomaly[]
  const validationsMonthCount = validationsRes.count ?? 0

  // ---- 6. Compteurs factuels du mois.
  const interventionsExecuted = monthInterventions.filter((i) =>
    EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated'),
  ).length
  const interventionsValidated = monthInterventions.filter((i) => i.status === 'validated').length
  const interventionsSkipped = allInterventions.filter((i) =>
    isInWindow(i.skipped_at, firstIso, lastDayExclusiveIso),
  ).length

  const sitesCoveredSet = new Set<string>()
  for (const i of monthInterventions) {
    if (!EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated')) continue
    const m = missionById.get(i.mission_id)
    if (m) sitesCoveredSet.add(m.site_id)
  }

  // ---- 7. Trend vs mois précédent.
  const prevInterventionsExecutedCount = prevMonthInterventions.filter((i) =>
    EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated'),
  ).length

  const openAtEndOfMonthN = anomaliesAll.filter((a) =>
    isOpenAtEnd(a, lastDayExclusiveIso),
  ).length
  const openAtEndOfMonthPrev = anomaliesAll.filter((a) =>
    isOpenAtEnd(a, prevLastExclusiveIso),
  ).length

  const trend = {
    interventionsDelta: interventionsExecuted - prevInterventionsExecutedCount,
    photosDelta: photosMonthCount - photosPrevCount,
    anomaliesOpenDelta: openAtEndOfMonthN - openAtEndOfMonthPrev,
  }

  // ---- 8. Cumulative depuis début contrat.
  const totalInterventionsExecuted = cumulativeExecuted.length
  const totalAnomaliesResolved = anomaliesAll.filter((a) => a.resolved_at).length
  const daysSinceStart = daysBetween(contract.start_date as string, period.lastDay)

  // ---- 9. Photo candidates : signed URLs + tri caption / diversité site / date desc.
  const photoCandidates = await buildPhotoCandidates(photosMonth, missionById, siteNameById)

  // ---- 10. Anomalies listes.
  // Pour le site_name, on charge une map intervention -> mission une fois.
  const allAnomalyIntvIds = Array.from(
    new Set([
      ...anomaliesResolvedMonth.map((a) => a.intervention_id),
      ...anomaliesAll.filter((a) => isOpenAtEnd(a, lastDayExclusiveIso)).map((a) => a.intervention_id),
    ]),
  )
  const missionByIntvForAnom = await loadMissionByIntervention(allAnomalyIntvIds)
  const anomaliesResolvedList: ReportAnomalyEntry[] = anomaliesResolvedMonth.map((a) =>
    toAnomalyEntry(a, missionByIntvForAnom, missionById, siteNameById),
  )
  const anomaliesStillOpenList: ReportAnomalyEntry[] = anomaliesAll
    .filter((a) => isOpenAtEnd(a, lastDayExclusiveIso))
    .map((a) => toAnomalyEntry(a, missionByIntvForAnom, missionById, siteNameById))

  // ---- 11. Segments boucle de preuve à fin de mois.
  //   Simplification revendiquée : calcul par interventions du mois, pas par
  //   engagement individuel. Le rapport client montre "ce qui s'est passé ce
  //   mois", pas "couverture engagement par engagement" (qui se voit dans le
  //   cockpit /contracts/[id]).
  //     - PROMISED  = engagements curated/active du contrat > 0 ? 1 : 0
  //     - PLANNED   = au moins 1 intervention scheduled dans le mois ? 1 : 0
  //     - EXECUTED  = #executées / #planifiées (cap 0..1)
  //     - PROVEN    = #executées avec au moins 1 photo / #planifiées (cap 0..1)
  //     - VALIDATED = #validated / #planifiées (cap 0..1)
  const segmentScores = await computeSegmentScores({
    contractId: contract.id as string,
    period,
    monthInterventions,
    missionById,
    photosByInterventionMonth: groupIntvIdsWithPhoto(photosMonth),
  })

  // ---- 12. Compose.
  return {
    contract: {
      id: contract.id as string,
      name: contract.name as string,
      client_name: contract.client_name as string,
      start_date: contract.start_date as string,
    },
    period,
    counts: {
      interventionsExecuted,
      interventionsValidated,
      interventionsSkipped,
      photosCount: photosMonthCount,
      anomaliesReported: anomaliesCreated.length,
      anomaliesResolved: anomaliesResolvedMonth.length,
      validationsCount: validationsMonthCount,
      sitesCovered: sitesCoveredSet.size,
    },
    trend,
    cumulative: {
      totalInterventionsExecuted,
      totalPhotos: photosCumulCount,
      totalAnomaliesResolved,
      daysSinceStart,
    },
    photoCandidates,
    anomaliesResolved: anomaliesResolvedList,
    anomaliesStillOpen: anomaliesStillOpenList,
    segmentScores,
  }
}

// ============================================================================
// Helpers internes
// ============================================================================

function buildEmptyReport(
  contract: { id: string; name: string; client_name: string; start_date: string },
  period: MonthlyReportPeriod,
): MonthlyReportData {
  return {
    contract: {
      id: contract.id,
      name: contract.name,
      client_name: contract.client_name,
      start_date: contract.start_date,
    },
    period,
    counts: {
      interventionsExecuted: 0,
      interventionsValidated: 0,
      interventionsSkipped: 0,
      photosCount: 0,
      anomaliesReported: 0,
      anomaliesResolved: 0,
      validationsCount: 0,
      sitesCovered: 0,
    },
    trend: { interventionsDelta: 0, photosDelta: 0, anomaliesOpenDelta: 0 },
    cumulative: {
      totalInterventionsExecuted: 0,
      totalPhotos: 0,
      totalAnomaliesResolved: 0,
      daysSinceStart: Math.max(0, daysBetween(contract.start_date, period.lastDay)),
    },
    photoCandidates: [],
    anomaliesResolved: [],
    anomaliesStillOpen: [],
    segmentScores: { promised: 0, planned: 0, executed: 0, proven: 0, validated: 0 },
  }
}

function isoDayAfter(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

function isInWindow(iso: string | null, startInclusiveIso: string, endExclusiveIso: string): boolean {
  if (!iso) return false
  return iso >= startInclusiveIso && iso < endExclusiveIso
}

function daysBetween(startIsoDate: string, endIsoDate: string): number {
  const a = new Date(`${startIsoDate}T00:00:00.000Z`).getTime()
  const b = new Date(`${endIsoDate}T00:00:00.000Z`).getTime()
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)))
}

/**
 * Une anomalie est "ouverte à la fin de la fenêtre" si :
 *   - created_at < endExclusiveIso (existait avant la borne)
 *   - ET (resolved_at est null OU resolved_at >= endExclusiveIso)
 */
function isOpenAtEnd(
  a: { resolved_at: string | null; created_at: string },
  endExclusiveIso: string,
): boolean {
  if (a.created_at >= endExclusiveIso) return false
  if (!a.resolved_at) return true
  return a.resolved_at >= endExclusiveIso
}

function groupIntvIdsWithPhoto(photos: Array<{ intervention_id: string }>): Set<string> {
  const s = new Set<string>()
  for (const p of photos) s.add(p.intervention_id)
  return s
}

async function loadMissionByIntervention(intvIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (intvIds.length === 0) return map
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .select('id, mission_id')
    .in('id', intvIds)
  if (error) throw error
  for (const row of (data ?? []) as Array<{ id: string; mission_id: string }>) {
    map.set(row.id, row.mission_id)
  }
  return map
}

async function buildPhotoCandidates(
  photos: Array<{
    id: string
    intervention_id: string
    storage_path: string
    caption: string | null
    taken_at: string
    kind: string
  }>,
  missionById: Map<string, { id: string; name: string; site_id: string }>,
  siteNameById: Map<string, string>,
): Promise<ReportPhotoCandidate[]> {
  if (photos.length === 0) return []

  const interventionIds = Array.from(new Set(photos.map((p) => p.intervention_id)))
  const missionByIntervention = await loadMissionByIntervention(interventionIds)

  // Photos déjà triées taken_at desc côté DB.
  const sorted = [...photos]
  const withCaption = sorted.filter((p) => p.caption && p.caption.trim().length > 0)
  const withoutCaption = sorted.filter((p) => !p.caption || p.caption.trim().length === 0)

  const seenInPickup = new Set<string>()
  const finalPick: typeof sorted = []

  // Étape 1 — caption non vide en premier.
  for (const p of withCaption) {
    if (finalPick.length >= PHOTO_CANDIDATES_MAX) break
    finalPick.push(p)
    seenInPickup.add(p.id)
  }

  // Étape 2 — diversité site : 1 photo par site non encore représenté.
  if (finalPick.length < PHOTO_CANDIDATES_MAX) {
    const representedSites = new Set<string>()
    for (const p of finalPick) {
      const mId = missionByIntervention.get(p.intervention_id)
      const m = mId ? missionById.get(mId) : null
      if (m) representedSites.add(m.site_id)
    }
    for (const p of withoutCaption) {
      if (finalPick.length >= PHOTO_CANDIDATES_MAX) break
      if (seenInPickup.has(p.id)) continue
      const mId = missionByIntervention.get(p.intervention_id)
      const m = mId ? missionById.get(mId) : null
      const siteId = m?.site_id ?? null
      if (siteId && !representedSites.has(siteId)) {
        finalPick.push(p)
        seenInPickup.add(p.id)
        representedSites.add(siteId)
      }
    }
  }

  // Étape 3 — remplissage par date desc.
  if (finalPick.length < PHOTO_CANDIDATES_MAX) {
    for (const p of withoutCaption) {
      if (finalPick.length >= PHOTO_CANDIDATES_MAX) break
      if (seenInPickup.has(p.id)) continue
      finalPick.push(p)
      seenInPickup.add(p.id)
    }
  }

  // Signed URLs en batch.
  const paths = finalPick.map((p) => p.storage_path)
  const signedMap = await getSignedPhotoUrls(paths)

  return finalPick.map((p) => {
    const mId = missionByIntervention.get(p.intervention_id)
    const m = mId ? missionById.get(mId) : null
    const siteName = m ? siteNameById.get(m.site_id) ?? '' : ''
    const url = signedMap.get(p.storage_path) ?? ''
    return {
      id: p.id,
      url,
      thumbnail_url: url, // Slice E.0 : pas de variante miniature stockée — on réutilise l'URL.
      caption: p.caption,
      taken_at: p.taken_at,
      intervention_id: p.intervention_id,
      mission_name: m?.name ?? '',
      site_name: siteName,
      kind: p.kind,
    }
  })
}

function toAnomalyEntry(
  a: {
    id: string
    intervention_id: string
    description: string | null
    resolved_at: string | null
    created_at: string
  },
  missionByIntervention: Map<string, string>,
  missionById: Map<string, { id: string; name: string; site_id: string }>,
  siteNameById: Map<string, string>,
): ReportAnomalyEntry {
  const mId = missionByIntervention.get(a.intervention_id)
  const m = mId ? missionById.get(mId) : null
  const siteName = m ? siteNameById.get(m.site_id) ?? '' : ''
  return {
    id: a.id,
    description: a.description ?? '',
    reported_at: a.created_at,
    resolved_at: a.resolved_at,
    site_name: siteName,
  }
}

async function computeSegmentScores(input: {
  contractId: string
  period: MonthlyReportPeriod
  monthInterventions: Array<{
    id: string
    mission_id: string
    status: string
    executed_at: string | null
    scheduled_for: string | null
  }>
  missionById: Map<string, { id: string; name: string; site_id: string }>
  photosByInterventionMonth: Set<string>
}): Promise<ReportSegmentScores> {
  const supabase = createAdminClient()
  const { contractId, monthInterventions, photosByInterventionMonth } = input

  // Promised
  const { count: engCount, error: eErr } = await supabase
    .from('engagements')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .in('status', ['active', 'curated'])
  if (eErr) throw eErr
  const promised = (engCount ?? 0) > 0 ? 1 : 0

  // Planifiées du mois (toutes status, fenêtre scheduled_at)
  const firstIso = `${input.period.firstDay}T00:00:00.000Z`
  const lastExcl = isoDayAfter(input.period.lastDay)
  const missionIds = Array.from(input.missionById.keys())
  if (missionIds.length === 0) {
    return { promised, planned: 0, executed: 0, proven: 0, validated: 0 }
  }
  const { data: plannedRows, error: pErr } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
    .gte('scheduled_at', firstIso)
    .lt('scheduled_at', lastExcl)
  if (pErr) throw pErr
  const planned = (plannedRows ?? []).length
  const denom = Math.max(1, planned)

  const executed = monthInterventions.filter((i) =>
    EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated'),
  ).length
  const validated = monthInterventions.filter((i) => i.status === 'validated').length
  const proven = monthInterventions.filter(
    (i) =>
      EXECUTED_STATUSES.includes(i.status as 'completed' | 'validated') &&
      photosByInterventionMonth.has(i.id),
  ).length

  return {
    promised,
    planned: planned > 0 ? 1 : 0,
    executed: clamp01(executed / denom),
    proven: clamp01(proven / denom),
    validated: clamp01(validated / denom),
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
