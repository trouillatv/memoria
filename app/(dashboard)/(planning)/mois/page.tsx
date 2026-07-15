// LA VUE MOIS — « est-ce que mon mois est bon ? »
//
// L'écran principal du domaine Planning. Le directeur ouvre, deux secondes, il
// sait. Le verdict répond AVANT la grille ; la grille justifie ; chaque clic
// conduit à l'écran canonique le plus pertinent.
//
// PL6-R2 (Vincent 2026-07-15) — LE MOIS ENTRE DANS LA GRILLE UNIQUE. Il n'a plus
// sa table parallèle : il est rendu par `PlanningGrid scale="month"`, exactement
// le noyau de la Semaine. Un jour RÉEL ouvre le MÊME tiroir, sur place ; un jour
// seulement PROJETÉ ouvre l'état « Planning prévu » (pas de faux tiroir, pas de
// redirection muette). La Semaine, elle, n'a pas bougé d'une ligne.
//
// Les trois garde-fous (Vincent, 2026-07-15) tiennent : projection uniquement ·
// une cellule = une seconde · navigation contextuelle. Aucune matérialisation à
// la lecture, aucun drag mensuel dans R2.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildMonthRows, buildTeamMonthRows } from '@/lib/db/month-view'
import {
  monthVerdict,
  verdictPhrase,
  monthDays,
  isoWeekParamOf,
  teamDayState,
  teamPresenceByDay,
  teamWorkedDays,
  type DayFacts,
  type TeamDayFacts,
  type TeamDayState,
} from '@/lib/planning/month-view'
import {
  getWeekBySite,
  listTemplatesByIds,
  type WeekRange,
  type SiteRow,
  type WeekTemplate,
} from '@/lib/db/week-planning'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { projectClosures, type ProjectableClosure } from '@/lib/planning/closures'
import { detectClosureConflicts, type ClosureConflict } from '@/lib/planning/conflicts'
import { resolutionOptions, type ResolutionOption } from '@/lib/planning/conflict-resolution'
import { listKeptInterventionIds, listDecisions, type ClosureDecision } from '@/lib/db/closure-decisions'
import { detectDeviations, hhmmOf } from '@/lib/planning/occurrence-exception'
import { listTeams } from '@/lib/db/teams'
import { parseViewMode } from '../semaine/view-mode-storage'
import { MonthViewModeToggle } from './MonthViewModeToggle'
import { PlanningGrid } from '../semaine/WeekGrid'
import { WeekGridClient } from '../semaine/WeekGridClient'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number)
  return `${MOIS_FR[mm - 1]} ${y}`
}

function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "Aujourd'hui" ancré sur Pacific/Noumea — comme la Semaine, pour que le jour
 *  ne bascule pas prématurément vu depuis l'Europe. */
