'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.5)
//
// Grille HTML sémantique Équipe × Jour. Vue SECONDAIRE — Site × Jour reste
// primaire (sélection via ViewModeToggle).
//
// 7 colonnes Lun → Dim. Lignes = équipes actives (triées alpha), avec
// "Non-affecté" TOUJOURS en dernier (bandeau ambre discret).
//
// Doctrine V2 :
//   - JAMAIS les noms d'agents. Seulement "Alpha (4 personnes)".
//   - Aucune métrique : pas de "charge", pas de "couverture", pas de %.
//   - "Non-affecté" en dernier, ambre, JAMAIS rouge.
//
// Wrappé par TeamWeekGridClient (DndContext + drawer + état drag).

import type { TeamRow, WeekRange, WeekInterventionCell } from '@/lib/db/week-planning'
import { cn } from '@/lib/utils'
import { TeamBadge } from '@/components/ui/team-badge'
import { TeamWeekGridCell } from './TeamWeekGridCell'

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

/**
 * Formate l'effectif d'une équipe pour la cellule de gauche.
 *
 * - Strictement informatif : "4 personnes" — pas d'usage analytique.
 * - Pluriel correct : "1 personne" / "n personnes".
 * - 0 ou négatif → "—" (vide muted, plus discret que "0 personnes").
 */
export function formatMemberCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '—'
  if (count === 1) return '1 personne'
  return `${count} personnes`
}

export interface TeamWeekGridProps {
  range: WeekRange
  rows: TeamRow[]
  /** yyyy-mm-dd UTC — passé par le parent pour highlight de la colonne. */
  todayIso: string
}

export function TeamWeekGrid({ range, rows, todayIso }: TeamWeekGridProps) {
  const days = enumerateDays(range.weekStart)

  return (
    <div
      className="rounded-lg border bg-card overflow-x-auto"
      data-slot="team-week-grid"
      data-testid="team-week-grid"
    >
      <table
        className="w-full text-sm border-collapse"
        aria-label={`Planning par équipe semaine ${range.year}-W${String(range.weekNumber).padStart(2, '0')}`}
      >
        <thead className="bg-muted/40">
          <tr>
            <th
              scope="col"
              className="text-left text-xs uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 min-w-[10rem] sticky left-0 bg-muted/40 z-10 border-b"
            >
              Équipe
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
            <TeamGridRow
              key={row.team_id ?? '__unassigned__'}
              row={row}
              days={days}
              todayIso={todayIso}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamGridRow({
  row,
  days,
  todayIso,
}: {
  row: TeamRow
  days: string[]
  todayIso: string
}) {
  const isUnassigned = row.team_id === null
  return (
    <tr
      className="border-t"
      data-team-id={row.team_id ?? '__unassigned__'}
      data-unassigned={isUnassigned ? 'true' : 'false'}
    >
      <th
        scope="row"
        className={cn(
          'text-left align-top px-3 py-2 sticky left-0 z-10 border-r',
          isUnassigned ? 'bg-amber-50/40' : 'bg-card',
        )}
      >
        <div className="flex flex-col gap-0.5 min-w-[9rem]">
          {isUnassigned ? (
            <span
              className="inline-flex items-center gap-1 text-amber-800 font-medium leading-tight"
              title="Interventions sans équipe affectée"
            >
              <span aria-hidden="true">{'◯'}</span>
              Non-affecté
            </span>
          ) : (
            <>
              <TeamBadge
                name={row.team_name}
                color={row.team_color}
                size="md"
                className="self-start"
              />
              <span className="text-[11px] text-muted-foreground leading-tight mt-1">
                {formatMemberCount(row.member_count)}
              </span>
            </>
          )}
        </div>
      </th>
      {days.map((d) => {
        const cells: WeekInterventionCell[] = row.days[d] ?? []
        return (
          <TeamWeekGridCell
            key={d}
            date={d}
            teamId={row.team_id}
            teamName={row.team_name}
            cells={cells}
            todayIso={todayIso}
          />
        )
      })}
    </tr>
  )
}
