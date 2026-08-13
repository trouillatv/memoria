import 'server-only'

import { canonicalRunsForSite, runEffectiveDate } from './pv-history'
import type { SiteSubjectMatrix } from './pv-history'
import type { SubjectLinkType } from '@/lib/db/subject-thread-links'
import {
  STATUS_RANK,
  OPERATIONAL_EXCLUDED_FAMILIES,
  computeCanonicalCellState,
} from './canonical-transitions'
import type { CanonicalCellState, CanonicalDelta, CanonicalDeltaItem } from './canonical-transitions'

// Re-export pour compatibilité avec pv-evolution.ts et les vues
export type ActivityCellState = CanonicalCellState
export type { CanonicalDeltaItem }

// ── Watchlist PV — re-export depuis la couche partagée ──────────────────────
export type { WatchReason, WatchlistEntry } from './pv-watchlist'
export { computeWatchlist } from './pv-watchlist'

// ── Types publics ────────────────────────────────────────────────────────────

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
  réalisésLevés: CanonicalDeltaItem[]
  nouveaux: CanonicalDeltaItem[]
  progressés: CanonicalDeltaItem[]
  aggravésRéouverts: CanonicalDeltaItem[]
  toujoursOuverts: CanonicalDeltaItem[]
  nonMentionnés: CanonicalDeltaItem[]
  annulés: CanonicalDeltaItem[]
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
    if (OPERATIONAL_EXCLUDED_FAMILIES.has(row.family)) continue
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

