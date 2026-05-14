import type { SiteRhythmDay } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Rythme du lieu : 14 jours en lecture verticale, lecture BINAIRE.
 *
 * Doctrine Vincent 2026-05-15 (après recadrage Claude) :
 *   "Tu montres l'EXISTENCE, pas l'intensité.
 *    Une densité de puces ●●●●● devient un contribution graph GitHub
 *    en monospace — l'œil compare les jours, le cerveau évalue.
 *    Reste sur trace / pas de trace."
 *
 * Donc : un jour a une trace OU n'en a pas. Pas de comptage visuel.
 * Aujourd'hui mis en avant typo (font-medium).
 * Week-end en muted-foreground.
 *
 * PIÈGES À ÉVITER :
 *   ❌ histogramme ascii avec hauteur variable → bar chart déguisé
 *   ❌ ●●●●● variable → contribution graph en monospace
 *   ❌ couleurs sémantiques (rouge si peu, vert si beaucoup) → évaluation
 *   ❌ moyenne / médiane / "rythme habituel" → interprétation interdite
 */

function markFor(count: number): string {
  // Binaire : il s'est passé quelque chose ce jour, ou non.
  return count > 0 ? '●' : '—'
}

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
    <ol className="font-mono text-sm tabular-nums space-y-0.5">
      {days.map((d) => {
        const isWeekendEmpty = d.isWeekend && d.count === 0
        const isToday = d.isToday
        return (
          <li
            key={d.date}
            className={`flex items-baseline gap-3 ${
              isToday ? 'font-medium' : ''
            } ${isWeekendEmpty && !isToday ? 'text-muted-foreground' : ''}`}
          >
            <span className="w-10 shrink-0">{d.weekdayLabel}</span>
            <span className="w-5 shrink-0 text-right">{d.dayMonthLabel}</span>
            <span className={d.count > 0 ? 'text-foreground' : 'text-muted-foreground/40'}>
              {markFor(d.count)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
