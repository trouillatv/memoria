import 'server-only'

import { canonicalRunsForSite, runEffectiveDate } from './pv-history'
import type { SiteSubjectMatrix, SubjectMatrixRow } from './pv-history'
import type { DeltaItem, PvDelta } from './pv-comparison'

// ── Types publics ────────────────────────────────────────────────────────────

export type WatchReason =
  | 'non_conforme'
  | 'aggravé'
  | 'réouvert'
  | 'sans_évolution'

export interface WatchlistEntry {
  subjectThreadId: string
  label: string
  thematicCategory: string | null
  family: string
  reason: WatchReason
  pvCount: number
  totalRuns: number
  lastRunIndex: number
}

export interface CategoryProgress {
  category: string
  done: number
  inProgress: number
  planned: number
  nonCompliant: number
  awaitingValidation: number
  open: number
  other: number
  total: number
}

export interface DeltaSummary {
  réalisésLevés: DeltaItem[]
  nouveaux: DeltaItem[]
  progressés: DeltaItem[]
  aggravésRéouverts: DeltaItem[]
  toujoursOuverts: DeltaItem[]
  nonMentionnés: DeltaItem[]
  annulés: DeltaItem[]
}

export interface RunMeta {
  runId: string
  documentId: string
  effectiveDate: string
  reportId: string | null
}

// ── Métadonnées enrichies (dates réelles + reportId) ────────────────────────

/**
 * Pour chaque run du chantier, charge la date effective du document source
 * (effective_date > created_at) et le reportId de la visite matérialisée si elle existe.
 */
export async function getRunsMeta(
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>,
): Promise<RunMeta[]> {
  if (runs.length === 0) return []

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const runIds = runs.map((r) => r.id)
  const docIds = runs.map((r) => r.documentId)

  const [{ data: docs }, { data: reports }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, effective_date')
      .in('id', docIds),
    supabase
      .from('site_reports')
      .select('id, extraction_run_id')
      .in('extraction_run_id', runIds)
      .eq('origin', 'import'),
  ])

  const docDateMap = new Map<string, string>()
  for (const d of docs ?? []) {
    if (d.effective_date) docDateMap.set(d.id, d.effective_date)
  }

  const reportMap = new Map<string, string>()
  for (const r of reports ?? []) {
    if (r.extraction_run_id) reportMap.set(r.extraction_run_id, r.id)
  }

  return runs.map((run) => ({
    runId: run.id,
    documentId: run.documentId,
    effectiveDate: docDateMap.get(run.documentId) ?? run.effectiveDate,
    reportId: reportMap.get(run.id) ?? null,
  }))
}

// ── Computations pures ───────────────────────────────────────────────────────

function isResolved(status: string | null): boolean {
  return status === 'done' || status === 'cancelled' || status === 'informational'
}

function isStagnant(row: SubjectMatrixRow): boolean {
  const realCells = row.cells.filter((c) => c !== null && !c.isGap)
  if (realCells.length < 3) return false
  // Toutes les transitions après la première sont 'maintenu'
  const afterFirst = realCells.slice(1)
  return afterFirst.every((c) => c?.transition === 'maintenu')
}

// Familles exclues de la watchlist : acteurs (toujours "ouverts") et faits informationnels.
// Un sujet n'entre dans "À surveiller" que s'il porte un signal opérationnel réel.
const WATCHLIST_EXCLUDED_FAMILIES = new Set(['person', 'company', 'knowledge_fact'])