export function computeDeltaSummary(delta: CanonicalDelta): DeltaSummary {
  const s: DeltaSummary = {
    réalisésLevés: [], nouveaux: [], progressés: [],
    aggravésRéouverts: [], toujoursOuverts: [], nonMentionnés: [], annulés: [],
  }
  for (const item of delta.items) {
    // Les exclusions de familles sont déjà appliquées dans getCanonicalDelta.
    switch (item.transition) {
      case 'resolved':      s.réalisésLevés.push(item);     break
      case 'appeared':      s.nouveaux.push(item);           break
      case 'progressed':    s.progressés.push(item);         break
      case 'aggravated':
      case 'reopened':      s.aggravésRéouverts.push(item);  break
      case 'notMentioned':  s.nonMentionnés.push(item);      break
      case 'cancelled':     s.annulés.push(item);            break
      case 'stillOpen':     s.toujoursOuverts.push(item);    break
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
      cells.push({ state: computeCanonicalCellState(prevStatus, status) })
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

// ── Courbe de santé globale (tous les sujets canoniques) ─────────────────────

export interface HealthDataPoint {
  runId: string
  effectiveDate: string
  pvNumber: number
  /** Sujets actifs (first | open | non_compliant | reopened) à ce PV. */
  activeCount: number
  /** Sujets qui apparaissent pour la première fois (first, sous-ensemble de active). */
  newCount: number
}

export interface SiteHealthTimeline {
  siteId: string
  points: HealthDataPoint[]
  /** Pic d'activité sur toute la durée du chantier. */
  peakActive: number
}

/**
 * Calcule la courbe de tension et de santé du chantier à partir de
 * TOUS les canonical subjects actifs (pas seulement le top-8 editorial).
 * Pas de requête d'entités : uniquement runs + propositions.
 */
export async function getSiteHealthTimeline(siteId: string): Promise<SiteHealthTimeline> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const rawRuns = await canonicalRunsForSite(siteId)
  if (rawRuns.length === 0) return { siteId, points: [], peakActive: 0 }

  const sortedRuns = rawRuns.map((r, i) => ({
    id: r.id,
    effectiveDate: runEffectiveDate(r),
    pvNumber: i + 1,
  }))
  const runIds = sortedRuns.map((r) => r.id)

  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)

  type StiRow = { subject_thread_id: string; canonical_subject_id: string }
  const threadToCs = new Map(((stiRows ?? []) as StiRow[]).map((r) => [r.subject_thread_id, r.canonical_subject_id]))
  const threadSet  = new Set(threadToCs.keys())

  type PropRow = {
    extraction_run_id: string
    subject_thread_id: string
    document_status: string | null
    proposal_family: string
  }
  const PROP_BATCH = 10
  const propBatches = await Promise.all(
    Array.from({ length: Math.ceil(runIds.length / PROP_BATCH) }, (_, i) =>
      supabase
        .from('document_extraction_proposal')
        .select('extraction_run_id, subject_thread_id, document_status, proposal_family')
        .in('extraction_run_id', runIds.slice(i * PROP_BATCH, (i + 1) * PROP_BATCH)),
    ),
  )

  // (csId → runId → worst_status) + families
  const csRunStatus = new Map<string, Map<string, string>>()
  const csFamilies  = new Map<string, Set<string>>()

  for (const { data } of propBatches) {
    for (const p of (data ?? []) as PropRow[]) {
      if (!threadSet.has(p.subject_thread_id)) continue
      const csId = threadToCs.get(p.subject_thread_id)!
      if (!csFamilies.has(csId))  csFamilies.set(csId, new Set())
      if (!csRunStatus.has(csId)) csRunStatus.set(csId, new Map())
      csFamilies.get(csId)!.add(p.proposal_family)
      const incoming    = p.document_status ?? 'open'
      const runStatuses = csRunStatus.get(csId)!
      const current     = runStatuses.get(p.extraction_run_id)
      if (!current || (STATUS_RANK[incoming] ?? 99) < (STATUS_RANK[current] ?? 99)) {
        runStatuses.set(p.extraction_run_id, incoming)
      }
    }
  }

  const activeCounts = new Array<number>(sortedRuns.length).fill(0)
  const newCounts    = new Array<number>(sortedRuns.length).fill(0)

  for (const [csId, runStatuses] of csRunStatus.entries()) {
    const families = csFamilies.get(csId) ?? new Set()
    if (families.size > 0 && [...families].every((f) => OPERATIONAL_EXCLUDED_FAMILIES.has(f))) continue

    let prevStatus: string | null = null
    for (let i = 0; i < sortedRuns.length; i++) {
      const status = runStatuses.get(sortedRuns[i].id) ?? null
      if (status !== null) {
        const cellState = computeCanonicalCellState(prevStatus, status)
        const isActive  = cellState === 'first' || cellState === 'open' || cellState === 'non_compliant' || cellState === 'reopened'
        if (isActive) {
          activeCounts[i]++
          if (cellState === 'first') newCounts[i]++
        }
        prevStatus = status
      }
    }
  }

  const points: HealthDataPoint[] = sortedRuns.map((run, i) => ({
    runId:         run.id,
    effectiveDate: run.effectiveDate,
    pvNumber:      run.pvNumber,
    activeCount:   activeCounts[i],
    newCount:      newCounts[i],
  }))

  return { siteId, points, peakActive: Math.max(...activeCounts, 1) }
}

// ── Graphe de dépendances inter-sujets ───────────────────────────────────────

export interface SiteDependencyLink {
  id: string
  fromCanonicalSubjectId: string
  fromLabel: string
  toCanonicalSubjectId: string | null
  toLabel: string
  linkType: SubjectLinkType
  justification: string | null
}

export interface SiteDependencyGraph {
  siteId: string
  links: SiteDependencyLink[]
}

/**
 * Retourne tous les liens causaux confirmés entre canonical subjects.
 * Source : subject_thread_links (status='confirmed'), mappés vers les IDs et labels canoniques.
 * Déduplique les paires (fromCanonical, toCanonical, linkType) pour éviter
 * les doublons quand plusieurs thread pairs se résolvent au même pair canonique.
 */
export async function getSiteDependencyGraph(siteId: string): Promise<SiteDependencyGraph> {
  const { listConfirmedLinksForSite } = await import('@/lib/db/subject-thread-links')
  const rawLinks = await listConfirmedLinksForSite(siteId)
  if (rawLinks.length === 0) return { siteId, links: [] }

  const allThreadIds = [...new Set([
    ...rawLinks.map((l) => l.fromThreadId),
    ...rawLinks.map((l) => l.toThreadId),
  ])]

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const { data: stiData, error: stiErr } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', allThreadIds)
  if (stiErr) throw new Error(stiErr.message)

  const threadToCanonical = new Map<string, string>()
  for (const r of (stiData ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
    threadToCanonical.set(r.subject_thread_id, r.canonical_subject_id)
  }

  const canonicalIds = [...new Set([...threadToCanonical.values()])]
  if (canonicalIds.length === 0) return { siteId, links: [] }

  const { data: csData, error: csErr } = await supabase
    .from('canonical_subject')
    .select('id, label')
    .in('id', canonicalIds)
  if (csErr) throw new Error(csErr.message)

  const canonicalToLabel = new Map<string, string>()
  for (const r of (csData ?? []) as Array<{ id: string; label: string }>) {
    canonicalToLabel.set(r.id, r.label)
  }

  const seen = new Set<string>()
  const links: SiteDependencyLink[] = []

  for (const link of rawLinks) {
    const fromCanonicalId = threadToCanonical.get(link.fromThreadId) ?? null
    if (!fromCanonicalId) continue

    const toCanonicalId = threadToCanonical.get(link.toThreadId) ?? null
    if (fromCanonicalId === toCanonicalId) continue  // self-loop canonique

    const dedupeKey = `${fromCanonicalId}:${toCanonicalId ?? link.toThreadId}:${link.linkType}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    links.push({
      id: link.id,
      fromCanonicalSubjectId: fromCanonicalId,
      fromLabel: canonicalToLabel.get(fromCanonicalId) ?? 'Sujet inconnu',
      toCanonicalSubjectId: toCanonicalId,
      toLabel: (toCanonicalId ? canonicalToLabel.get(toCanonicalId) : null) ?? 'Sujet inconnu',
      linkType: link.linkType,
      justification: link.justification,
    })
  }

  return { siteId, links }
}

// ── Knowledge Graph (V2) ──────────────────────────────────────────────────────
// Agrège sujets opérationnels + acteurs + relations sémantiques confirmées
// + responsabilités dérivées des actions (seule table ayant subject_thread_id).
// site_reserve / site_deadlines n'ont pas encore de lien sujet → lot futur.

export type KnowledgeNodeKind = 'subject' | 'person' | 'company'

export interface KnowledgeNode {
  id: string
  label: string
  kind: KnowledgeNodeKind
}

export interface SemanticEdge {
  edgeType: 'semantic'
  from: string
  to: string
  linkType: SubjectLinkType
  justification: string | null
}

export interface ResponsibilityEdge {
  edgeType: 'responsible_for'
  from: string        // canonical_subject_id de l'acteur
  to: string          // canonical_subject_id du sujet
  actionCount: number
}

export type KnowledgeEdge = SemanticEdge | ResponsibilityEdge

export interface SiteKnowledgeGraph {
  siteId: string
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

export async function getSiteKnowledgeGraph(siteId: string): Promise<SiteKnowledgeGraph> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  // ── 1. Tous les canonical_subjects du chantier ────────────────────────────
  const { data: csRows, error: csErr } = await supabase
    .from('canonical_subject')
    .select('id, label, company_id, contact_id')
    .eq('site_id', siteId)
  if (csErr) throw new Error(csErr.message)

  const csLabel     = new Map<string, string>()
  const csKind      = new Map<string, KnowledgeNodeKind>()
  const companyToCS = new Map<string, string>()  // company_id → canonical_subject_id
  const contactToCS = new Map<string, string>()  // contact_id → canonical_subject_id

  for (const cs of (csRows ?? []) as Array<{ id: string; label: string; company_id: string | null; contact_id: string | null }>) {
    csLabel.set(cs.id, cs.label)
    const kind: KnowledgeNodeKind = cs.company_id ? 'company' : cs.contact_id ? 'person' : 'subject'
    csKind.set(cs.id, kind)
    if (cs.company_id) companyToCS.set(cs.company_id, cs.id)
    if (cs.contact_id) contactToCS.set(cs.contact_id, cs.id)
  }

  // ── 2. Relations sémantiques confirmées (logique identique à getSiteDependencyGraph) ──
  const { listConfirmedLinksForSite } = await import('@/lib/db/subject-thread-links')
  const rawLinks = await listConfirmedLinksForSite(siteId)

  const semanticEdges: SemanticEdge[] = []
  const seenSemantic = new Set<string>()

  if (rawLinks.length > 0) {
    const allThreadIds = [...new Set([
      ...rawLinks.map((l) => l.fromThreadId),
      ...rawLinks.map((l) => l.toThreadId),
    ])]
    const { data: stiSemantic } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', allThreadIds)

    const threadToCS = new Map<string, string>()
    for (const r of (stiSemantic ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      threadToCS.set(r.subject_thread_id, r.canonical_subject_id)
    }

    for (const link of rawLinks) {
      const fromId = threadToCS.get(link.fromThreadId) ?? null
      const toId   = threadToCS.get(link.toThreadId)   ?? null
      if (!fromId || !toId || fromId === toId) continue
      const key = `${fromId}:${toId}:${link.linkType}`
      if (seenSemantic.has(key)) continue
      seenSemantic.add(key)
      semanticEdges.push({ edgeType: 'semantic', from: fromId, to: toId, linkType: link.linkType, justification: link.justification })
    }
  }

  // ── 2b. Relations canoniques confirmées (canonical_subject_links, mig 316) ─
  // Convergence lecture : on merge les deux modèles sans supprimer le legacy.
  // canonical_subject_links est la source terrain-first ; subject_thread_links
  // reste utilisé pour les corpus PDF/OCEF existants.
  {
    const { data: canonicalLinks } = await supabase
      .from('canonical_subject_links')
      .select('source_subject_id, target_subject_id, relation_type, justification')
      .eq('site_id', siteId)
      .eq('status', 'confirmed')

    for (const cl of (canonicalLinks ?? []) as Array<{
      source_subject_id: string
      target_subject_id: string
      relation_type: string
      justification: string | null
    }>) {
      const fromId = cl.source_subject_id
      const toId   = cl.target_subject_id
      if (!csLabel.has(fromId) || !csLabel.has(toId) || fromId === toId) continue
      const key = `${fromId}:${toId}:${cl.relation_type}`
      if (seenSemantic.has(key)) continue
      seenSemantic.add(key)
      semanticEdges.push({
        edgeType: 'semantic',
        from: fromId,
        to: toId,
        linkType: cl.relation_type as SubjectLinkType,
        justification: cl.justification,
      })
    }
  }

  // ── 3. Responsabilités via site_actions ───────────────────────────────────
  // site_actions.assigned_company_id / assigned_contact_id → acteur
  // site_actions.subject_thread_id → sujet (résolu via STI)
  // site_reserve et site_deadlines n'ont pas encore de subject_thread_id.
  const responsibilityEdges: ResponsibilityEdge[] = []

  const { data: actionsRaw } = await supabase
    .from('site_actions')
    .select('assigned_company_id, assigned_contact_id, subject_thread_id')
    .eq('site_id', siteId)
    .not('subject_thread_id', 'is', null)

  const relevantActions = ((actionsRaw ?? []) as Array<{
    assigned_company_id: string | null
    assigned_contact_id: string | null
    subject_thread_id: string | null
  }>).filter((a) =>
    (a.assigned_company_id && companyToCS.has(a.assigned_company_id)) ||
    (a.assigned_contact_id && contactToCS.has(a.assigned_contact_id)),
  )

  if (relevantActions.length > 0) {
    const subjectThreadIds = [...new Set(relevantActions.map((a) => a.subject_thread_id!))]
    const { data: stiResp } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', subjectThreadIds)

    const respThreadToCS = new Map<string, string>()
    for (const r of (stiResp ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      respThreadToCS.set(r.subject_thread_id, r.canonical_subject_id)
    }

    // Agréger par paire (acteur, sujet) — 1 seule arête, pas N
    const respMap = new Map<string, { actorId: string; subjectId: string; count: number }>()
    for (const a of relevantActions) {
      const actorId = a.assigned_company_id
        ? companyToCS.get(a.assigned_company_id)
        : a.assigned_contact_id
          ? contactToCS.get(a.assigned_contact_id)
          : null
      if (!actorId) continue
      const subjectId = respThreadToCS.get(a.subject_thread_id!)
      if (!subjectId || subjectId === actorId) continue
      const key = `${actorId}:${subjectId}`
      const cur = respMap.get(key) ?? { actorId, subjectId, count: 0 }
      cur.count++
      respMap.set(key, cur)
    }

    for (const { actorId, subjectId, count } of respMap.values()) {
      responsibilityEdges.push({ edgeType: 'responsible_for', from: actorId, to: subjectId, actionCount: count })
    }
  }

  // ── 4. Nœuds : uniquement ceux qui apparaissent dans au moins une arête ──
  const usedIds = new Set<string>()
  for (const e of semanticEdges)     { usedIds.add(e.from); usedIds.add(e.to) }
  for (const e of responsibilityEdges) { usedIds.add(e.from); usedIds.add(e.to) }

  const nodes: KnowledgeNode[] = []
  for (const id of usedIds) {
    const label = csLabel.get(id)
    const kind  = csKind.get(id)
    if (!label || !kind) continue
    nodes.push({ id, label, kind })
  }

  return { siteId, nodes, edges: [...semanticEdges, ...responsibilityEdges] }
}
