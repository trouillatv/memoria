import Link from 'next/link'
import { CalendarOff } from 'lucide-react'
import { dayState, monthDays, peopleOn, type DayFacts, type DayState } from '@/lib/planning/month-view'
import type { MonthRow } from '@/lib/db/month-view'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']

function emptyFacts(): DayFacts {
  return { expected: 0, done: 0, kept: 0, projected: 0, closed: false, hasException: false, cycleCovers: false }
}

function factsFor(rows: MonthRow[], date: string): DayFacts {
  return rows.reduce((total, row) => {
    const facts = row.days[date] ?? emptyFacts()
    total.expected += facts.expected
    total.done += facts.done
    total.kept += facts.kept
    total.projected += facts.projected
    total.closed ||= facts.closed
    total.hasException ||= facts.hasException
    total.cycleCovers ||= facts.cycleCovers
    return total
  }, emptyFacts())
}

interface SiteEntry {
  name: string
  state: DayState
  count: number
}

function sitesOn(rows: MonthRow[], date: string): SiteEntry[] {
  return rows
    .map((r) => {
      const facts = r.days[date] ?? emptyFacts()
      return { name: r.siteName, state: dayState(facts), count: peopleOn(facts) }
    })
    .filter((e) => e.count > 0 || e.state === 'closed' || e.state === 'conflict' || e.state === 'hole')
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
}

const PAST_HATCH: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent, transparent 7px, rgba(100, 116, 139, 0.045) 7px, rgba(100, 116, 139, 0.045) 8px)',
}

function SiteMarker({ state }: { state: DayState }) {
  if (state === 'conflict') {
    return <CalendarOff className="h-3 w-3 shrink-0 text-rose-600 dark:text-rose-300" aria-hidden />
  }
  if (state === 'closed') {
    return <CalendarOff className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden />
  }
  const dot = state === 'hole' ? 'bg-rose-500' : 'bg-emerald-600'
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
}

const SITE_BADGE: Record<DayState, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
  projected: 'border-dashed border-border bg-background/60 text-muted-foreground dark:bg-background/30',
  conflict: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  closed: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  hole: 'border-rose-200 bg-rose-50/80 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  empty: 'border-border bg-background/60 text-muted-foreground',
}

function SiteBadge({ entry }: { entry: SiteEntry }) {
  return (
    <span
      className={cn(
        'flex w-full items-center gap-1 rounded-full border px-1.5 py-px text-[11px] leading-tight',
        SITE_BADGE[entry.state],
      )}
      title={entry.name}
    >
      <SiteMarker state={entry.state} />
      <span className="truncate">{entry.name}</span>
    </span>
  )
}

export function MonthCalendarGrid({
  rows,
  month,
  todayIso,
  focusDate,
  onSelectDate,
}: {
  rows: MonthRow[]
  month: string
  todayIso: string
  focusDate?: string
  onSelectDate?: (date: string) => void
}) {
  const days = monthDays(month)
  const leading = (days[0]?.weekday ?? 1) - 1
  const cells = [...Array.from({ length: leading }, () => null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-3 py-2.5 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-600" />chantier prévu
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarOff className="h-4 w-4 text-sky-600" aria-hidden />fermé
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarOff className="h-4 w-4 text-rose-600" aria-hidden />fermé + intervention prévue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-violet-600" />exception
        </span>
      </div>
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={cn(
              'px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
              i >= 5 && 'bg-slate-400/[0.12] text-foreground/70 dark:bg-slate-400/[0.10]',
            )}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-[28.5714%] bg-slate-400/[0.08] dark:bg-slate-400/[0.07]"
        />
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-24 border-b border-r bg-muted/[0.15]" />
          const facts = factsFor(rows, day.date)
          const state = dayState(facts)
          const entries = sitesOn(rows, day.date)
          const isToday = day.date === todayIso
          const isPast = day.date < todayIso && !isToday
          const isWeekend = day.weekend
          const isSelected = day.date === focusDate
          const href = `/mois?m=${month}&focus=${day.date}`

          const businessBg =
            state === 'closed'
              ? 'bg-sky-100 dark:bg-sky-950/45'
              : state === 'conflict'
                ? 'bg-rose-100 dark:bg-rose-950/45'
                : state === 'hole'
                  ? 'bg-rose-50 dark:bg-rose-950/25'
                  : null
          const timeBg = isToday ? 'bg-brand-50 dark:bg-brand-500/10' : ''
          const hatched = isPast && !isWeekend && !isToday
          const className = cn(
            'group/day relative flex min-h-24 flex-col gap-1 border-b border-r p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            'hover:bg-accent/40',
            businessBg ?? timeBg,
            isSelected && 'z-20 ring-[3px] ring-inset ring-brand-500',
          )
          const content = (
            <>
              <div className="flex items-start justify-between">
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums leading-none',
                    isToday
                      ? 'flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-white'
                      : isPast
                        ? 'text-muted-foreground'
                        : 'text-foreground',
                  )}
                >
                  {day.num}
                </span>
                {facts.hasException && (
                  <span aria-hidden className="mt-0.5 h-1.5 w-1.5 rounded-full bg-violet-600" title="Exception au roulement" />
                )}
              </div>
              {entries.length > 0 && (
                <div className={cn('mt-auto w-full space-y-0.5', isPast && 'opacity-80 saturate-[0.75]')}>
                  {entries.slice(0, 3).map((e) => (
                    <SiteBadge key={e.name} entry={e} />
                  ))}
                  {entries.length > 3 && (
                    <span className="block pl-1.5 text-[10px] text-muted-foreground">+{entries.length - 3} autre{entries.length - 3 > 1 ? 's' : ''}</span>
                  )}
                </div>
              )}
            </>
          )

          return onSelectDate ? (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDate(day.date)}
              style={hatched ? PAST_HATCH : undefined}
              className={className}
              aria-label={ariaFor(day.num, month, entries)}
            >
              {content}
            </button>
          ) : (
            <Link
              key={day.date}
              href={href}
              style={hatched ? PAST_HATCH : undefined}
              className={className}
              aria-label={ariaFor(day.num, month, entries)}
            >
              {content}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function ariaFor(num: number, month: string, entries: SiteEntry[]): string {
  if (entries.length === 0) return `${num} ${month} : rien de prévu`
  const names = entries.map((e) => e.name).join(', ')
  return `${num} ${month} : ${entries.length} chantier${entries.length > 1 ? 's' : ''} - ${names}`
}
