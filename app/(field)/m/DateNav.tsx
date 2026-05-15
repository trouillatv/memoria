'use client'

// Strip de navigation de date : 7 jours centrés sur "aujourd'hui" (J-3 → J+3).
// Chaque case = bouton cliquable qui navigue vers `?date=YYYY-MM-DD`.
// Doctrine mobile : tap-friendly, sobre, calé en haut sous le header.

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const FR_DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const FR_MONTHS = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function dateUtcOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function addDaysIso(iso: string, days: number): string {
  const d = dateUtcOf(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface Props {
  todayIso: string                  // aujourd'hui (zone Nouméa) — depuis le serveur
  selectedIso: string               // date sélectionnée (= todayIso par défaut)
}

export function DateNav({ todayIso, selectedIso }: Props) {
  const params = useSearchParams()

  // Construire la liste J-3 → J+3
  const days = [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
    const iso = addDaysIso(todayIso, offset)
    const d = dateUtcOf(iso)
    return {
      iso,
      isToday: offset === 0,
      isSelected: iso === selectedIso,
      weekday: FR_DAYS[d.getUTCDay()],
      day: d.getUTCDate(),
      month: FR_MONTHS[d.getUTCMonth()],
    }
  })

  function hrefFor(iso: string): string {
    const p = new URLSearchParams(params?.toString() ?? '')
    if (iso === todayIso) p.delete('date')
    else p.set('date', iso)
    const q = p.toString()
    return q ? `/m?${q}` : '/m'
  }

  return (
    <nav
      aria-label="Navigation par date"
      className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 snap-x"
    >
      {days.map((d) => {
        const baseCls = 'shrink-0 snap-start flex flex-col items-center justify-center rounded-xl px-2.5 py-2 min-w-[3rem] border transition-colors active:scale-95'
        const cls = d.isSelected
          ? 'bg-foreground text-background border-foreground'
          : d.isToday
            ? 'bg-card border-foreground/30 text-foreground'
            : 'bg-card border-border text-muted-foreground hover:bg-muted/40'
        return (
          <Link key={d.iso} href={hrefFor(d.iso)} className={`${baseCls} ${cls}`}>
            <span className="text-[10px] uppercase tracking-wide leading-none">{d.weekday}</span>
            <span className="text-sm font-semibold tabular-nums mt-0.5 leading-none">{d.day}</span>
            <span className="text-[9px] text-muted-foreground/80 leading-none mt-0.5">
              {d.isSelected ? '' : d.month}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
