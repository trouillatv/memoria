// LA VUE MOIS — « est-ce que mon mois est bon ? »
//
// L'écran principal du domaine Planning. Le directeur ouvre, deux secondes, il
// sait. Le verdict répond AVANT la grille ; la grille justifie ; chaque clic
// conduit à l'écran canonique le plus pertinent.
//
// Les trois garde-fous (Vincent, 2026-07-15) vivent dans
// lib/planning/month-view.ts : projection uniquement · une cellule = une
// seconde · navigation contextuelle. La règle anti-Excel s'applique ICI : pas
// d'équipes, pas d'heures, pas de commentaires dans la grille. Jamais.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildMonthRows, buildTeamMonthRows } from '@/lib/db/month-view'
import {
  dayState,
  dayTarget,
  monthVerdict,
  verdictPhrase,
  monthDays,
  isoWeekParamOf,
  peopleOn,
  presenceByDay,
  rowTotal,
  teamDayState,
  teamPresenceByDay,
  teamWorkedDays,
  type DayFacts,
  type DayState,
  type TeamDayFacts,
  type TeamDayState,
} from '@/lib/planning/month-view'
import { parseViewMode } from '../semaine/view-mode-storage'
import { MonthViewModeToggle } from './MonthViewModeToggle'
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

/** Où mène la cellule — l'écran canonique le plus pertinent. */
function hrefOf(state: DayState, hasException: boolean, siteId: string, date: string): string {
  const target = dayTarget(state, hasException)
  if (target === 'calendar') return '/calendrier'
  const week = `/semaine?week=${isoWeekParamOf(date)}`
  // Le tiroir du conflit / de l'exception : la semaine sait l'ouvrir d'elle-même.
  return target === 'week_drawer' ? `${week}&cell=${siteId}::${date}` : week
}

/** La cellule — UN état, lisible en une seconde. Le CHIFFRE est l'information :
 *  combien de monde ce jour-là (maquette validée). Le ✓ ne disait pas « 1 ou 2 »,
 *  et c'est précisément ce que le conducteur cherche du regard. */
const CELL: Record<DayState, { glyph: (n: number) => string; cls: string; title: string }> = {
  ok: { glyph: (n) => String(n), cls: 'tabular-nums text-foreground', title: 'Prévu' },
  projected: {
    glyph: (n) => String(n),
    cls: 'tabular-nums italic text-muted-foreground/70',
    title: 'Projeté par le roulement (pas encore généré)',
  },
  conflict: {
    glyph: (n) => `${n}!`,
    cls: 'font-bold tabular-nums text-rose-700',
    title: 'Fermé ET du monde prévu',
  },
  closed: { glyph: () => '', cls: '', title: 'Chantier fermé' },
  hole: { glyph: () => '0', cls: 'font-bold tabular-nums text-rose-700/80', title: 'Jour ouvert, personne' },
  empty: { glyph: () => '', cls: '', title: '' },
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

const CELL_BG: Record<DayState, string> = {
  ok: '',
  projected: '',
  conflict: 'bg-rose-100 dark:bg-rose-950/40',
  closed: 'bg-sky-100 dark:bg-sky-950/40',
  hole: 'bg-rose-50 dark:bg-rose-950/20',
  empty: '',
}

export default async function MoisPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const sp = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7)
  // Le même geste que la Semaine : Chantier × Jour par défaut, Équipe × Jour au
  // second plan. Un seul planning, deux axes de lecture.
  const view = parseViewMode(sp.view)

  const days = monthDays(month)
  const from = days[0].date
  const to = days[days.length - 1].date
  const rows = await buildMonthRows({ from, to })
  // Les mêmes faits, regroupés autrement — jamais un second moteur.
  const teamRows = view === 'team' ? await buildTeamMonthRows({ from, to, siteRows: rows }) : []

  // Le verdict : les faits de tous les chantiers, jour par jour. Il ne change
  // pas d'axe : le mois est bon ou non, quelle que soit la façon de le lire.
  const byDay: Record<string, DayFacts[]> = {}
  for (const d of days) byDay[d.date] = rows.map((r) => r.days[d.date])
  const v = monthVerdict(byDay)

  const presence = presenceByDay(byDay)
  const teamByDay: Record<string, TeamDayFacts[]> = {}
  for (const d of days) teamByDay[d.date] = teamRows.map((r) => r.days[d.date])
  const teamPresence = teamPresenceByDay(teamByDay)

  return (
    <div className="w-full max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
            <CalendarRange className="h-5 w-5 text-muted-foreground" /> Mois
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            La projection des roulements, du calendrier et des exceptions. Rien ne s&apos;édite
            ici — chaque clic ouvre le bon écran.
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
        {/* La barre : l'état du mois en un regard, avant même la grille. */}
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
              {v.closedDays} fermeture{v.closedDays > 1 ? 's' : ''} prévue
              {v.closedDays > 1 ? 's' : ''}
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

      {/* ── LA GRILLE — jours en colonnes, TOUJOURS. Ce qui change avec le
              mode, c'est ce qu'on met en lignes : les chantiers (primaire) ou
              les équipes (secondaire). Le même planning, deux axes. ───────── */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Rien à projeter ce mois-ci : aucune intervention, aucun roulement, aucune fermeture.
        </p>
      ) : view === 'team' && teamRows.length === 0 ? (
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
                      d.date === today && 'text-foreground',
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
              {view === 'team'
                ? teamRows.map((row) => (
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
                        {/* Qui compose l'équipe. Un libellé, jamais une ligne de
                            grille : personne n'a de total de jours travaillés. */}
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
                              d.date === today && 'outline outline-1 -outline-offset-1 outline-foreground/40',
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
                  ))
                : rows.map((row) => (
                    <tr key={row.siteId} className="border-t">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 min-w-[140px] max-w-[200px] border-r bg-card px-3 py-1.5 text-left"
                      >
                        <Link
                          href={`/sites/${row.siteId}`}
                          className="block truncate text-xs font-semibold hover:underline"
                        >
                          {row.siteName}
                        </Link>
                      </th>
                      {days.map((d) => {
                        const facts = row.days[d.date]
                        const state = dayState(facts)
                        const meta = CELL[state]
                        return (
                          <td
                            key={d.date}
                            className={cn(
                              'relative border-l border-border/40 p-0 text-center',
                              d.weekend && 'bg-muted/30',
                              CELL_BG[state],
                              d.date === today && 'outline outline-1 -outline-offset-1 outline-foreground/40',
                            )}
                          >
                            <Link
                              href={hrefOf(state, facts.hasException, row.siteId, d.date)}
                              title={[meta.title, facts.hasException ? 'Exception au roulement' : '']
                                .filter(Boolean)
                                .join(' · ')}
                              className={cn('block h-8 text-[11px] leading-8', meta.cls)}
                            >
                              {meta.glyph(peopleOn(facts))}
                              {/* L'exception : un point violet, jamais un texte. */}
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
                        {rowTotal(row.days)}
                      </td>
                    </tr>
                  ))}
            </tbody>
            {/* La ligne « Présents » — la couverture du jour. Un 0 se voit de
                loin : c'est elle que Guillaume cherche du regard. */}
            <tfoot>
              <tr className="border-t-2">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 text-left text-xs font-semibold"
                >
                  Présents
                </th>
                {days.map((d) => {
                  const n = view === 'team' ? teamPresence[d.date] : presence[d.date]
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
