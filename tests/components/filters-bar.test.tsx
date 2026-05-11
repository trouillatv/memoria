// Slice A.6 — Tests composant FiltersBar.
//
// Tests :
//   1. Render avec searchPlaceholder → input visible.
//   2. Type dans search → debounce 300ms puis router.push appelé.
//   3. hasActiveFilters=true → bouton « Réinitialiser » visible.
//   4. Click Reset → router.push avec params effacés.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/tenders',
  useSearchParams: () => new URLSearchParams(),
}))

import { FiltersBar } from '@/components/ui/filters-bar'

beforeEach(() => {
  pushMock.mockReset()
  vi.useRealTimers()
})

describe('FiltersBar — rendu de base', () => {
  it('affiche l\'input search avec le placeholder fourni', () => {
    render(<FiltersBar searchPlaceholder="Rechercher un AO…" />)
    const input = screen.getByTestId('filters-bar-search')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Rechercher un AO…')
  })

  it('cache l\'input search si hideSearch=true', () => {
    render(<FiltersBar hideSearch />)
    expect(screen.queryByTestId('filters-bar-search')).not.toBeInTheDocument()
  })
})

describe('FiltersBar — debounce', () => {
  it('debounce 300ms puis push searchParam', async () => {
    vi.useFakeTimers()
    render(<FiltersBar searchPlaceholder="Rechercher…" debounceMs={300} />)
    const input = screen.getByTestId('filters-bar-search')

    fireEvent.change(input, { target: { value: 'foo' } })

    // Avant debounce → pas encore appelé
    expect(pushMock).not.toHaveBeenCalled()

    // Après 300ms → push appelé
    await act(async () => {
      vi.advanceTimersByTime(310)
    })

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]?.[0]).toContain('search=foo')
    vi.useRealTimers()
  })

  it('ne push qu\'une seule fois après plusieurs frappes successives (debounce)', async () => {
    vi.useFakeTimers()
    render(<FiltersBar searchPlaceholder="Rechercher…" debounceMs={300} />)
    const input = screen.getByTestId('filters-bar-search')

    fireEvent.change(input, { target: { value: 'f' } })
    fireEvent.change(input, { target: { value: 'fo' } })
    fireEvent.change(input, { target: { value: 'foo' } })

    await act(async () => {
      vi.advanceTimersByTime(310)
    })

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]?.[0]).toContain('search=foo')
    vi.useRealTimers()
  })
})

describe('FiltersBar — Reset', () => {
  it('affiche le bouton « Réinitialiser » si hasActiveFilters=true', () => {
    render(<FiltersBar hasActiveFilters />)
    expect(screen.getByTestId('filters-bar-reset')).toBeInTheDocument()
  })

  it('cache le bouton « Réinitialiser » si hasActiveFilters=false', () => {
    render(<FiltersBar hasActiveFilters={false} />)
    expect(screen.queryByTestId('filters-bar-reset')).not.toBeInTheDocument()
  })

  it('click Reset → router.push appelé (sans les params à reset)', async () => {
    render(<FiltersBar hasActiveFilters resetParams={['status', 'search']} />)
    const btn = screen.getByTestId('filters-bar-reset')

    await act(async () => {
      fireEvent.click(btn)
    })

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalled()
    })
    // URL pushed should not contain status= or search=
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('status=')
    expect(url).not.toContain('search=')
  })
})
