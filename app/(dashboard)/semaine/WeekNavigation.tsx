'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.3)
//
// Boutons de navigation semaine : ◀ Précédente · Aujourd'hui · Suivante ▶
//
// State piloté par l'URL `?week=YYYY-Www` (ISO 8601). En cliquant, on remplace
// le query param et on laisse Next.js re-render le server component parent.

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
// Import depuis helpers PURS (pas '@/lib/db/week-planning') pour que ce client
// component ne fasse pas remonter `admin` (server-only) dans le bundle client
// au build Turbopack.
import { formatWeekParam, getWeekRange, parseWeekParam, type WeekRange } from '@/lib/week-planning-helpers'

export interface WeekNavigationProps {
  /** Semaine actuellement affichée (résolue côté serveur). */
  range: WeekRange
}

function shiftWeek(range: WeekRange, deltaDays: number): WeekRange {
  // weekStart est un yyyy-mm-dd → décale en UTC pour rester ISO-safe
  const start = new Date(range.weekStart + 'T00:00:00Z')
  start.setUTCDate(start.getUTCDate() + deltaDays)
  return getWeekRange(start)
}

export function WeekNavigation({ range }: WeekNavigationProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function navigateToWeek(target: WeekRange) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('week', formatWeekParam(target))
    router.push(`/semaine?${params.toString()}`)
  }

  function handlePrev() {
    navigateToWeek(shiftWeek(range, -7))
  }
  function handleNext() {
    navigateToWeek(shiftWeek(range, 7))
  }
  function handleToday() {
    navigateToWeek(parseWeekParam(undefined))
  }

  return (
    <div
      className="flex items-center gap-1"
      role="navigation"
      aria-label="Navigation semaine"
      data-slot="week-navigation"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={handlePrev}
        aria-label="Semaine précédente"
        data-testid="week-nav-prev"
      >
        <ChevronLeft />
        Précédente
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToday}
        aria-label="Revenir à la semaine en cours"
        data-testid="week-nav-today"
      >
        <CalendarDays />
        Aujourd&rsquo;hui
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleNext}
        aria-label="Semaine suivante"
        data-testid="week-nav-next"
      >
        Suivante
        <ChevronRight />
      </Button>
    </div>
  )
}
