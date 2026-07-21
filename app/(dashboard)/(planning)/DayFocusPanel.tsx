import Link from 'next/link'
import { CalendarOff, ChevronRight, X } from 'lucide-react'
import { siteLabel } from '@/lib/labels/site-label'
import { CLOSURE_REASON_FR, type ProjectableClosure } from '@/lib/planning/closures'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { SiteRow } from '@/lib/db/week-planning'

// LE DÉTAIL D'UN JOUR — la Lecture quand on a cliqué une case du mois.
//
// Elle raconte CE JOUR précis : quels chantiers y travaillent, combien
// d'interventions, quelles équipes, et les conflits/fermetures. Sans clic, la
// Lecture reste la vue généralisée du mois (LecturePanel). Même grammaire
// visuelle : la bande de lecture à gauche, la typographie du planning, aucune
// couleur d'accent — les couleurs disent un état métier, rien d'autre.

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
  conflictsBySite,
  closuresBySite,
  weekHref,
}: {
  date: string
  month: string
  siteRows: SiteRow[]
  conflictsBySite: Record<string, Record<string, ClosureConflict>>
  closuresBySite: Record<string, Record<string, ProjectableClosure>>
  weekHref: string
}) {
  const entries = siteRows
    .map((site) => ({
      site,
      cells: site.days[date] ?? [],
      conflict: conflictsBySite[site.site_id]?.[date],
      closure: closuresBySite[site.site_id]?.[date],
    }))
    .filter((e) => e.cells.length > 0 || e.conflict || e.closure)
    .sort(
      (a, b) =>
        a.site.contract_name.localeCompare(b.site.contract_name, 'fr', { sensitivity: 'base' }) ||
        a.site.site_name.localeCompare(b.site.site_name, 'fr', { sensitivity: 'base' }),
    )

  const totalItv = entries.reduce((n, e) => n + e.cells.length, 0)
  const conflictCount = entries.filter((e) => e.conflict).length
  const closureCount = entries.filter((e) => e.closure && !e.conflict).length
  const nothing = totalItv === 0 && conflictCount === 0 && closureCount === 0

  return (
    <aside className="rounded-lg border-l-2 border-reading-border bg-card px-5 py-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Lecture</h2>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{formatFullDate(date)}</p>
        </div>
        <Link
          href={`/mois?m=${month}`}
          aria-label="Revenir à la lecture du mois"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>

      <p className="mt-5 text-xl font-semibold tracking-tight text-foreground">
        {nothing
          ? 'Rien de prévu ce jour-là.'
          : `${totalItv} intervention${totalItv > 1 ? 's' : ''} · ${entries.length} chantier${entries.length > 1 ? 's' : ''}`}
      </p>

      {(conflictCount > 0 || closureCount > 0) && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {conflictCount > 0 && (
            <span className="font-medium text-rose-700 dark:text-rose-300">
              ⚠ {conflictCount} conflit{conflictCount > 1 ? 's' : ''} — chantier fermé, intervention prévue
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
                      title={`Chantier fermé — ${CLOSURE_REASON_FR[e.closure.reasonKind]}`}
                    >
                      <CalendarOff className="h-3 w-3" aria-hidden />
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.cells.length > 0
                    ? `${e.cells.length} intervention${e.cells.length > 1 ? 's' : ''}`
                    : 'aucune intervention'}
                  {teams.length > 0 && ` · ${teams.join(', ')}`}
                  {unassigned && ' · non affecté'}
                </p>
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
