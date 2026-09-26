import Link from 'next/link'
import { CalendarOff, ChevronRight, X } from 'lucide-react'
import { TeamBadge } from '@/components/ui/team-badge'
import { siteLabel } from '@/lib/labels/site-label'
import { CLOSURE_REASON_FR, type ProjectableClosure } from '@/lib/planning/closures'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import { dayState } from '@/lib/planning/month-view'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import type { MonthRow } from '@/lib/db/month-view'
import type { SiteRow } from '@/lib/db/week-planning'

function formatFullDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

export function DayFocusPanel({
  date,
  month,
  siteRows,
  monthRows = [],
  conflictsBySite,
  closuresBySite,
  weekHref,
  onClearFocus,
}: {
  date: string
  month: string
  siteRows: SiteRow[]
  monthRows?: MonthRow[]
  conflictsBySite: Record<string, Record<string, ClosureConflict>>
  closuresBySite: Record<string, Record<string, ProjectableClosure>>
  weekHref: string
  onClearFocus?: () => void
}) {
  const siteById = new Map(siteRows.map((site) => [site.site_id, site]))
  const monthById = new Map(monthRows.map((row) => [row.siteId, row]))
  const siteIds = [...new Set([...siteById.keys(), ...monthById.keys()])]

  const entries = siteIds
    .map((siteId) => {
      const site = siteById.get(siteId)
      const monthRow = monthById.get(siteId)
      const facts = monthRow?.days[date]
      return {
        site: site ?? {
          site_id: siteId,
          site_name: monthRow?.siteName ?? 'Chantier',
          client_name: monthRow?.clientName ?? null,
          contract_id: '',
          contract_name: 'Contrat',
          days: {},
        },
        cells: site?.days[date] ?? [],
        facts,
        projectedOccurrences: facts?.projectedOccurrences ?? [],
        conflict: conflictsBySite[siteId]?.[date],
        closure: closuresBySite[siteId]?.[date],
      }
    })
    .filter((e) => e.cells.length > 0 || e.projectedOccurrences.length > 0 || e.conflict || e.closure || (e.facts && dayState(e.facts) === 'hole'))
    .sort(
      (a, b) =>
        a.site.contract_name.localeCompare(b.site.contract_name, 'fr', { sensitivity: 'base' }) ||
        a.site.site_name.localeCompare(b.site.site_name, 'fr', { sensitivity: 'base' }),
    )

  const totalItv = entries.reduce((n, e) => n + e.cells.length, 0)
  const totalProjected = entries.reduce((n, e) => n + e.projectedOccurrences.length, 0)
  const conflictCount = entries.filter((e) => e.conflict).length
  const closureCount = entries.filter((e) => e.closure && !e.conflict).length
  const nothing = totalItv === 0 && totalProjected === 0 && conflictCount === 0 && closureCount === 0

  return (
    <aside className="rounded-lg border-l-2 border-reading-border bg-card px-5 py-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Lecture</h2>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{formatFullDate(date)}</p>
        </div>
        {onClearFocus ? (
          <button
            type="button"
            onClick={onClearFocus}
            aria-label="Revenir à la lecture du mois"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href={`/mois?m=${month}`}
            aria-label="Revenir à la lecture du mois"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </Link>
        )}
      </div>

      <p className="mt-5 text-xl font-semibold tracking-tight text-foreground">
        {nothing
          ? 'Rien de prévu ce jour-là.'
          : [
              totalItv > 0 ? `${totalItv} intervention${totalItv > 1 ? 's' : ''}` : null,
              totalProjected > 0 ? `${totalProjected} prévu${totalProjected > 1 ? 's' : ''} par le rythme` : null,
              `${entries.length} chantier${entries.length > 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ')}
      </p>

      {(conflictCount > 0 || closureCount > 0) && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {conflictCount > 0 && (
            <span className="font-medium text-rose-700 dark:text-rose-300">
              {conflictCount} conflit{conflictCount > 1 ? 's' : ''} - chantier fermé, intervention prévue
            </span>
          )}
          {closureCount > 0 && (
            <span className="text-sky-700 dark:text-sky-300">
              {closureCount} chantier{closureCount > 1 ? 's' : ''} fermé{closureCount > 1 ? 's' : ''}
            </span>
          )}
        </p>
      )}

      {entries.length > 0 && (
        <ul className="mt-5 space-y-3">
          {entries.map((e) => {
            const teams = [
              ...new Set(e.cells.map((c) => c.assigned_team_name).filter((v): v is string => !!v)),
            ]
            const unassigned = e.cells.length > 0 && teams.length === 0
            return (
              <li key={e.site.site_id} className="border-t pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/sites/${e.site.site_id}`}
                    className="text-sm font-medium leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {siteLabel(e.site.site_name, e.site.client_name)}
                  </Link>
                  {e.conflict ? (
                    <span
                      className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-rose-100 p-0.5 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/50 dark:text-rose-200 dark:ring-rose-800"
                      title="Chantier fermé alors qu'une intervention y est prévue"
                    >
                      <CalendarOff className="h-3 w-3" aria-hidden />
                    </span>
                  ) : e.closure ? (
                    <span
                      className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-sky-100 p-0.5 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-900/50 dark:text-sky-200 dark:ring-sky-800"
                      title={`Chantier fermé - ${CLOSURE_REASON_FR[e.closure.reasonKind]}`}
                    >
                      <CalendarOff className="h-3 w-3" aria-hidden />
                    </span>
                  ) : null}
                </div>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.cells.length > 0
                    ? `${e.cells.length} intervention${e.cells.length > 1 ? 's' : ''} planifiée${e.cells.length > 1 ? 's' : ''}`
                    : 'aucune intervention'}
                  {teams.length > 0 && ` · ${teams.join(', ')}`}
                  {unassigned && ' · non affecté'}
                </p>

                {e.cells.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Intervention planifiée
                    </p>
                    {e.cells.map((cell) => (
                      <div key={cell.id} className="rounded-md border bg-background px-2.5 py-2 text-xs">
                        <p className="font-medium text-foreground">{cell.mission_name}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {formatInterventionTimeLabel({
                            planned_start: cell.planned_start,
                            planned_end: cell.planned_end,
                            slot: cell.slot as never,
                          })}
                        </p>
                        {cell.assigned_team_name && (
                          <div className="mt-1.5">
                            <TeamBadge name={cell.assigned_team_name} color={cell.assigned_team_color} variant="dot" />
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                          <Link href={`/interventions/${cell.id}`} className="font-medium text-primary hover:underline">
                            Voir l&apos;intervention
                          </Link>
                          <Link href={`/missions/${cell.mission_id}`} className="font-medium text-primary hover:underline">
                            Voir la mission
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {e.projectedOccurrences.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Prévu par le rythme
                    </p>
                    {e.projectedOccurrences.map((projection) => (
                      <div key={`${projection.templateId}-${projection.plannedStart ?? date}`} className="rounded-md border border-dashed bg-background px-2.5 py-2 text-xs">
                        <p className="font-medium text-foreground">{projection.missionName ?? 'Mission'}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {formatInterventionTimeLabel({
                            planned_start: projection.plannedStart,
                            planned_end: projection.plannedEnd,
                            slot: projection.slot as never,
                          })}
                        </p>
                        {projection.assignedTeamName && (
                          <div className="mt-1.5">
                            <TeamBadge name={projection.assignedTeamName} color={projection.assignedTeamColor} variant="dot" />
                          </div>
                        )}
                        <p className="mt-1.5 text-[11px] text-muted-foreground">Occurrence issue du rythme de la Mission.</p>
                        <Link href={`/missions/${projection.missionId}`} className="mt-2 inline-flex text-[11px] font-medium text-primary hover:underline">
                          Voir la mission
                        </Link>
                      </div>
                    ))}
                    {e.cells.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">Aucune intervention matérialisée pour cette date.</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Link
        href={weekHref}
        className="mt-6 flex items-center gap-1 border-t pt-3 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Ouvrir la semaine <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </aside>
  )
}
