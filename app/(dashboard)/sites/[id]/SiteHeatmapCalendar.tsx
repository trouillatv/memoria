'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SiteRhythmDay } from '@/lib/db/site-cockpit'

const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const FR_MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin',
  'juil', 'août', 'sept', 'oct', 'nov', 'déc']

function intensityClass(count: number): string {
  if (count === 0) return 'bg-muted/40 border border-border/30'
  if (count === 1) return 'bg-foreground/20'
  if (count === 2) return 'bg-foreground/40'
  if (count === 3) return 'bg-foreground/60'
  return 'bg-foreground/85'
}

export function SiteHeatmapCalendar({ days }: { days: SiteRhythmDay[] }) {
  if (days.length === 0) return null

  const allEmpty = days.every((d) => d.count === 0)

  // Arrange days into week columns (Mon=row0 … Sun=row6)
  const firstDate = new Date(days[0].date + 'T00:00:00Z')
  const firstDow = (firstDate.getUTCDay() + 6) % 7  // 0=Mon … 6=Sun

  type Cell = SiteRhythmDay | null
  const cells: Cell[] = [
    ...Array<null>(firstDow).fill(null),
    ...days,
  ]

  const weeks: Cell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  const last = weeks[weeks.length - 1]
  if (last && last.length < 7) {
    while (last.length < 7) last.push(null)
  }

  // Month label per week column (first occurrence only)
  const seenMonths = new Set<string>()
  const monthLabels: Array<string | null> = weeks.map((week) => {
    const firstReal = week.find((c) => c !== null)
    if (!firstReal) return null
    const month = Number(firstReal.date.split('-')[1]) - 1
    const label = FR_MONTHS[month] ?? null
    if (!label || seenMonths.has(label)) return null
    seenMonths.add(label)
    return label
  })

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {allEmpty && (
          <p className="text-sm text-muted-foreground italic">
            Pas d&apos;activité ces 90 derniers jours.
          </p>
        )}

        <div className="overflow-x-auto">
          <div className="inline-flex gap-0.5">
            {/* Row labels */}
            <div className="flex flex-col gap-0.5 mr-1 mt-5">
              {WEEKDAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="h-3 w-3 flex items-center justify-center text-[9px] text-muted-foreground leading-none"
                >
                  {i % 2 === 0 ? label : ''}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-0.5">
                <div className="h-4 flex items-end pb-0.5">
                  {monthLabels[wi] && (
                    <span className="text-[9px] text-muted-foreground leading-none whitespace-nowrap">
                      {monthLabels[wi]}
                    </span>
                  )}
                </div>
                {week.map((cell, di) => {
                  if (!cell) {
                    return <div key={di} className="h-3 w-3 rounded-[2px] bg-transparent" />
                  }

                  const dayCell = (
                    <div
                      className={`h-3 w-3 rounded-[2px] transition-opacity ${intensityClass(cell.count)} ${
                        cell.isToday ? 'ring-1 ring-foreground/60 ring-offset-[1px]' : ''
                      }`}
                    />
                  )

                  if (cell.count === 0 && !cell.isToday) return <div key={di}>{dayCell}</div>

                  return (
                    <Tooltip key={di}>
                      <TooltipTrigger>{dayCell}</TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px]">
                        <div className="space-y-0.5 text-xs">
                          <p className="font-medium">
                            {cell.weekdayLabel} {cell.dayMonthLabel}
                            {cell.isToday ? ' · aujourd’hui' : ''}
                          </p>
                          {cell.count > 0 ? (
                            <>
                              {cell.tooltipLines.slice(0, 4).map((line, i) => (
                                <p key={i} className="text-muted-foreground">{line}</p>
                              ))}
                              {cell.count > cell.tooltipLines.length && (
                                <p className="text-muted-foreground/70 italic">
                                  + {cell.count - cell.tooltipLines.length} autres
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-muted-foreground">Aucune activité</p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
