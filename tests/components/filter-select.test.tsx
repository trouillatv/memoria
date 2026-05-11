// Slice A.6 — Tests composant FilterSelect.
//
// Tests :
//   1. Render avec options → toutes les <option> rendues (+ emptyLabel).
//   2. value initial sync depuis searchParams.
//   3. Change sélection → router.push avec param updaté.
//   4. Sélectionner empty value → param supprimé.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const pushMock = vi.fn()
let currentParams: URLSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/tenders',
  useSearchParams: () => currentParams,
}))

import { FilterSelect } from '@/components/ui/filter-select'

beforeEach(() => {
  pushMock.mockReset()
  currentParams = new URLSearchParams()
})

const OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'ready', label: 'Prêt' },
  { value: 'archived', label: 'Archivé' },
]

describe('FilterSelect — render', () => {
  it('rend toutes les options + l\'option vide avec emptyLabel', () => {
    render(
      <FilterSelect
        paramName="status"
        label="Statut"
        emptyLabel="Tous les statuts"
        options={OPTIONS}
      />,
    )
    // Empty option
    expect(screen.getByRole('option', { name: 'Tous les statuts' })).toBeInTheDocument()
    // Each option
    expect(screen.getByRole('option', { name: 'Brouillon' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Prêt' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Archivé' })).toBeInTheDocument()
  })
})

describe('FilterSelect — sync from URL', () => {
  it('initialise la valeur depuis le searchParam URL', () => {
    currentParams = new URLSearchParams('status=ready')
    render(
      <FilterSelect
        paramName="status"
        label="Statut"
        options={OPTIONS}
      />,
    )
    const select = screen.getByTestId('filter-select-status') as HTMLSelectElement
    expect(select.value).toBe('ready')
  })
})

describe('FilterSelect — change handler', () => {
  it('changer la sélection appelle router.push avec le param updaté', () => {
    render(
      <FilterSelect
        paramName="status"
        label="Statut"
        options={OPTIONS}
      />,
    )
    const select = screen.getByTestId('filter-select-status') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ready' } })
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]?.[0]).toContain('status=ready')
  })

  it('sélectionner l\'option vide supprime le searchParam', () => {
    currentParams = new URLSearchParams('status=ready')
    render(
      <FilterSelect
        paramName="status"
        label="Statut"
        options={OPTIONS}
      />,
    )
    const select = screen.getByTestId('filter-select-status') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '' } })
    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('status=')
  })

  it('change → reset également le param page', () => {
    currentParams = new URLSearchParams('page=3&status=draft')
    render(
      <FilterSelect
        paramName="status"
        label="Statut"
        options={OPTIONS}
      />,
    )
    const select = screen.getByTestId('filter-select-status') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ready' } })
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('page=')
    expect(url).toContain('status=ready')
  })
})
