'use client'

// Sprint Équipes B (Vincent 2026-05-21) — Heatmap 90j de l'équipe.
//
// Layout GitHub-like : colonnes verticales = semaines, lignes = jours
// (lundi en haut, dimanche en bas). 4 niveaux d'intensité (0 / 1 / 2-3 / ≥4)
// — descriptif, jamais évaluatif. Doctrine V2 stricte.

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { TeamHeatmapCell } from '@/lib/db/team-profile'

const FR_WEEKDAY_FULL = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]

/** ISO day index : Lundi=0, Dimanche=6 (pour layout Lun→Dim de haut en bas). */
function isoIdx(jsDay: number): number {
  return (jsDay + 6) % 7
}

function intensityClass(count: number): string {
  if (count === 0) return 'bg-muted/30 border border-muted'
  if (count === 1) return 'bg-emerald-200 dark:bg-emerald-900/60'
  if (count <= 3) return 'bg-emerald-400 dark:bg-emerald-700'
  return 'bg-emerald-600 dark:bg-emerald-500'
}

export function TeamHeatmap({ cells }: { cells: TeamHeatmapCell[] }) {
  if (cells.length === 0) return null

  // Construire la grille en colonnes de 7 jours (Lun→Dim)
  // chaque colonne = une semaine. On commence par décaler pour aligner
  // la première colonne sur le lundi.
  const grid: Array<{ date: string; count: number } | null>[] = []
  let column: Array<{ date: string; count: number } | null> = new Array(7).fill(null)
  // Padding initial : combien de jours avant le 1er point ?
  const first = cells[0]
  const firstDate = new Date(first.date)
  const firstIso = isoIdx(firstDate.getDay())
  for (let i = 0; i < firstIso; i++) column[i] = null

  let row = firstIso
  for (const c of cells) {
    column[row] = { date: c.date, count: c.count }
    if (row === 6) {
      grid.push(column)
      column = new Array(7).fill(null)
      row = 0
    } else {
      row += 1
    }
  }
  if (column.some((c) => c !== null)) grid.push(column)

  const total = cells.reduce((acc, c) => acc + c.count, 0)
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas d&apos;intervention ces 90 derniers jours.
      </p>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="inline-flex gap-[3px]">
            {grid.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, ri) => {
                  if (!cell) {
                    return (
                      <div
                        key={ri}
                        className="h-3 w-3 rounded-sm bg-transparent"
                        aria-hidden
                      />
                    )
                  }
                  const d = new Date(cell.date)
                  const human = `${FR_WEEKDAY_FULL[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
                  const tooltipText =
                    cell.count === 0
                      ? `${human} — aucune intervention`
                      : `${human} — ${cell.count} intervention${cell.count > 1 ? 's' : ''}`
                  return (
                    <Tooltip key={ri}>
                      <TooltipTrigger>
                        <div
                          className={`h-3 w-3 rounded-sm ${intensityClass(cell.count)} cursor-default`}
                          aria-label={tooltipText}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{tooltipText}</p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Moins</span>
          <div className="h-3 w-3 rounded-sm bg-muted/30 border border-muted" />
          <div className="h-3 w-3 rounded-sm bg-emerald-200 dark:bg-emerald-900/60" />
          <div className="h-3 w-3 rounded-sm bg-emerald-400 dark:bg-emerald-700" />
          <div className="h-3 w-3 rounded-sm bg-emerald-600 dark:bg-emerald-500" />
          <span>Plus</span>
          <span className="ml-auto tabular-nums">
            {total} intervention{total > 1 ? 's' : ''} sur 90 j
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
