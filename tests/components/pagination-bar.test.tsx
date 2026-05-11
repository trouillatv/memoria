// Slice A.6 — Tests composant PaginationBar.
//
// Tests :
//   1. total <= pageSize → return null (rien rendu).
//   2. Page 1/3 → bouton Précédent disabled, Suivant enabled.
//   3. Page 3/3 → Précédent enabled, Suivant disabled.
//   4. Click Suivant → router.push avec page=N+1.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const pushMock = vi.fn()
let currentParams: URLSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/tenders',
  useSearchParams: () => currentParams,
}))

import { PaginationBar } from '@/components/ui/pagination-bar'

beforeEach(() => {
  pushMock.mockReset()
  currentParams = new URLSearchParams()
})

describe('PaginationBar — no-op cases', () => {
  it('rend null si total <= pageSize (une seule page)', () => {
    const { container } = render(<PaginationBar page={1} pageSize={50} total={30} />)
    // Pas de slot rendu
    expect(container.querySelector('[data-slot="pagination-bar"]')).toBeNull()
  })

  it('rend null si total === 0', () => {
    const { container } = render(<PaginationBar page={1} pageSize={50} total={0} />)
    expect(container.querySelector('[data-slot="pagination-bar"]')).toBeNull()
  })
})

describe('PaginationBar — boutons', () => {
  it('Page 1/3 : Précédent disabled, Suivant enabled', () => {
    render(<PaginationBar page={1} pageSize={50} total={150} />)
    const prev = screen.getByTestId('pagination-prev') as HTMLButtonElement
    const next = screen.getByTestId('pagination-next') as HTMLButtonElement
    expect(prev).toBeDisabled()
    expect(next).not.toBeDisabled()
  })

  it('Page 3/3 : Précédent enabled, Suivant disabled', () => {
    render(<PaginationBar page={3} pageSize={50} total={150} />)
    const prev = screen.getByTestId('pagination-prev') as HTMLButtonElement
    const next = screen.getByTestId('pagination-next') as HTMLButtonElement
    expect(prev).not.toBeDisabled()
    expect(next).toBeDisabled()
  })

  it('Indicateur « Page X sur Y » correct', () => {
    render(<PaginationBar page={2} pageSize={50} total={150} />)
    const indicator = screen.getByTestId('pagination-indicator')
    expect(indicator.textContent).toContain('Page 2 sur 3')
    expect(indicator.textContent).toContain('150')
  })
})

describe('PaginationBar — navigation', () => {
  it('click Suivant → router.push avec page=N+1', () => {
    render(<PaginationBar page={1} pageSize={50} total={150} />)
    const next = screen.getByTestId('pagination-next')
    fireEvent.click(next)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]?.[0]).toContain('page=2')
  })

  it('click Précédent depuis page=2 → push sans param page (retour page 1)', () => {
    render(<PaginationBar page={2} pageSize={50} total={150} />)
    const prev = screen.getByTestId('pagination-prev')
    fireEvent.click(prev)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const url = pushMock.mock.calls[0]?.[0] as string
    expect(url).not.toContain('page=')
  })

  it('clamp à totalPages — click Suivant en dernière page reste désactivé', () => {
    render(<PaginationBar page={3} pageSize={50} total={150} />)
    const next = screen.getByTestId('pagination-next') as HTMLButtonElement
    expect(next).toBeDisabled()
    fireEvent.click(next)
    // Disabled button → click ne devrait pas appeler push
    expect(pushMock).not.toHaveBeenCalled()
  })
})