function todayNoumeaIso(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Pacific/Noumea',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftIso(dateIso: string, days: number): string {
  const t = new Date(`${dateIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(t)) return dateIso
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** Le contexte des fermetures/conflits/exceptions du MOIS, assemblé à partir des
 *  interventions RÉELLES — exactement comme la Semaine, sur une plage de 31 jours
 *  au lieu de 7. Sert au tiroir (le même). Vide si rien n'est en base. */
async function assembleMonthClosureContext(
  siteRows: SiteRow[],
  from: string,
  to: string,
  todayIso: string,
) {
  const empty = {
    conflictsBySite: {} as Record<string, Record<string, ClosureConflict>>,
    closuresBySite: {} as Record<string, Record<string, ProjectableClosure>>,
    decisions: {} as Record<string, ClosureDecision>,
    optionsBySite: {} as Record<string, Record<string, ResolutionOption[]>>,
    exceptionsById: {} as Record<string, string[]>,
  }
  if (siteRows.length === 0) return empty

  const siteIds = siteRows.map((r) => r.site_id)
  const raw = await listActiveClosuresForSites(siteIds, from, to).catch(
    (): Record<string, SiteClosure[]> => ({}),
  )
  // ±14 jours autour du mois : la fenêtre où un déplacement a du sens.
  const wide = await listActiveClosuresForSites(
    siteIds,
    shiftIso(from, -14),
    shiftIso(to, 14),
  ).catch((): Record<string, SiteClosure[]> => ({}))

  const closuresBySite: Record<string, Record<string, ProjectableClosure>> = {}
  for (const row of siteRows) {
    const closures = raw[row.site_id] ?? []
    if (closures.length === 0) continue
    closuresBySite[row.site_id] = projectClosures({ closures, from, to })
  }

  const allCellIds = siteRows.flatMap((r) => Object.values(r.days).flat().map((c) => c.id))
  const keptInterventionIds = await listKeptInterventionIds(allCellIds).catch(() => new Set<string>())
  const decisions = await listDecisions(allCellIds).catch(() => ({}))

  const conflictsBySite = detectClosureConflicts({
    rows: siteRows,
    closuresBySite: raw,
    keptInterventionIds,
  })

  const optionsBySite: Record<string, Record<string, ResolutionOption[]>> = {}
  for (const [siteId, byDateConflict] of Object.entries(conflictsBySite)) {
    const closures = wide[siteId] ?? []
    optionsBySite[siteId] = {}
    for (const conflictDate of Object.keys(byDateConflict)) {
      optionsBySite[siteId][conflictDate] = resolutionOptions(closures, conflictDate).filter(
        (o) => o.date >= todayIso,
      )
    }
  }

  const allCells = siteRows.flatMap((r) => Object.values(r.days).flat())
  const templatesById = await listTemplatesByIds(
    allCells.map((c) => c.template_id).filter((v): v is string => !!v),
  ).catch((): Record<string, WeekTemplate> => ({}))

  const exceptionsById: Record<string, string[]> = {}
  for (const c of allCells) {
    const tpl = c.template_id ? templatesById[c.template_id] : undefined
    if (!tpl) continue
    exceptionsById[c.id] = detectDeviations(
      {
        scheduledFor: c.scheduled_for,
        status: c.status,
        assignedTeamId: c.assigned_team_id,
        startHHMM: hhmmOf(c.planned_start),
        endHHMM: hhmmOf(c.planned_end),
      },
      tpl,
    ).map((d) => d.label)
  }

  return { conflictsBySite, closuresBySite, decisions, optionsBySite, exceptionsById }
}

/** Le mode Équipe : T (travail) / R (repos), comme le planning papier. La ligne
 *  est une ÉQUIPE — jamais une personne : une grille de jours travaillés par
 *  individu serait une feuille de présence, pas un planning. */
const TEAM_CELL: Record<TeamDayState, { glyph: (n: number) => string; cls: string; title: string }> = {
  work: { glyph: (n) => (n > 1 ? `T${n}` : 'T'), cls: 'font-medium text-foreground', title: 'Travail' },
  projected: {
    glyph: () => 'T',
    cls: 'italic text-muted-foreground/70',
    title: 'Projeté par le roulement (pas encore généré)',
  },
  conflict: { glyph: () => 'T!', cls: 'font-bold text-rose-700', title: 'Chantier fermé ET équipe prévue' },
  rest: { glyph: () => 'R', cls: 'text-muted-foreground/50', title: 'Repos' },
}

const TEAM_CELL_BG: Record<TeamDayState, string> = {
  work: '',
  projected: '',
  conflict: 'bg-rose-100 dark:bg-rose-950/40',
  rest: 'bg-amber-50/70 dark:bg-amber-950/20',
}

export default async function MoisPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string; cell?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const sp = await searchParams
  const todayIso = todayNoumeaIso()
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : todayIso.slice(0, 7)
  // Le même geste que la Semaine : Chantier × Jour par défaut, Équipe × Jour au
  // second plan. Un seul planning, deux axes de lecture.
  const view = parseViewMode(sp.view)

  const days = monthDays(month)
  const from = days[0].date
  const to = days[days.length - 1].date
  const rows = await buildMonthRows({ from, to })
  // Les mêmes faits, regroupés autrement — jamais un second moteur.
  const teamRows = view === 'team' ? await buildTeamMonthRows({ from, to, siteRows: rows }) : []

  // VUE CHANTIER — les interventions RÉELLES du mois alimentent le MÊME tiroir
  // que la Semaine. Un seul loader, borné par la plage (31 jours ici).
  const range: WeekRange = { weekStart: from, weekEnd: to, weekNumber: 0, year: Number(month.slice(0, 4)) }
  const [siteRows, allTeams] =
    view === 'site'
      ? await Promise.all([getWeekBySite(range), listTeams()])
      : [[] as SiteRow[], [] as Awaited<ReturnType<typeof listTeams>>]
  const teams = allTeams
    .filter((t) => t.active && !t.deleted_at)
    .map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const { conflictsBySite, closuresBySite, decisions, optionsBySite, exceptionsById } =
    view === 'site'
      ? await assembleMonthClosureContext(siteRows, from, to, todayIso)
      : {
          conflictsBySite: {} as Record<string, Record<string, ClosureConflict>>,
          closuresBySite: {} as Record<string, Record<string, ProjectableClosure>>,
          decisions: {} as Record<string, ClosureDecision>,
          optionsBySite: {} as Record<string, Record<string, ResolutionOption[]>>,
          exceptionsById: {} as Record<string, string[]>,
        }

  // Le verdict : les faits de tous les chantiers, jour par jour. Il ne change
  // pas d'axe : le mois est bon ou non, quelle que soit la façon de le lire.
  const byDay: Record<string, DayFacts[]> = {}
  for (const d of days) byDay[d.date] = rows.map((r) => r.days[d.date])
  const v = monthVerdict(byDay)

  const teamByDay: Record<string, TeamDayFacts[]> = {}
  for (const d of days) teamByDay[d.date] = teamRows.map((r) => r.days[d.date])
  const teamPresence = teamPresenceByDay(teamByDay)

  return (
    <div className="w-full max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
            <CalendarRange className="h-5 w-5 text-muted-foreground" /> Planning du mois
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Qui travaille où, chaque jour. Cliquez sur un jour pour ouvrir son détail.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthViewModeToggle mode={view} />
          <nav className="inline-flex items-center gap-1">
            <Link
              href={`/mois?m=${shiftMonth(month, -1)}${view === 'team' ? '&view=team' : ''}`}
              aria-label="Mois précédent"
              className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="px-2 text-sm font-semibold capitalize">{monthLabel(month)}</span>
            <Link
              href={`/mois?m=${shiftMonth(month, 1)}${view === 'team' ? '&view=team' : ''}`}
              aria-label="Mois suivant"
              className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── LE VERDICT — la réponse avant la grille ─────────────────────── */}
      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold">{verdictPhrase(v)}</p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {v.readyDays} jour{v.readyDays > 1 ? 's' : ''} sur {v.totalDays} sans rien à traiter
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={v.readyPct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              v.readyPct >= 90 ? 'bg-emerald-500' : v.readyPct >= 60 ? 'bg-amber-500' : 'bg-rose-500',
            )}
            style={{ width: `${v.readyPct}%` }}
          />
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {v.conflicts > 0 && (
            <span className="font-medium text-rose-700">
              ⚠ {v.conflicts} conflit{v.conflicts > 1 ? 's' : ''} à traiter
            </span>
          )}
          {v.holes > 0 && (
            <span className="font-medium text-rose-700">
              ⚠ {v.holes} jour{v.holes > 1 ? 's' : ''} sans personne
            </span>
          )}
          {v.closedDays > 0 && (
            <span className="text-sky-800 dark:text-sky-300">
              {v.closedDays} fermeture{v.closedDays > 1 ? 's' : ''} prévue{v.closedDays > 1 ? 's' : ''}
            </span>
          )}
          {v.exceptions > 0 && (
            <span className="text-violet-700 dark:text-violet-300">
              {v.exceptions} exception{v.exceptions > 1 ? 's' : ''}
            </span>
          )}
          {v.conflicts === 0 && v.holes === 0 && (
            <span className="text-muted-foreground">Le reste du mois suit ses roulements.</span>
          )}
        </p>
      </section>

      {/* ── LA GRILLE ────────────────────────────────────────────────────
          Chantier : la grille UNIQUE (PlanningGrid), le MÊME tiroir. Équipe :
          la même projection, regroupée sur l'axe équipe (T/R). ─────────────── */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Rien à projeter ce mois-ci : aucune intervention, aucun roulement, aucune fermeture.
        </p>
      ) : view === 'team' ? (
        teamRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Aucune équipe n&apos;est affectée ce mois-ci. Le travail existe, mais personne ne le porte
            encore — il se lit par chantier.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-3 py-1.5" />
                  {days.map((d) => (
                    <th
                      key={d.date}
                      className={cn(
                        'min-w-[26px] border-l border-border/50 pb-1 pt-1.5 text-center text-[10px] font-medium text-muted-foreground',
                        d.weekend && 'bg-muted/40',
                        d.date === todayIso && 'text-foreground',
                      )}
                    >
                      <span className="block leading-none">{'lmmjvsd'[d.weekday - 1]}</span>
                      <span className={cn('tabular-nums', d.weekend && 'opacity-70')}>{d.num}</span>
                    </th>
                  ))}
                  <th className="border-l bg-card px-2 py-1.5 text-center text-[10px] font-medium text-muted-foreground">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((row) => (
                  <tr key={row.teamId} className="border-t">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[140px] max-w-[200px] border-r bg-card px-3 py-1.5 text-left"
                    >
                      <Link
                        href={`/equipes/${row.teamId}`}
                        className="block truncate text-xs font-semibold hover:underline"
                      >
                        {row.teamName}
                      </Link>
                      {row.members.length > 0 && (
                        <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                          {row.members.join(', ')}
                        </span>
                      )}
                    </th>
                    {days.map((d) => {
                      const facts = row.days[d.date]
                      const state = teamDayState(facts)
                      const meta = TEAM_CELL[state]
                      return (
                        <td
                          key={d.date}
                          className={cn(
                            'relative border-l border-border/40 p-0 text-center',
                            d.weekend && 'bg-muted/30',
                            TEAM_CELL_BG[state],
                            d.date === todayIso && 'outline outline-1 -outline-offset-1 outline-foreground/40',
                          )}
                        >
                          <Link
                            href={`/semaine?week=${isoWeekParamOf(d.date)}&view=team`}
                            title={[meta.title, facts.hasException ? 'Exception au roulement' : '']
                              .filter(Boolean)
                              .join(' · ')}
                            className={cn('block h-8 text-[11px] leading-8', meta.cls)}
                          >
                            {meta.glyph(facts.worked)}
                            {facts.hasException && (
                              <span
                                aria-hidden
                                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-violet-600"
                              />
                            )}
                          </Link>
                        </td>
                      )
                    })}
                    <td className="border-l bg-card px-2 text-center text-[11px] font-semibold tabular-nums">
                      {teamWorkedDays(row.days)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left text-xs font-semibold"
                  >
                    Couverture prévue
                  </th>
                  {days.map((d) => {
                    const n = teamPresence[d.date]
                    return (
                      <td
                        key={d.date}
                        className={cn(
                          'border-l border-border/40 py-1.5 text-center text-[11px] font-semibold tabular-nums',
                          d.weekend && 'bg-muted/30',
                          n === 0 && 'bg-rose-50 text-rose-700 dark:bg-rose-950/20',
                        )}
                      >
                        {n === 0 ? '0' : n}
                      </td>
                    )
                  })}
                  <td className="border-l bg-card" />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : (
        // CHANTIER — la grille unique + le tiroir de la Semaine. Le mois n'a plus
        // de table à lui : c'est PlanningGrid, resserré. Le clic sur un jour réel
        // ouvre le tiroir sur place ; un jour projeté ouvre « Planning prévu ».
        <WeekGridClient
          rows={siteRows}
          todayIso={todayIso}
          teams={teams}
          conflictsBySite={conflictsBySite}
          closuresBySite={closuresBySite}
          decisions={decisions}
          optionsBySite={optionsBySite}
          exceptionsById={exceptionsById}
          initialCellKey={sp.cell ?? null}
        >
          {/* Un seul tiroir (CellDrawer) : jour réel → intervention, jour projeté
              → « Planning prévu ». Plus de panneau propre au mois. */}
          <PlanningGrid
            scale="month"
            range={range}
            rows={siteRows}
            monthRows={rows}
            todayIso={todayIso}
            conflictsBySite={conflictsBySite}
            closuresBySite={closuresBySite}
          />
        </WeekGridClient>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {view === 'team' ? (
          <>
            <span><span className="font-medium text-foreground">T</span> travail</span>
            <span><span className="italic opacity-70">T</span> projeté par le roulement</span>
            <span>
              <span className="mr-1 inline-block h-3 w-3 rounded bg-amber-50 align-[-2px] dark:bg-amber-950/20" />
              <span className="text-muted-foreground/70">R</span> repos
            </span>
            <span>
              <span className="mr-1 inline-block h-3 w-3 rounded bg-rose-100 align-[-2px] dark:bg-rose-950/40" />
              <span className="font-bold text-rose-700">T!</span> chantier fermé, équipe prévue
            </span>
            <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-600 align-[1px]" />exception</span>
          </>
        ) : (
          <>
            <span>chiffre = personnes prévues</span>
            <span><span className="italic opacity-70">italique</span> = projeté par le roulement</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sky-100 align-[-2px] dark:bg-sky-950/40" />fermé</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-rose-100 align-[-2px] dark:bg-rose-950/40" /><span className="font-bold text-rose-700">!</span> conflit</span>
            <span><span className="font-bold text-rose-700/80">0</span> jour ouvert sans personne</span>
            <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-600 align-[1px]" />exception</span>
          </>
        )}
      </p>
    </div>
  )
}
