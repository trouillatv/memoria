'use client'

// Slice E.1 — Navigation entre mois sur la page rapport mensuel.
//
// Trois actions :
//   - Précédent : change ?month vers mois m-1
//   - Mois dernier : revient au mois précédent (mois fini) courant
//   - Suivant : change ?month vers mois m+1, bloqué au-delà du mois précédent
//
// Doctrine : pas de date picker custom (cap démo). Boutons + lecture du label.

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MonthNavigationProps {
  contractId: string
  currentMonth: string // YYYY-MM
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function parseYM(ym: string): { y: number; m: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!match) return null
  const y = parseInt(match[1]!, 10)
  const m = parseInt(match[2]!, 10)
  if (m < 1 || m > 12) return null
  return { y, m }
}

function formatYM(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`
}

function offsetMonth(ym: string, delta: number): string {
  const parsed = parseYM(ym)
  if (!parsed) return ym
  let y = parsed.y
  let m = parsed.m + delta
  while (m < 1) {
    m += 12
    y -= 1
  }
  while (m > 12) {
    m -= 12
    y += 1
  }
  return formatYM(y, m)
}

function todayMonthParam(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth() // 0..11 = mois précédent en 1-indexé
  if (m === 0) return `${y - 1}-12`
  return formatYM(y, m)
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function labelOf(ym: string): string {
  const parsed = parseYM(ym)
  if (!parsed) return ym
  const monthName = MONTHS_FR[parsed.m - 1] ?? ''
  return `${capitalize(monthName)} ${parsed.y}`
}

export function MonthNavigation({ contractId, currentMonth }: MonthNavigationProps) {
  const router = useRouter()
  const today = todayMonthParam()

  function go(ym: string) {
    router.push(`/contracts/${contractId}/rapport-mensuel?month=${ym}`)
  }

  const prev = offsetMonth(currentMonth, -1)
  const next = offsetMonth(currentMonth, 1)
  // On bloque la navigation vers un mois > mois précédent : un rapport sur un
  // mois en cours n'a pas de sens métier.
  const nextDisabled = next > today
  const isToday = currentMonth === today

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="outline" size="sm" onClick={() => go(prev)} aria-label="Mois précédent">
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{labelOf(prev)}</span>
        <span className="sm:hidden">Précédent</span>
      </Button>

      <div className="px-3 py-1 rounded-md border border-border bg-muted/30 text-sm font-medium tabular-nums">
        {labelOf(currentMonth)}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => go(next)}
        disabled={nextDisabled}
        aria-label="Mois suivant"
      >
        <span className="hidden sm:inline">{labelOf(next)}</span>
        <span className="sm:hidden">Suivant</span>
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!isToday && (
        <Button variant="ghost" size="sm" onClick={() => go(today)}>
          Mois dernier
        </Button>
      )}
    </div>
  )
}
