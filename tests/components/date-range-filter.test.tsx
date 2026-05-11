// Slice B.0 — Tests composant DateRangeFilter.
//
// Tests :
//   1. Click sur raccourci « 7 derniers jours » → router.push avec dateFrom=today-6 et dateTo=today
//   2. Type dateFrom → router.push avec dateFrom updaté
//   3. Type dateTo vide → param dateTo supprimé
//   4. Click raccourci « Aujourd'hui » → dateFrom = dateTo = today
//   5. Toute action reset page

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const pushMock = vi.fn()
let currentParams: URLSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/preuves',
  useSearchParams: () => currentParams,
}))

import { DateRangeFilter } from '@/app/(dashboard)/preuves/DateRangeFilter'

beforeEach(() => {
  pushMock.mockReset()
  currentParams = new URLSearchParams()
})

function todayIsoUtc(): string {
  const t = new Date()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('DateRangeFilter — render', () => {
  it('affiche les deux inputs date + le sélecteur de raccourcis', () => {
    render(<DateRangeFilter />)
    expect(screen.getByTestId('date-range-from')).toBeInTheDocument()
    expect(screen.getByTestId('date-range-to')).toBeInTheDocument()
    expect(screen.getByTestId('date-range-shortcuts')).toBeInTheDocument()
  })

  it('initialise les valeurs depuis les searchParams URL', () => {
    currentParams = new URLSearchParams('dateFrom=2026-05-01&dateTo=2026-05-10')
    render(<DateRangeFilter />)
    const from = screen.getByTestId('date-range-from') as HTMLInputElement
    const to = screen.getByTestId('date-range-to') as HTMLInputElement
    expect(from.value).toBe('2026-05-01')
    expect(to.value).toBe('2026-05-10')
  })
})

describe('DateRangeFilter — raccourcis', () => {
  it('« 7 derniers jours » → push avec dateFrom=today-6 et dateTo=today', () => {
    render(<DateRangeFilter />)
    const select = screen.getByTestId('date-range-shortcuts') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '7d' } })

    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    const today = todayIsoUtc()
    const expectedFrom = addDaysIso(today, -6)
    expect(url).toContain(`dateFrom=${expectedFrom}`)
    expect(url).toContain(`dateTo=${today}`)
  })

  it('« Aujourd\'hui » → push avec dateFrom = dateTo = today', () => {
    render(<DateRangeFilter />)
    const select = screen.getByTestId('date-range-shortcuts') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'today' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    const today = todayIsoUtc()
    expect(url).toContain(`dateFrom=${today}`)
    expect(url).toContain(`dateTo=${today}`)
  })

  it('« 30 derniers jours » → fenêtre de 30 jours', () => {
    render(<DateRangeFilter />)
    const select = screen.getByTestId('date-range-shortcuts') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '30d' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    const today = todayIsoUtc()
    const expectedFrom = addDaysIso(today, -29)
    expect(url).toContain(`dateFrom=${expectedFrom}`)
    expect(url).toContain(`dateTo=${today}`)
  })

  it('toute action raccourci reset page', () => {
    currentParams = new URLSearchParams('page=3')
    render(<DateRangeFilter />)
    const select = screen.getByTestId('date-range-shortcuts') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'today' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('page=')
  })
})

describe('DateRangeFilter — inputs manuels', () => {
  it('changer dateFrom → push avec dateFrom updaté', () => {
    render(<DateRangeFilter />)
    const from = screen.getByTestId('date-range-from') as HTMLInputElement
    fireEvent.change(from, { target: { value: '2026-04-01' } })

    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).toContain('dateFrom=2026-04-01')
  })

  it('changer dateTo → push avec dateTo updaté', () => {
    render(<DateRangeFilter />)
    const to = screen.getByTestId('date-range-to') as HTMLInputElement
    fireEvent.change(to, { target: { value: '2026-04-30' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).toContain('dateTo=2026-04-30')
  })

  it('vider dateFrom → param dateFrom supprimé', () => {
    currentParams = new URLSearchParams('dateFrom=2026-04-01&dateTo=2026-04-30')
    render(<DateRangeFilter />)
    const from = screen.getByTestId('date-range-from') as HTMLInputElement
    fireEvent.change(from, { target: { value: '' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('dateFrom=')
    // dateTo doit toujours être présent
    expect(url).toContain('dateTo=2026-04-30')
  })

  it('changer une date reset également page', () => {
    currentParams = new URLSearchParams('page=2')
    render(<DateRangeFilter />)
    const from = screen.getByTestId('date-range-from') as HTMLInputElement
    fireEvent.change(from, { target: { value: '2026-04-01' } })

    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('page=')
  })
})
