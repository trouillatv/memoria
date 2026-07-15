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

import Link from 'next/link'
import type { SiteRow, WeekRange, WeekInterventionCell } from '@/lib/db/week-planning'
import type { MemorySignal } from '@/lib/memory/signals/types'
import type { WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'
import { siteLabel } from '@/lib/labels/site-label'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { ProjectableClosure } from '@/lib/planning/closures'
import type { MonthRow } from '@/lib/db/month-view'
import {
  dayState,
  peopleOn,
  rowTotal,
  isoWeekParamOf,
  presenceByDay,
  type DayFacts,
  type DayState,
} from '@/lib/planning/month-view'
import { cn } from '@/lib/utils'
import { WeekGridCell } from './WeekGridCell'
import { MemorySignalBadge } from '@/components/memory/MemorySignalBadge'
import { StandingSignalsBadges } from './StandingSignalsBadges'
import {
  enumerateRangeDays,
  weekdayShortFr,
  dayNumber,
  isWeekend,
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
  /**
   * ÉCHELLE MOIS — les FAITS projetés (couverture, fermeture, exception,
   * projection) par chantier. La grille est la même ; seule la densité change :
   * la case porte un nombre et un état, plus une carte d'intervention. Absent en
   * semaine — la Semaine reste strictement inchangée.
   */
  monthRows?: MonthRow[]
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
export function PlanningGrid({ scale = 'week', range, rows, todayIso, monthRows, signalsBySite, standingBySite, daysBySite, conflictsBySite, closuresBySite }: PlanningGridProps) {
  // La PLAGE décide du nombre de colonnes — sept ou trente-et-une, même code.
  const days = enumerateRangeDays({ start: range.weekStart, end: range.weekEnd })
  const colWidth = columnWidthClass(scale)
  const isMonth = scale === 'month' && monthRows != null

  // Couverture du jour (le « 0 » qui saute aux yeux) — calculée à partir des
  // MÊMES faits que les cellules, jamais d'un second comptage.
  const presence = isMonth
    ? presenceByDay(
        Object.fromEntries(days.map((d) => [d, monthRows!.map((r) => r.days[d])])),
      )
    : {}

  return (
    <div
      className="rounded-lg border bg-card overflow-x-auto"
      data-slot="week-grid"
      data-testid="week-grid"
    >
      <table
        className="w-full text-sm border-collapse"
        aria-label={
          isMonth
            ? `Planning mois ${range.weekStart.slice(0, 7)}`
            : `Planning semaine ${range.year}-W${String(range.weekNumber).padStart(2, '0')}`
        }
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
                    : // Ombrage week-end : au MOIS seulement (repère les semaines
                      // dans 31 colonnes). La Semaine reste strictement inchangée.
                      isMonth && isWeekend(d)
                      ? 'text-muted-foreground bg-muted/40'
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
            {isMonth && (
              <th
                scope="col"
                className="text-center text-xs uppercase tracking-wider text-muted-foreground font-medium px-2 py-2 border-l border-b"
              >
                Total
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {isMonth
            ? monthRows!.map((row) => (
                <MonthGridRow key={row.siteId} row={row} days={days} todayIso={todayIso} />
              ))
            : rows.map((row) => (
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
        {/* LA COUVERTURE DU JOUR — un « 0 » se voit de loin. « Couverture prévue »
            (Vincent §6) : le mot « Présents » laissait entendre une présence
            constatée, un pointage. Ici on projette, on ne pointe pas. */}
        {isMonth && (
          <tfoot>
            <tr className="border-t-2">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r bg-card px-3 py-2 text-left text-xs font-semibold"
              >
                Couverture prévue
              </th>
              {days.map((d) => {
                const n = presence[d] ?? 0
                return (
                  <td
                    key={d}
                    className={cn(
                      'border-l border-border/40 py-1.5 text-center text-[11px] font-semibold tabular-nums',
                      isWeekend(d) && 'bg-muted/30',
                      n === 0 && 'bg-rose-50 text-rose-700 dark:bg-rose-950/20',
                    )}
                  >
                    {n}
                  </td>
                )
              })}
              <td className="border-l bg-card" />
            </tr>
          </tfoot>
        )}
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

// ── ÉCHELLE MOIS — la même grille, resserrée ────────────────────────────────
//
// La case du mois ne porte PAS de carte d'intervention : elle porte un nombre
// (combien de monde) et un état (fermé, conflit, trou, projeté). Le clic ouvre
// le MÊME tiroir que la semaine quand il y a du réel à montrer ; un jour
// seulement projeté explique d'abord ce qu'on regarde (état « Planning prévu »)
// avant tout renvoi — jamais de redirection silencieuse.

/** Le glyphe et le style d'une case, par état. Le CHIFFRE est l'information. */
const MONTH_CELL: Record<DayState, { glyph: (n: number) => string; cls: string; title: string }> = {
  ok: { glyph: (n) => String(n), cls: 'tabular-nums text-foreground', title: 'Prévu' },
  projected: {
    glyph: (n) => String(n),
    cls: 'tabular-nums italic text-muted-foreground/70',
    title: 'Projeté par le roulement (pas encore généré)',
  },
  conflict: { glyph: (n) => `${n}!`, cls: 'font-bold tabular-nums text-rose-700', title: 'Fermé ET du monde prévu' },
  closed: { glyph: () => '', cls: '', title: 'Chantier fermé' },
  hole: { glyph: () => '0', cls: 'font-bold tabular-nums text-rose-700/80', title: 'Jour ouvert, personne' },
  empty: { glyph: () => '', cls: '', title: '' },
}

const MONTH_CELL_BG: Record<DayState, string> = {
  ok: '',
  projected: '',
  conflict: 'bg-rose-100 dark:bg-rose-950/40',
  closed: 'bg-sky-100 dark:bg-sky-950/40',
  hole: 'bg-rose-50 dark:bg-rose-950/20',
  empty: '',
}

function MonthGridRow({ row, days, todayIso }: { row: MonthRow; days: string[]; todayIso: string }) {
  return (
    <tr className="border-t" data-site-id={row.siteId}>
      <th
        scope="row"
        className="sticky left-0 z-10 min-w-[10rem] max-w-[13rem] border-r bg-card px-3 py-2 text-left"
      >
        <Link
          href={`/sites/${row.siteId}`}
          className="block truncate text-xs font-semibold hover:underline"
          title={siteLabel(row.siteName, row.clientName)}
        >
          {siteLabel(row.siteName, row.clientName)}
        </Link>
      </th>
      {days.map((d) => (
        <MonthGridCell
          key={d}
          date={d}
          siteId={row.siteId}
          siteLabelText={siteLabel(row.siteName, row.clientName)}
          facts={row.days[d]}
          todayIso={todayIso}
        />
      ))}
      <td className="border-l bg-card px-2 text-center text-[11px] font-semibold tabular-nums">
        {rowTotal(row.days)}
      </td>
    </tr>
  )
}

function MonthGridCell({
  date,
  siteId,
  siteLabelText,
  facts,
  todayIso,
}: {
  date: string
  siteId: string
  siteLabelText: string
  facts: DayFacts
  todayIso: string
}) {
  const state = dayState(facts)
  const meta = MONTH_CELL[state]
  const hasReal = facts.expected > 0 || facts.done > 0 || facts.kept > 0
  const isProjectedOnly = !hasReal && facts.projected > 0
  const cellKey = `${siteId}::${date}`

  const inner = (
    <>
      {meta.glyph(peopleOn(facts))}
      {facts.hasException && (
        <span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-600" />
      )}
    </>
  )
  const innerCls = cn('block h-9 leading-9 text-[11px]', meta.cls)
  const title = [meta.title, facts.hasException ? 'Exception au roulement' : ''].filter(Boolean).join(' · ')

  return (
    <td
      data-date={date}
      data-site-id={siteId}
      className={cn(
        'relative border-l border-border/40 p-0 text-center',
        isWeekend(date) && 'bg-muted/30',
        MONTH_CELL_BG[state],
        date === todayIso && 'outline outline-1 -outline-offset-1 outline-foreground/40',
      )}
    >
      {hasReal ? (
        // Jour RÉEL — le même tiroir que la semaine, ouvert sur place par
        // délégation ([data-cell-trigger] → CellDrawer). Zéro code neuf.
        <button
          type="button"
          data-cell-trigger="true"
          data-cell-key={cellKey}
          title={title}
          className={cn(innerCls, 'w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
          {inner}
        </button>
      ) : isProjectedOnly ? (
        // Jour PROJETÉ — pas de faux tiroir d'intervention, pas de redirection
        // muette : on explique d'abord (état « Planning prévu »), le renvoi vers
        // le roulement se fait ensuite, au bouton. (MonthProjectionSheet.)
        <button
          type="button"
          data-projected-trigger="true"
          data-site-id={siteId}
          data-date={date}
          data-site-label={siteLabelText}
          title="Planning prévu — issu d'un roulement, pas encore matérialisé"
          className={cn(innerCls, 'w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
          {inner}
        </button>
      ) : state === 'closed' ? (
        <Link href="/calendrier" title={title} className={innerCls}>
          {inner}
        </Link>
      ) : state === 'hole' ? (
        <Link href={`/semaine?week=${isoWeekParamOf(date)}&cell=${cellKey}`} title={title} className={innerCls}>
          {inner}
        </Link>
      ) : (
        <span className={innerCls} title={title}>
          {inner}
        </span>
      )}
    </td>
  )
}
