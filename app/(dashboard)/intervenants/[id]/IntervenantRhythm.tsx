'use client'

// Rythme récent de l'intervenant — 14 derniers jours.
// Calé visuellement sur SiteRhythm (page /sites/[id]) pour cohérence.
// Doctrine : sujet = personne mais factuel uniquement (count brut), pas de
// score, pas de comparaison entre jours/semaines.

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { IntervenantRhythmDay } from '@/lib/db/intervenants'

export function IntervenantRhythm({ days }: { days: IntervenantRhythmDay[] }) {
  if (days.length === 0) return null

  const allEmpty = days.every((d) => d.count === 0)
  if (allEmpty) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas d&apos;intervention ces 14 derniers jours.
      </p>
    )
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1 min-w-0">
          {days.map((d) => {
            const hasTrace = d.count > 0
            const dimmed = d.isWeekend && !hasTrace && !d.isToday
            const hasTooltip = d.tooltipLines.length > 0

            const dot = (
              <div
                className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                  hasTrace ? 'bg-foreground' : 'border border-border'
                } ${hasTooltip ? 'cursor-default' : ''}`}
              />
            )

            return (
              <div
                key={d.date}
                className={`flex flex-col items-center gap-1 flex-1 min-w-[2.5rem] rounded-md px-0.5 py-2 ${
                  d.isToday ? 'bg-foreground/5 ring-1 ring-foreground/20' : ''
                } ${dimmed ? 'opacity-40' : ''}`}
              >
                <span
                  className={`text-[10px] uppercase tracking-wide leading-none ${
                    d.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {d.weekdayLabel.replace('.', '')}
                </span>

                <span
                  className={`text-xs tabular-nums leading-none ${
                    d.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {d.dayMonthLabel}
                </span>

                {hasTooltip ? (
                  <Tooltip>
                    <TooltipTrigger>{dot}</TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="space-y-0.5 text-xs">
                        {d.tooltipLines.map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                        {d.count > d.tooltipLines.length && (
                          <p className="text-muted-foreground/80 italic">
                            + {d.count - d.tooltipLines.length} autres
                          </p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  dot
                )}
              </div>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
