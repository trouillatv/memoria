'use client'

// SiteHeatmapCalendar — heatmap GitHub-like pour la densité d'activité d'un site.
// Identique à HeatmapCalendar de la page intervenant, adapté pour SiteRhythmDay.
// Chaque carré = un jour. 1 colonne = 1 semaine (lun→dim).
// La couleur intensité = nombre de traces du jour.

import type { SiteRhythmDay } from '@/lib/db/site-cockpit'

const MONTHS_FR_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_FR_LONG[m - 1] ?? ''} ${y}`
}

function intensityClass(count: number): string {
  if (count === 0) return 'bg-muted/40'
  if (count === 1) return 'bg-brand-200'
  if (count === 2) return 'bg-brand-400'
  return 'bg-brand-600'
}

interface Props {
  days: SiteRhythmDay[]
}

export function SiteHeatmapCalendar({ days }: Props) {
  if (days.length === 0) return null

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayIso = today.toISOString().slice(0, 10)

  const countByDate = new Map(days.map((d) => [d.date, d.count]))

  // Construire les colonnes semaine (GitHub-like) : padding de début pour
  // aligner chaque colonne sur lundi (UJour=1).
  const weeks: string[][] = []
  let currentWeek: string[] = []

  for (const day of days) {
    const dow = new Date(day.date + 'T00:00:00Z').getUTCDay() // 0=dim, 1=lun
    if (currentWeek.length === 0 && dow !== 1) {
      // Padding : combien de slots vides avant le premier jour ?
      const padLen = dow === 0 ? 6 : dow - 1
      for (let i = 0; i < padLen; i++) currentWeek.push('')
    }
    currentWeek.push(day.date)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push('')
    weeks.push(currentWeek)
  }

  const weekdayLabels = ['L', '', 'M', '', 'V', '', 'D']

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1">
        {/* Labels des jours de la semaine (colonne gauche) */}
        <div className="flex flex-col gap-1 pt-0.5 mr-1">
          {weekdayLabels.map((label, i) => (
            <div
              key={i}
              className="h-3 text-[9px] text-muted-foreground text-right pr-0.5 leading-3 w-3"
            >
              {label}
            </div>
          ))}
        </div>
        {/* Grille des semaines */}
        <div
          className="flex gap-1 overflow-x-auto"
          aria-label={`Activité sur ${days.length} jours`}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((date, di) => {
                if (!date) return <div key={di} className="w-3 h-3" aria-hidden />
                const count = countByDate.get(date) ?? 0
                const isToday = date === todayIso
                return (
                  <div
                    key={date}
                    className={`w-3 h-3 rounded-[2px] ${intensityClass(count)} ${
                      isToday ? 'ring-1 ring-foreground/40' : ''
                    }`}
                    title={`${formatDateFr(date)} : ${count} trace${count > 1 ? 's' : ''}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Légende */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>Moins</span>
        <div className="w-2.5 h-2.5 rounded-[2px] bg-muted/40" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-200" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-400" />
        <div className="w-2.5 h-2.5 rounded-[2px] bg-brand-600" />
        <span>Plus</span>
      </div>
    </div>
  )
}
