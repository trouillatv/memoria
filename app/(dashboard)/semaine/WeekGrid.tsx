'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.3, étendu 9.4)
//
// Grille HTML sémantique Site × Jour. Promue en client component depuis 9.4
// (cellules droppables via dnd-kit).
//
// 7 colonnes Lun → Dim. Lignes regroupées implicitement par contrat (libellé
// contrat affiché dans la cellule de gauche, sous le nom du site).
//
// Wrappé par WeekGridClient (DndContext + drawer + état drag).

import type { SiteRow, WeekRange, WeekInterventionCell } from '@/lib/db/week-planning'
import type { MemorySignal } from '@/lib/memory/signals/types'
import { WeekGridCell } from './WeekGridCell'
import { MemorySignalBadge } from '@/components/memory/MemorySignalBadge'

const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function enumerateDays(weekStart: string): string[] {
  const out: string[] = []
  const start = new Date(weekStart + 'T00:00:00Z')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function dayNumber(iso: string): number {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso)
  return m ? Number(m[1]) : 0
}

function isToday(iso: string, todayIso: string): boolean {
  return iso === todayIso
}

export interface WeekGridProps {
  range: WeekRange
  rows: SiteRow[]
  /** yyyy-mm-dd UTC — passé par le parent pour highlight de la colonne. */
  todayIso: string
  /** Signaux mémoire par site (Planning-1) — le 1er = badge prioritaire. */
  signalsBySite?: Record<string, MemorySignal[]>
}

export function WeekGrid({ range, rows, todayIso, signalsBySite }: WeekGridProps) {
  const days = enumerateDays(range.weekStart)

  return (
    <div
      className="rounded-lg border bg-card overflow-x-auto"
      data-slot="week-grid"
      data-testid="week-grid"
    >
      <table
        className="w-full text-sm border-collapse"
        aria-label={`Planning semaine ${range.year}-W${String(range.weekNumber).padStart(2, '0')}`}
      >
        <thead className="bg-muted/40">
          <tr>
            <th
              scope="col"
              className="text-left text-xs uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 min-w-[10rem] sticky left-0 bg-muted/40 z-10 border-b"
            >
              Site
            </th>
            {days.map((d, i) => (
              <th
                key={d}
                scope="col"
                data-date={d}
                data-today={isToday(d, todayIso) ? 'true' : 'false'}
                className={
                  'text-left text-xs uppercase tracking-wider font-medium px-2 py-2 border-l border-b min-w-[7rem] ' +
                  (isToday(d, todayIso)
                    ? 'text-foreground bg-accent/40'
                    : 'text-muted-foreground')
                }
              >
                <div className="flex flex-col leading-tight">
                  <span>{DAY_LABELS_SHORT[i]}</span>
                  <span className="text-foreground text-base font-semibold normal-case tracking-normal">
                    {dayNumber(d)}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SiteGridRow
              key={row.site_id}
              row={row}
              days={days}
              todayIso={todayIso}
              topSignal={signalsBySite?.[row.site_id]?.[0]}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SiteGridRow({
  row,
  days,
  todayIso,
  topSignal,
}: {
  row: SiteRow
  days: string[]
  todayIso: string
  topSignal?: MemorySignal
}) {
  return (
    <tr className="border-t" data-site-id={row.site_id}>
      <th
        scope="row"
        className="text-left align-top px-3 py-2 sticky left-0 bg-card z-10 border-r"
      >
        <div className="flex flex-col gap-1 min-w-[9rem]">
          <span className="font-medium text-foreground leading-tight">{row.site_name}</span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            {row.contract_name}
          </span>
          {topSignal && <MemorySignalBadge signal={topSignal} />}
        </div>
      </th>
      {days.map((d) => {
        const cells: WeekInterventionCell[] = row.days[d] ?? []
        return (
          <WeekGridCell
            key={d}
            date={d}
            siteId={row.site_id}
            siteName={row.site_name}
            cells={cells}
            todayIso={todayIso}
          />
        )
      })}
    </tr>
  )
}