export function computeWatchlist(matrix: SiteSubjectMatrix): WatchlistEntry[] {
  const result: WatchlistEntry[] = []
  const totalRuns = matrix.runs.length

  for (const row of matrix.rows) {
    if (WATCHLIST_EXCLUDED_FAMILIES.has(row.family)) continue

    const pvCount = row.cells.filter((c) => c !== null && !c.isGap).length
    if (pvCount === 0) continue

    let lastRealIdx = -1
    for (let i = row.cells.length - 1; i >= 0; i--) {
      const c = row.cells[i]
      if (c !== null && !c.isGap) { lastRealIdx = i; break }
    }
    const lastRealCell = lastRealIdx >= 0 ? row.cells[lastRealIdx] : null

    const base = {
      subjectThreadId: row.subjectThreadId,
      label: row.canonicalLabel,
      thematicCategory: row.thematicCategory,
      family: row.family,
      pvCount,
      totalRuns,
      lastRunIndex: lastRealIdx,
    }

    if (row.currentStatus === 'non_compliant') {
      result.push({ ...base, reason: 'non_conforme' })
    } else if (lastRealCell?.transition === 'aggravé') {
      result.push({ ...base, reason: 'aggravé' })
    } else if (lastRealCell?.transition === 'réouvert') {
      result.push({ ...base, reason: 'réouvert' })
    } else if (isStagnant(row)) {
      result.push({ ...base, reason: 'sans_évolution' })
    }
  }

  const priority: Record<WatchReason, number> = {
    non_conforme: 0, aggravé: 1, réouvert: 2, sans_évolution: 3,
  }
  result.sort((a, b) => priority[a.reason] - priority[b.reason] || b.pvCount - a.pvCount)
  return result
}

export function computeProgressByCategory(matrix: SiteSubjectMatrix): CategoryProgress[] {
  const map = new Map<string, CategoryProgress>()

  const getOrCreate = (cat: string): CategoryProgress => {
    if (!map.has(cat)) {
      map.set(cat, {
        category: cat, done: 0, inProgress: 0, planned: 0,
        nonCompliant: 0, awaitingValidation: 0, open: 0, other: 0, total: 0,
      })
    }
    return map.get(cat)!
  }

  for (const row of matrix.rows) {
    const cat = row.thematicCategory ?? 'Non catégorisé'
    const entry = getOrCreate(cat)
    entry.total++
    switch (row.currentStatus) {
      case 'done':                entry.done++;                break
      case 'in_progress':         entry.inProgress++;          break
      case 'planned':             entry.planned++;             break
      case 'non_compliant':       entry.nonCompliant++;        break
      case 'awaiting_validation': entry.awaitingValidation++;  break
      case 'open':                entry.open++;                break
      default:                    entry.other++;
    }
  }

  const cats = Array.from(map.values())
  cats.sort((a, b) => {
    if (b.nonCompliant !== a.nonCompliant) return b.nonCompliant - a.nonCompliant
    if (b.inProgress !== a.inProgress) return b.inProgress - a.inProgress
    if (b.open !== a.open) return b.open - a.open
    return a.category.localeCompare(b.category, 'fr')
  })
  return cats
}

export function computeDeltaSummary(delta: PvDelta): DeltaSummary {
  const s: DeltaSummary = {
    réalisésLevés: [], nouveaux: [], progressés: [],
    aggravésRéouverts: [], toujoursOuverts: [], nonMentionnés: [], annulés: [],
  }
  for (const item of delta.items) {
    switch (item.transition) {
      case 'réalisé':
      case 'levé':          s.réalisésLevés.push(item);     break
      case 'nouveau':       s.nouveaux.push(item);           break
      case 'progressé':     s.progressés.push(item);         break
      case 'aggravé':
      case 'réouvert':      s.aggravésRéouverts.push(item);  break
      case 'non_mentionné': s.nonMentionnés.push(item);      break
      case 'annulé':        s.annulés.push(item);            break
      case 'maintenu':
      case 'changé':
        if (!isResolved(item.toStatus)) s.toujoursOuverts.push(item)
        break
    }
  }
  return s
}

// ── Sujets importants (ranking canonique) ────────────────────────────────────

export interface ImportantSubject {
  canonicalSubjectId: string
  label: string
  pvCount: number
  openActions: number
  openReserves: number
  activeDeadlines: number
  overdueDeadlines: number
  reappearance: boolean
  recentOccurrence: boolean
  score: number
}

const IMPORTANT_MAX = 6
const IMPORTANT_THRESHOLD = 12

/**
 * Retourne les sujets canoniques les plus importants d'un chantier,
 * classés par score déterministe (présence PV + travail ouvert + signaux temporels).
 * Aucun LLM. Lecture seule.
 */
