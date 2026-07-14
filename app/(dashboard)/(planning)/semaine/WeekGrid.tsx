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
import type { WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'
import { siteLabel } from '@/lib/labels/site-label'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { ProjectableClosure } from '@/lib/planning/closures'
import { WeekGridCell } from './WeekGridCell'
import { MemorySignalBadge } from '@/components/memory/MemorySignalBadge'
import { StandingSignalsBadges } from './StandingSignalsBadges'
import {
  enumerateRangeDays,
  weekdayShortFr,
  dayNumber,
  columnWidthClass,
  type PlanningScale,
} from '@/lib/planning/scale'

function isToday(iso: string, todayIso: string): boolean {
  return iso === todayIso
}

export interface PlanningGridProps {
  /**
   * L'échelle de lecture. Elle ne change QUE la densité : le nombre de colonnes
   * et la largeur des cases. Les données, les conflits, les fermetures, le
   * tiroir et les gestes sont les mêmes — sans quoi ce serait un second produit.
   */
  scale?: PlanningScale
  range: WeekRange
  rows: SiteRow[]
  /** yyyy-mm-dd UTC — passé par le parent pour highlight de la colonne. */
  todayIso: string
  /** Signaux mémoire par site (Planning-1) — le 1er = badge prioritaire. */
  signalsBySite?: Record<string, MemorySignal[]>
  /** Signaux opérationnels EN COURS par site (Niveau 1) — blocages, réserves ouvertes. */
  standingBySite?: Record<string, WeekOperationalSignal[]>
  /** Événements datés par site puis par jour (Niveau 2) — réunion/échéance/livraison. */
  daysBySite?: Record<string, Record<string, WeekOperationalSignal[]>>
  /** PL3a — conflits « site fermé, prestation prévue », par site puis par jour.
   *  OPTIONNEL : sans lui, la grille est strictement identique à avant. */
  conflictsBySite?: Record<string, Record<string, ClosureConflict>>
  /** Niveau 1 — le CALENDRIER du chantier : quels jours il est fermé, même sans
   *  aucune prestation prévue. La fermeture est une information métier. */
  closuresBySite?: Record<string, Record<string, ProjectableClosure>>
}

/**
 * LA GRILLE DU PLANNING — une seule, à toutes les échelles.
 *
 * C'est l'écran vivant : le glisser-déposer, les conflits, les fermetures, la
 * mémoire du lieu, le tiroir. Le mois ne sera PAS une seconde grille écrite à
 * côté : ce sera celle-ci, avec plus de colonnes et des cases plus serrées.
 *
 * Deux tableaux parallèles finissent toujours par diverger.
 */
export function PlanningGrid({ scale = 'week', range, rows, todayIso, signalsBySite, standingBySite, daysBySite, conflictsBySite, closuresBySite }: PlanningGridProps) {
  // La PLAGE décide du nombre de colonnes — sept ou trente-et-une, même code.
  const days = enumerateRangeDays({ start: range.weekStart, end: range.weekEnd })
  const colWidth = columnWidthClass(scale)

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
              Chantier
            </th>
            {days.map((d) => (
              <th
                key={d}
                scope="col"
                data-date={d}
                data-today={isToday(d, todayIso) ? 'true' : 'false'}
                className={
                  'text-left text-xs uppercase tracking-wider font-medium px-2 py-2 border-l border-b ' +
                  colWidth + ' ' +
                  (isToday(d, todayIso)
                    ? 'text-foreground bg-accent/40'
                    : 'text-muted-foreground')
                }
              >
                <div className="flex flex-col leading-tight">
                  <span>{weekdayShortFr(d)}</span>
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
              standing={standingBySite?.[row.site_id]}
              dayEventsByDate={daysBySite?.[row.site_id]}
              conflictByDate={conflictsBySite?.[row.site_id]}
              closureByDate={closuresBySite?.[row.site_id]}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * La semaine — un simple point d'entrée sur la grille commune.
 *
 * Elle ne fait plus rien de particulier : c'est PlanningGrid à l'échelle
 * « semaine ». Le mois entrera par la même porte, et non par un second tableau.
 */
export type WeekGridProps = Omit<PlanningGridProps, 'scale'>

export function WeekGrid(props: WeekGridProps) {
  return <PlanningGrid scale="week" {...props} />
}

function SiteGridRow({
  row,
  days,
  todayIso,
  topSignal,
  standing,
  dayEventsByDate,
  conflictByDate,
  closureByDate,
}: {
  row: SiteRow
  days: string[]
  todayIso: string
  topSignal?: MemorySignal
  standing?: WeekOperationalSignal[]
  dayEventsByDate?: Record<string, WeekOperationalSignal[]>
  conflictByDate?: Record<string, ClosureConflict>
  closureByDate?: Record<string, ProjectableClosure>
}) {
  return (
    <tr className="border-t" data-site-id={row.site_id}>
      <th
        scope="row"
        className="text-left align-top px-3 py-2 sticky left-0 bg-card z-10 border-r"
      >
        <div className="flex flex-col gap-1 min-w-[9rem]">
          {/* Client + chantier : deux sites homonymes restent distinguables
              (« Discount — Pointière » vs « Mairie — Pointière »). Le contrat
              reste en seconde ligne — c'est un détail, pas une identité. */}
          <span className="font-medium text-foreground leading-tight">
            {siteLabel(row.site_name, row.client_name)}
          </span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            {row.contract_name}
          </span>
          {topSignal && <MemorySignalBadge signal={topSignal} />}
          <StandingSignalsBadges signals={standing} todayIso={todayIso} />
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
            dayEvents={dayEventsByDate?.[d]}
            conflict={conflictByDate?.[d]}
            closure={closureByDate?.[d]}
          />
        )
      })}
    </tr>
  )
}
