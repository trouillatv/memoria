import 'server-only'

import type { SiteSubjectMatrix, SubjectMatrixRow } from './pv-history'
import type { DeltaItem, PvDelta } from './pv-comparison'

// ── Types publics ────────────────────────────────────────────────────────────

export type WatchReason =
  | 'non_conforme'
  | 'aggravé'
  | 'réouvert'
  | 'ouvert_longtemps'
  | 'en_attente'
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

export function computeWatchlist(matrix: SiteSubjectMatrix): WatchlistEntry[] {
  const result: WatchlistEntry[] = []
  const totalRuns = matrix.runs.length

  for (const row of matrix.rows) {
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
    } else if (pvCount >= 3 && !isResolved(row.currentStatus)) {
      result.push({ ...base, reason: 'ouvert_longtemps' })
    } else if (row.currentStatus === 'awaiting_validation' && pvCount >= 2) {
      result.push({ ...base, reason: 'en_attente' })
    } else if (isStagnant(row)) {
      result.push({ ...base, reason: 'sans_évolution' })
    }
  }

  const priority: Record<WatchReason, number> = {
    non_conforme: 0, aggravé: 1, réouvert: 2, ouvert_longtemps: 3, en_attente: 4, sans_évolution: 5,
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
