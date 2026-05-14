import type { SiteRhythmDay } from '@/lib/db/site-cockpit'

/**
 * Rythme du lieu — 14 jours en bande horizontale.
 *
 * Doctrine : binaire (trace / pas de trace). Un jour avec trace affiche
 * un indicateur plein, sans trace un indicateur vide. Pas d'intensité,
 * pas de comptage visuel — on montre l'EXISTENCE, pas la quantité.
 *
 * Aujourd'hui : colonne mise en avant (ring + fond léger).
 * Week-end sans trace : muted.
 */
export function SiteRhythm({ days }: { days: SiteRhythmDay[] }) {
  if (days.length === 0) return null

  const allEmpty = days.every((d) => d.count === 0)
  if (allEmpty) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas de trace ces 14 derniers jours.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-1 min-w-0">
        {days.map((d) => {
          const hasTrace = d.count > 0
          const dimmed = d.isWeekend && !hasTrace && !d.isToday

          return (
            <div
              key={d.date}
              className={`flex flex-col items-center gap-1 flex-1 min-w-[2.5rem] rounded-md px-0.5 py-2 ${
                d.isToday
                  ? 'bg-foreground/5 ring-1 ring-foreground/20'
                  : ''
              } ${dimmed ? 'opacity-40' : ''}`}
            >
              {/* Jour de la semaine — 3 lettres sans point */}
              <span
                className={`text-[10px] uppercase tracking-wide leading-none ${
                  d.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {d.weekdayLabel.replace('.', '')}
              </span>

              {/* Numéro du mois */}
              <span
                className={`text-xs tabular-nums leading-none ${
                  d.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'
                }`}
              >
                {d.dayMonthLabel}
              </span>

              {/* Indicateur trace */}
              <div
                className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                  hasTrace
                    ? 'bg-foreground'
                    : 'border border-border'
                }`}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
