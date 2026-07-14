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
import { buildMonthRows } from '@/lib/db/month-view'
import {
  dayState,
  dayTarget,
  monthVerdict,
  verdictPhrase,
  monthDays,
  isoWeekParamOf,
  type DayFacts,
  type DayState,
} from '@/lib/planning/month-view'
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

/** La cellule — UN état, lisible en une seconde. Le chiffre n'apparaît que
 *  s'il ajoute quelque chose (2 et plus). */
const CELL: Record<DayState, { glyph: (n: number) => string; cls: string; title: string }> = {
  ok: { glyph: (n) => (n > 1 ? `✓${n}` : '✓'), cls: 'text-emerald-700', title: 'Prévu' },
  projected: {
    glyph: (n) => (n > 1 ? `✓${n}` : '✓'),
    cls: 'italic text-muted-foreground/70',
    title: 'Projeté par le roulement (pas encore généré)',
  },
  conflict: { glyph: () => '!', cls: 'font-bold text-rose-700', title: 'Fermé ET du monde prévu' },
  closed: { glyph: () => '', cls: '', title: 'Chantier fermé' },
  hole: { glyph: () => '0', cls: 'font-bold text-rose-700/80', title: 'Jour ouvert, personne' },
  empty: { glyph: () => '', cls: '', title: '' },
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
  searchParams: Promise<{ m?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const sp = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7)

  const days = monthDays(month)
  const rows = await buildMonthRows({ from: days[0].date, to: days[days.length - 1].date })

  // Le verdict : les faits de tous les chantiers, jour par jour.
  const byDay: Record<string, DayFacts[]> = {}
  for (const d of days) byDay[d.date] = rows.map((r) => r.days[d.date])
  const v = monthVerdict(byDay)

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
        <nav className="inline-flex items-center gap-1">
          <Link
            href={`/mois?m=${shiftMonth(month, -1)}`}
            aria-label="Mois précédent"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="px-2 text-sm font-semibold capitalize">{monthLabel(month)}</span>
          <Link
            href={`/mois?m=${shiftMonth(month, 1)}`}
            aria-label="Mois suivant"
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </nav>
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

      {/* ── LA GRILLE — lignes = chantiers, une cellule = une seconde ────── */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Rien à projeter ce mois-ci : aucune intervention, aucun roulement, aucune fermeture.
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
                      'border-l border-border/50 pb-1 pt-1.5 text-center text-[10px] font-medium text-muted-foreground',
                      // Les week-ends se COMPRIMENT : ils prennent la largeur
                      // qu'ils méritent — presque rien — sans disparaître
                      // (Guillaume travaille certains samedis).
                      d.weekend ? 'min-w-[16px] bg-muted/40' : 'min-w-[28px]',
                      d.date === today && 'text-foreground',
                    )}
                  >
                    {!d.weekend && <span className="block leading-none">{'LMMJVSD'[d.weekday - 1]}</span>}
                    <span className={cn('tabular-nums', d.weekend && 'opacity-60')}>{d.num}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                    const n = facts.expected + facts.done + facts.kept || facts.projected
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
                          className={cn(
                            'block h-8 text-[11px] leading-8',
                            d.weekend && 'text-[10px]',
                            meta.cls,
                          )}
                        >
                          {meta.glyph(n)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><span className="font-medium text-emerald-700">✓</span> prévu</span>
        <span><span className="italic opacity-70">✓</span> projeté par le roulement</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-sky-100 align-[-2px] dark:bg-sky-950/40" />fermé</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-rose-100 align-[-2px] dark:bg-rose-950/40" /><span className="font-bold text-rose-700">!</span> conflit</span>
        <span><span className="font-bold text-rose-700/80">0</span> jour ouvert sans personne</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-600 align-[1px]" />exception</span>
      </p>
    </div>
  )
}