export async function getImportantSubjects(siteId: string): Promise<ImportantSubject[]> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const today = new Date()

  // 1. Runs canoniques + sujets actifs + threads — en parallèle
  const rawRuns = await canonicalRunsForSite(siteId)
  if (rawRuns.length === 0) return []

  const runIndex  = new Map(rawRuns.map((r, i) => [r.id, i]))
  const runDate   = new Map(rawRuns.map((r) => [r.id, runEffectiveDate(r)]))
  const lastRunIds = new Set(rawRuns.slice(-2).map((r) => r.id))
  const runIds    = rawRuns.map((r) => r.id)

  const [{ data: csRows }, { data: stiRows }] = await Promise.all([
    supabase.from('canonical_subject').select('id, label').eq('site_id', siteId).eq('status', 'active'),
    supabase.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', siteId),
  ])

  type CsRow  = { id: string; label: string }
  type StiRow = { subject_thread_id: string; canonical_subject_id: string }

  const subjects = (csRows ?? []) as CsRow[]
  if (subjects.length === 0) return []

  const threadToCs = new Map(((stiRows ?? []) as StiRow[]).map((r) => [r.subject_thread_id, r.canonical_subject_id]))
  const threadSet  = new Set(threadToCs.keys())

  // 2. Propositions par batch de runs (évite la limite URL avec des centaines de thread IDs)
  type PropRow = { id: string; extraction_run_id: string; subject_thread_id: string; document_status: string | null; proposal_family: string }
  const PROP_BATCH = 10
  const propBatches = await Promise.all(
    Array.from({ length: Math.ceil(runIds.length / PROP_BATCH) }, (_, i) =>
      supabase
        .from('document_extraction_proposal')
        .select('id, extraction_run_id, subject_thread_id, document_status, proposal_family')
        .in('extraction_run_id', runIds.slice(i * PROP_BATCH, (i + 1) * PROP_BATCH)),
    ),
  )
  const proposals: PropRow[] = []
  for (const { data } of propBatches) {
    for (const p of (data ?? []) as PropRow[]) {
      if (threadSet.has(p.subject_thread_id)) proposals.push(p)
    }
  }

  const csFamilies = new Map<string, Set<string>>()
  const csRunMap   = new Map<string, Set<string>>()
  const csPropIds  = new Map<string, string[]>()
  const csStatuses = new Map<string, string[]>()
  const propToCs   = new Map<string, string>()

  for (const p of proposals) {
    const csId = threadToCs.get(p.subject_thread_id)
    if (!csId) continue
    propToCs.set(p.id, csId)
    if (!csFamilies.has(csId)) csFamilies.set(csId, new Set())
    if (!csRunMap.has(csId))   csRunMap.set(csId, new Set())
    if (!csPropIds.has(csId))  csPropIds.set(csId, [])
    if (!csStatuses.has(csId)) csStatuses.set(csId, [])
    csFamilies.get(csId)!.add(p.proposal_family)
    csRunMap.get(csId)!.add(p.extraction_run_id)
    csPropIds.get(csId)!.push(p.id)
    if (p.document_status) csStatuses.get(csId)!.push(p.document_status)
  }

  // 3. Matérialisations (batches de 80 pour éviter la limite URL)
  const allPropIds = proposals.map((p) => p.id)
  type MatRow = { proposal_id: string; target_entity_type: string; target_entity_id: string }
  const MAT_BATCH = 80
  const matBatches = await Promise.all(
    Array.from({ length: Math.ceil(allPropIds.length / MAT_BATCH) || 1 }, (_, i) =>
      allPropIds.length > 0
        ? supabase
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_type, target_entity_id')
            .in('proposal_id', allPropIds.slice(i * MAT_BATCH, (i + 1) * MAT_BATCH))
            .in('target_entity_type', ['site_action', 'site_reserve', 'site_deadline'])
        : Promise.resolve({ data: [] }),
    ),
  )
  const matRows: MatRow[] = []
  for (const { data } of matBatches) matRows.push(...((data ?? []) as MatRow[]))

  const csEntities = new Map<string, Map<string, string[]>>()
  for (const m of matRows) {
    const csId = propToCs.get(m.proposal_id)
    if (!csId) continue
    if (!csEntities.has(csId)) csEntities.set(csId, new Map())
    const byType = csEntities.get(csId)!
    if (!byType.has(m.target_entity_type)) byType.set(m.target_entity_type, [])
    byType.get(m.target_entity_type)!.push(m.target_entity_id)
  }

  // 4. Statuts des entités matérialisées — en parallèle
  const actionIds: string[]   = []
  const reserveIds: string[]  = []
  const deadlineIds: string[] = []
  for (const byType of csEntities.values()) {
    actionIds.push(...(byType.get('site_action') ?? []))
    reserveIds.push(...(byType.get('site_reserve') ?? []))
    deadlineIds.push(...(byType.get('site_deadline') ?? []))
  }

  const [{ data: actData }, { data: resData }, { data: dlData }] = await Promise.all([
    actionIds.length > 0 ? supabase.from('site_actions').select('id, status').in('id', actionIds) : Promise.resolve({ data: [] }),
    reserveIds.length > 0 ? supabase.from('site_reserve').select('id, status').in('id', reserveIds) : Promise.resolve({ data: [] }),
    deadlineIds.length > 0 ? supabase.from('site_deadlines').select('id, status, due_date').in('id', deadlineIds) : Promise.resolve({ data: [] }),
  ])

  const actionStatusMap   = new Map<string, string>()
  const reserveStatusMap  = new Map<string, string>()
  const deadlineStatusMap = new Map<string, { status: string; dueDate: string | null }>()

  for (const r of (actData ?? []) as Array<{ id: string; status: string }>) actionStatusMap.set(r.id, r.status)
  for (const r of (resData ?? []) as Array<{ id: string; status: string }>) reserveStatusMap.set(r.id, r.status)
  for (const r of (dlData ?? []) as Array<{ id: string; status: string; due_date: string | null }>) {
    deadlineStatusMap.set(r.id, { status: r.status, dueDate: r.due_date })
  }

  // 5. Score par sujet
  const NON_SUBJECT_FAMILIES = new Set(['person', 'company'])
  const scored: ImportantSubject[] = []

  for (const cs of subjects) {
    const families = csFamilies.get(cs.id) ?? new Set()
    if (families.size > 0 && [...families].every((f) => NON_SUBJECT_FAMILIES.has(f))) continue
    if (families.size > 0 && [...families].every((f) => f === 'deadline')) continue

    const csRuns  = [...(csRunMap.get(cs.id) ?? [])]
    const pvCount = csRuns.length
    if (pvCount === 0) continue

    const positions = csRuns.map((r) => runIndex.get(r) ?? -1).filter((p) => p >= 0).sort((a, b) => a - b)
    let reappearance = false
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] >= 3) { reappearance = true; break }
    }

    const recentOccurrence = csRuns.some((r) => lastRunIds.has(r))
    const lastRunId = csRuns.reduce((best, r) => ((runIndex.get(r) ?? -1) > (runIndex.get(best) ?? -1) ? r : best), csRuns[0])
    const lastDateStr = runDate.get(lastRunId)
    const daysSilent  = lastDateStr
      ? Math.round(Math.abs(today.getTime() - new Date(lastDateStr).getTime()) / 86400000)
      : 999

    const byType = csEntities.get(cs.id) ?? new Map<string, string[]>()
    const openActions = (byType.get('site_action') ?? []).filter((id) => {
      const s = actionStatusMap.get(id)
      return s !== 'done' && s !== 'cancelled'
    }).length
    const openReserves = (byType.get('site_reserve') ?? []).filter((id) => reserveStatusMap.get(id) === 'open').length
    const activeDeadlines = (byType.get('site_deadline') ?? []).filter((id) => {
      const d = deadlineStatusMap.get(id)
      return d?.status === 'to_plan' || d?.status === 'planned'
    }).length
    const overdueDeadlines = (byType.get('site_deadline') ?? []).filter((id) => {
      const d = deadlineStatusMap.get(id)
      if (!d || (d.status !== 'to_plan' && d.status !== 'planned')) return false
      if (!d.dueDate) return false
      return new Date(d.dueDate) < today
    }).length

    const statuses   = csStatuses.get(cs.id) ?? []
    const fullyDone  = statuses.length > 0 && statuses.every((s) => s === 'done') && openActions === 0 && openReserves === 0 && activeDeadlines === 0
    if (fullyDone) continue

    const score = Math.round(
      pvCount * 2 +
      (reappearance ? 3 : 0) +
      openActions * 4 +
      openReserves * 5 +
      activeDeadlines * 4 +
      overdueDeadlines * 6 +
      (recentOccurrence ? 2 : 0) -
      daysSilent / 30,
    )
    if (score < IMPORTANT_THRESHOLD) continue

    scored.push({ canonicalSubjectId: cs.id, label: cs.label, pvCount, openActions, openReserves, activeDeadlines, overdueDeadlines, reappearance, recentOccurrence, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, IMPORTANT_MAX)
}

