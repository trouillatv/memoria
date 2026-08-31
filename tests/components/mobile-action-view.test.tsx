// Convergence Actions mobile — GO Vincent (audit navigation/gestion terrain,
// 2026-08-31). La fiche mobile (/m/site/[siteId]/action/[actionId]) était en
// lecture seule (Slice 8 jamais portée côté mobile) : ces tests prouvent
// qu'elle devient manipulable avec les MÊMES primitives que la fiche desktop
// (ActionFicheCta) — closeActionAction, reopenActionAction,
// updateActionDetailsAction, setActionDueDateAction — sans nouvelle primitive.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MobileActionView } from '@/app/(field)/m/site/[siteId]/action/[actionId]/MobileActionView'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

type Ok = (...a: unknown[]) => Promise<{ ok: true }>
const mockClose = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockReopen = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockUpdateDetails = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockSetDueDate = vi.fn<Ok>(() => Promise.resolve({ ok: true }))

vi.mock('@/app/(dashboard)/actions/actions', () => ({
  closeActionAction: (...a: unknown[]) => mockClose(...a),
  reopenActionAction: (...a: unknown[]) => mockReopen(...a),
  updateActionDetailsAction: (...a: unknown[]) => mockUpdateDetails(...a),
  setActionDueDateAction: (...a: unknown[]) => mockSetDueDate(...a),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function makeAction(overrides: Partial<ActionFicheData> = {}): ActionFicheData {
  return {
    id: 'a1',
    siteId: 'site-1',
    title: 'Transmettre le rapport G3',
    body: null,
    corpsEtat: null,
    status: 'open',
    statusLabel: 'Ouverte',
    responsible: null,
    dueDate: null,
    dueDateStatus: null,
    isLate: false,
    source: null,
    context: null,
    fromDecision: null,
    createdAt: '2026-08-20T08:00:00.000Z',
    doneAt: null,
    historyDays: [],
    historyNote: null,
    proofs: null,
    progress: [],
    siteName: 'Chantier A',
    relations: [],
    observed: null,
    createdByLabel: null,
    closedByLabel: null,
    ...overrides,
  }
}

describe('MobileActionView — gestes (fiche non lecture seule)', () => {
  it('Clôturer appelle closeActionAction avec un commentaire', async () => {
    render(<MobileActionView action={makeAction()} siteId="site-1" />)
    fireEvent.click(screen.getByRole('button', { name: /Clôturer/ }))
    fireEvent.change(screen.getByPlaceholderText(/joints repris/), { target: { value: 'Terminé, vérifié sur place.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
    })
    expect(mockClose).toHaveBeenCalledTimes(1)
    const fd = mockClose.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('a1')
    expect(fd.get('site_id')).toBe('site-1')
    expect(fd.get('comment')).toBe('Terminé, vérifié sur place.')
  })

  it('Rouvrir cette action appelle reopenActionAction quand l’action est terminée', async () => {
    render(<MobileActionView action={makeAction({ status: 'done', statusLabel: 'Terminée' })} siteId="site-1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Rouvrir cette action/ }))
    })
    expect(mockReopen).toHaveBeenCalledTimes(1)
    const fd = mockReopen.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('a1')
    expect(fd.get('site_id')).toBe('site-1')
  })

  it('une action annulée n’affiche aucun geste', () => {
    render(<MobileActionView action={makeAction({ status: 'cancelled', statusLabel: 'Annulée' })} siteId="site-1" />)
    expect(screen.queryByRole('button', { name: /Clôturer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rouvrir/ })).not.toBeInTheDocument()
  })

  it('Modifier (menu •••) appelle updateActionDetailsAction', async () => {
    render(<MobileActionView action={makeAction()} siteId="site-1" />)
    fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier' }))
    const titleInput = screen.getByPlaceholderText('Titre') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Transmettre le rapport G3 (corrigé)' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    })
    expect(mockUpdateDetails).toHaveBeenCalledTimes(1)
    const fd = mockUpdateDetails.mock.calls[0][0] as FormData
    expect(fd.get('title')).toBe('Transmettre le rapport G3 (corrigé)')
  })

  it('Replanifier (menu •••) appelle setActionDueDateAction, disponible seulement si vivante', async () => {
    render(<MobileActionView action={makeAction({ dueDate: '2026-09-01', dueDateStatus: 'explicit' })} siteId="site-1" />)
    fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Replanifier' }))
    const dateInput = screen.getByDisplayValue('2026-09-01') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    })
    expect(mockSetDueDate).toHaveBeenCalledTimes(1)
    const fd = mockSetDueDate.mock.calls[0][0] as FormData
    expect(fd.get('due_date')).toBe('2026-09-15')
  })

  it('une action terminée ne propose que Rouvrir, aucun menu ni replanification', () => {
    render(<MobileActionView action={makeAction({ status: 'done', statusLabel: 'Terminée', dueDate: '2026-09-01' })} siteId="site-1" />)
    expect(screen.getByRole('button', { name: /Rouvrir cette action/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Plus d'actions" })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Replanifier/ })).not.toBeInTheDocument()
  })

  it('la flèche de retour suit backHref quand il est fourni (retour à la liste filtrée)', () => {
    render(<MobileActionView action={makeAction()} siteId="site-1" backHref="/m/actions?site=site-1" />)
    const back = screen.getByRole('link', { name: /Chantier A/ })
    expect(back).toHaveAttribute('href', '/m/actions?site=site-1')
  })

  it('sans backHref, la flèche conserve le retour chantier historique', () => {
    render(<MobileActionView action={makeAction()} siteId="site-1" />)
    const back = screen.getByRole('link', { name: /Chantier A/ })
    expect(back).toHaveAttribute('href', '/m/site/site-1')
  })
})
