import 'server-only'

import type { SiteSubjectMatrix, SubjectMatrixRow } from './pv-history'
import { OPERATIONAL_EXCLUDED_FAMILIES } from './canonical-transitions'

// ── Watchlist PV canonique ───────────────────────────────────────────────────
// Couche partagée entre site-synthesis.ts et site-attention-items.ts.
// computeWatchlist() est une fonction pure : aucun I/O, aucun scoring opaque.
// Seuls les 4 WatchReason sont exportés — la hiérarchie de sévérité est
// l'affaire du consommateur.

export type WatchReason = 'non_conforme' | 'aggravé' | 'réouvert' | 'sans_évolution'

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

const WATCHLIST_EXCLUDED_FAMILIES = OPERATIONAL_EXCLUDED_FAMILIES

function isStagnant(row: SubjectMatrixRow): boolean {
  const realCells = row.cells.filter((c) => c !== null && !c.isGap)
  if (realCells.length < 3) return false
  return realCells.slice(1).every((c) => c?.transition === 'maintenu')
}

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

    const base: Omit<WatchlistEntry, 'reason'> = {
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