// ── Carte d'activité ─────────────────────────────────────────────────────────

export type ActivityCellState = 'absent' | 'first' | 'open' | 'non_compliant' | 'done' | 'reopened'

export interface ActivityCell {
  state: ActivityCellState
}

export interface ActivityRow {
  canonicalSubjectId: string
  label: string
  score: number
  openActions: number
  openReserves: number
  activeDeadlines: number
  overdueDeadlines: number
  hasActions: boolean
  hasReserves: boolean
  hasDecisions: boolean
  hasDeadlines: boolean
  cells: ActivityCell[]
}

export interface ActivityMap {
  runs: Array<{ id: string; effectiveDate: string; pvNumber: number }>
  rows: ActivityRow[]
}

const ACTIVITY_MAX = 8

// Priorité décroissante : 0 = plus sévère (non_compliant passe devant done).
const STATUS_RANK: Record<string, number> = {
  non_compliant: 0, open: 1, awaiting_validation: 2, in_progress: 3, planned: 4, done: 5, cancelled: 5, informational: 6,
}

/**
 * Retourne la carte d'activité du chantier : top ACTIVITY_MAX canonical_subjects
 * avec leur état par PV (grille runs × sujets). Aucun LLM. Lecture seule.
 */
export async function getActivityMap(siteId: string): Promise<ActivityMap> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const today = new Date()

  const rawRuns = await canonicalRunsForSite(siteId)
  const emptyRuns = rawRuns.map((r, i) => ({ id: r.id, effectiveDate: runEffectiveDate(r), pvNumber: i + 1 }))
  if (rawRuns.length === 0) return { runs: [], rows: [] }

  const runIndex   = new Map(rawRuns.map((r, i) => [r.id, i]))
  const runDateMap = new Map(rawRuns.map((r) => [r.id, runEffectiveDate(r)]))
  const lastRunIds = new Set(rawRuns.slice(-2).map((r) => r.id))
  const runIds     = rawRuns.map((r) => r.id)

  const [{ data: csRows }, { data: stiRows }] = await Promise.all([
    supabase.from('canonical_subject').select('id, label').eq('site_id', siteId).eq('status', 'active'),
    supabase.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', siteId),
  ])

  type CsRow  = { id: string; label: string }
  type StiRow = { subject_thread_id: string; canonical_subject_id: string }

  const subjects  = (csRows ?? []) as CsRow[]
  if (subjects.length === 0) return { runs: emptyRuns, rows: [] }

  const threadToCs = new Map(((stiRows ?? []) as StiRow[]).map((r) => [r.subject_thread_id, r.canonical_subject_id]))
  const threadSet  = new Set(threadToCs.keys())

  type PropRow = { id: string; extraction_run_id: string; subject_thread_id: string; document_status: string | null; proposal_family: string }
  const PROP_BATCH = 10
  const propBatches = await Promise.all(
    Array.from({ length: Math.ceil(runIds.length / PROP_BATCH) }, (_, i) =>
      supabase
        .from('document_extraction_proposal')
        .select('id, extraction_run_id, subject_thread_id, document_status, proposal_family')
        .in('extraction_run_id', runIds.slice(i * PROP_BATCH, (i + 1) * PROP_BATCH)),
    ),
  )
  const proposals: PropRow[] = []
  for (const { data } of propBatches) {
    for (const p of (data ?? []) as PropRow[]) {
      if (threadSet.has(p.subject_thread_id)) proposals.push(p)
    }
  }

  const csFamilies  = new Map<string, Set<string>>()
  const csRunMap    = new Map<string, Set<string>>()
  const csPropIds   = new Map<string, string[]>()
  const csStatuses  = new Map<string, string[]>()
  const propToCs    = new Map<string, string>()
  const csRunStatus = new Map<string, Map<string, string>>() // csId → runId → worst_status

  for (const p of proposals) {
    const csId = threadToCs.get(p.subject_thread_id)
    if (!csId) continue
    propToCs.set(p.id, csId)
    if (!csFamilies.has(csId))  csFamilies.set(csId, new Set())
    if (!csRunMap.has(csId))    csRunMap.set(csId, new Set())
    if (!csPropIds.has(csId))   csPropIds.set(csId, [])
    if (!csStatuses.has(csId))  csStatuses.set(csId, [])
    if (!csRunStatus.has(csId)) csRunStatus.set(csId, new Map())
    csFamilies.get(csId)!.add(p.proposal_family)
    csRunMap.get(csId)!.add(p.extraction_run_id)
    csPropIds.get(csId)!.push(p.id)
    if (p.document_status) csStatuses.get(csId)!.push(p.document_status)
    // Statut le plus sévère par (canonical_subject, run)
    const incoming    = p.document_status ?? 'open'
    const runStatuses = csRunStatus.get(csId)!
    const current     = runStatuses.get(p.extraction_run_id)
    if (!current || (STATUS_RANK[incoming] ?? 99) < (STATUS_RANK[current] ?? 99)) {
      runStatuses.set(p.extraction_run_id, incoming)
    }
  }

  const allPropIds = proposals.map((p) => p.id)
  type MatRow = { proposal_id: string; target_entity_type: string; target_entity_id: string }
  const MAT_BATCH = 80
  const matBatches = await Promise.all(
    Array.from({ length: Math.ceil(allPropIds.length / MAT_BATCH) || 1 }, (_, i) =>
      allPropIds.length > 0
        ? supabase
            .from('document_proposal_materialization')
            .select('proposal_id, target_entity_type, target_entity_id')
            .in('proposal_id', allPropIds.slice(i * MAT_BATCH, (i + 1) * MAT_BATCH))
            .in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])
        : Promise.resolve({ data: [] }),
    ),
  )
  const matRows: MatRow[] = []
  for (const { data } of matBatches) matRows.push(...((data ?? []) as MatRow[]))

  const csEntities = new Map<string, Map<string, string[]>>()
  for (const m of matRows) {
    const csId = propToCs.get(m.proposal_id)
    if (!csId) continue
    if (!csEntities.has(csId)) csEntities.set(csId, new Map())
    const byType = csEntities.get(csId)!
    if (!byType.has(m.target_entity_type)) byType.set(m.target_entity_type, [])
    byType.get(m.target_entity_type)!.push(m.target_entity_id)
  }

  const actionIds: string[]   = []
  const reserveIds: string[]  = []
  const deadlineIds: string[] = []
  for (const byType of csEntities.values()) {
    actionIds.push(...(byType.get('site_action') ?? []))
    reserveIds.push(...(byType.get('site_reserve') ?? []))
    deadlineIds.push(...(byType.get('site_deadline') ?? []))
  }

  const [{ data: actData }, { data: resData }, { data: dlData }] = await Promise.all([
    actionIds.length > 0   ? supabase.from('site_actions').select('id, status').in('id', actionIds) : Promise.resolve({ data: [] }),
    reserveIds.length > 0  ? supabase.from('site_reserve').select('id, status').in('id', reserveIds) : Promise.resolve({ data: [] }),
    deadlineIds.length > 0 ? supabase.from('site_deadlines').select('id, status, due_date').in('id', deadlineIds) : Promise.resolve({ data: [] }),
  ])

  const actionStatusMap   = new Map<string, string>()
  const reserveStatusMap  = new Map<string, string>()
  const deadlineStatusMap = new Map<string, { status: string; dueDate: string | null }>()

  for (const r of (actData ?? []) as Array<{ id: string; status: string }>) actionStatusMap.set(r.id, r.status)
  for (const r of (resData ?? []) as Array<{ id: string; status: string }>) reserveStatusMap.set(r.id, r.status)
  for (const r of (dlData ?? []) as Array<{ id: string; status: string; due_date: string | null }>) {
    deadlineStatusMap.set(r.id, { status: r.status, dueDate: r.due_date })
  }

  // Sélection des top ACTIVITY_MAX sujets par score (même logique que getImportantSubjects)
  const NON_SUBJECT_FAMILIES = new Set(['person', 'company'])
  type Scored = { id: string; label: string; score: number; openActions: number; openReserves: number; activeDeadlines: number; overdueDeadlines: number }
  const scored: Scored[] = []

  for (const cs of subjects) {
    const families = csFamilies.get(cs.id) ?? new Set()
    if (families.size > 0 && [...families].every((f) => NON_SUBJECT_FAMILIES.has(f))) continue
    if (families.size > 0 && [...families].every((f) => f === 'deadline')) continue

    const csRuns  = [...(csRunMap.get(cs.id) ?? [])]
    const pvCount = csRuns.length
    if (pvCount === 0) continue

    const positions = csRuns.map((r) => runIndex.get(r) ?? -1).filter((p) => p >= 0).sort((a, b) => a - b)
    let reappearance = false
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] >= 3) { reappearance = true; break }
    }
    const recentOccurrence = csRuns.some((r) => lastRunIds.has(r))
    const lastRunId   = csRuns.reduce((best, r) => ((runIndex.get(r) ?? -1) > (runIndex.get(best) ?? -1) ? r : best), csRuns[0])
    const lastDateStr = runDateMap.get(lastRunId)
    const daysSilent  = lastDateStr ? Math.round(Math.abs(today.getTime() - new Date(lastDateStr).getTime()) / 86400000) : 999

    const byType = csEntities.get(cs.id) ?? new Map<string, string[]>()
    const openActions = (byType.get('site_action') ?? []).filter((id) => { const s = actionStatusMap.get(id); return s !== 'done' && s !== 'cancelled' }).length
    const openReserves = (byType.get('site_reserve') ?? []).filter((id) => reserveStatusMap.get(id) === 'open').length
    const activeDeadlines = (byType.get('site_deadline') ?? []).filter((id) => { const d = deadlineStatusMap.get(id); return d?.status === 'to_plan' || d?.status === 'planned' }).length
    const overdueDeadlines = (byType.get('site_deadline') ?? []).filter((id) => { const d = deadlineStatusMap.get(id); if (!d || (d.status !== 'to_plan' && d.status !== 'planned')) return false; if (!d.dueDate) return false; return new Date(d.dueDate) < today }).length

    const statuses  = csStatuses.get(cs.id) ?? []
    const fullyDone = statuses.length > 0 && statuses.every((s) => s === 'done') && openActions === 0 && openReserves === 0 && activeDeadlines === 0
    if (fullyDone) continue

    const score = Math.round(
      pvCount * 2 + (reappearance ? 3 : 0) + openActions * 4 + openReserves * 5 +
      activeDeadlines * 4 + overdueDeadlines * 6 + (recentOccurrence ? 2 : 0) - daysSilent / 30,
    )
    if (score < IMPORTANT_THRESHOLD) continue
    scored.push({ id: cs.id, label: cs.label, score, openActions, openReserves, activeDeadlines, overdueDeadlines })
  }

  scored.sort((a, b) => b.score - a.score)
  const topSubjects = scored.slice(0, ACTIVITY_MAX)

  // Construction des cellules par PV pour chaque sujet sélectionné
  const rows: ActivityRow[] = topSubjects.map((cs) => {
    const runStatuses = csRunStatus.get(cs.id)
    const byType = csEntities.get(cs.id) ?? new Map<string, string[]>()
    const cells: ActivityCell[] = []
    let prevStatus: string | null = null

    for (const run of rawRuns) {
      const status = runStatuses?.get(run.id)
      if (!status) {
        cells.push({ state: 'absent' })
        continue
      }
      let state: ActivityCellState
      if (prevStatus === null) {
        state = 'first'
      } else if (status === 'non_compliant') {
        state = 'non_compliant'
      } else if (status === 'done' || status === 'cancelled' || status === 'informational') {
        state = 'done'
      } else if (prevStatus === 'done' || prevStatus === 'cancelled' || prevStatus === 'informational') {
        state = 'reopened'
      } else {
        state = 'open'
      }
      cells.push({ state })
      prevStatus = status
    }

    return {
      canonicalSubjectId: cs.id,
      label: cs.label,
      score: cs.score,
      openActions: cs.openActions,
      openReserves: cs.openReserves,
      activeDeadlines: cs.activeDeadlines,
      overdueDeadlines: cs.overdueDeadlines,
      hasActions:   (byType.get('site_action')   ?? []).length > 0,
      hasReserves:  (byType.get('site_reserve')   ?? []).length > 0,
      hasDecisions: (byType.get('site_decision')  ?? []).length > 0,
      hasDeadlines: (byType.get('site_deadline')  ?? []).length > 0,
      cells,
    }
  })

  return { runs: emptyRuns, rows }
}
