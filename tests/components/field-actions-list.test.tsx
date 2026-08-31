// Convergence Actions mobile — GO Vincent (audit navigation/gestion terrain,
// 2026-08-31). FieldActionsList (/m/actions) gagne un accès direct « Clôturer »
// et un menu « ••• » (Modifier / Replanifier / Voir la fiche) sans nouvelle
// primitive métier : ces tests prouvent que les gestes appellent exactement
// les Server Actions existantes (closeActionAction, updateActionDetailsAction,
// setActionDueDateAction), pas une réimplémentation, et que la priorité
// (retard/sans date) reste correcte.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { FieldActionsList } from '@/components/actions/FieldActionsList'
import type { SiteActionRow } from '@/lib/db/site-actions'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

type Ok = (...a: unknown[]) => Promise<{ ok: true }>
type OkPlan = (...a: unknown[]) => Promise<{ ok: true; interventionId: string }>
const mockClose = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockMarkProgress = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockSnooze = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockPlan = vi.fn<OkPlan>(() => Promise.resolve({ ok: true, interventionId: 'iv-1' }))
const mockUpdateDetails = vi.fn<Ok>(() => Promise.resolve({ ok: true }))
const mockSetDueDate = vi.fn<Ok>(() => Promise.resolve({ ok: true }))

vi.mock('@/app/(dashboard)/actions/actions', () => ({
  closeActionAction: (...a: unknown[]) => mockClose(...a),
  markActionProgressAction: (...a: unknown[]) => mockMarkProgress(...a),
  snoozeActionAction: (...a: unknown[]) => mockSnooze(...a),
  planActionAction: (...a: unknown[]) => mockPlan(...a),
  updateActionDetailsAction: (...a: unknown[]) => mockUpdateDetails(...a),
  setActionDueDateAction: (...a: unknown[]) => mockSetDueDate(...a),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function isoDate(d: Date): string {
  return d.toLocaleDateString('en-CA')
}
const today = new Date()
const yesterday = new Date(today)
yesterday.setDate(today.getDate() - 1)

function makeAction(overrides: Partial<SiteActionRow> = {}): SiteActionRow {
  return {
    id: 'a1',
    title: 'Transmettre le rapport G3',
    body: null,
    corps_etat: null,
    assigned_to: null,
    status: 'open',
    kind: 'one_shot',
    created_at: '2026-08-20T08:00:00.000Z',
    due_date: null,
    due_date_status: null,
    report_id: null,
    reserve_id: null,
    source_capture_id: null,
    created_from: null,
    converted_to_type: null,
    converted_to_id: null,
    site_id: 'site-1',
    organizationId: 'org-1',
    site_name: 'Chantier A',
    contract_id: null,
    contract_name: null,
    subject_id: null,
    last_progress_at: null,
    snooze_reason: null,
    snoozed_at: null,
    subject_thread_id: null,
    ...overrides,
  }
}

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest('li')!
}

function openMenu(card: HTMLElement) {
  fireEvent.click(within(card).getByRole('button', { name: "Plus d'actions" }))
}

describe('FieldActionsList — priorité', () => {
  it('action en retard porte le badge EN RETARD', () => {
    render(<FieldActionsList actions={[makeAction({ due_date: isoDate(yesterday) })]} />)
    const card = cardOf('Transmettre le rapport G3')
    expect(within(card).getByText('En retard')).toBeInTheDocument()
  })

  it('action sans date reste en suivi, sans crash ni date affichée', () => {
    render(<FieldActionsList actions={[makeAction({ due_date: null })]} />)
    const card = cardOf('Transmettre le rapport G3')
    expect(within(card).getByText('En suivi')).toBeInTheDocument()
    expect(within(card).queryByText(/Échéance/)).not.toBeInTheDocument()
  })
})

describe('FieldActionsList — Clôturer (geste principal)', () => {
  it('clôture directement via closeActionAction, sans passer par l’expand', async () => {
    render(<FieldActionsList actions={[makeAction()]} />)
    const card = cardOf('Transmettre le rapport G3')
    fireEvent.click(within(card).getByRole('button', { name: 'Clôturer' }))
    fireEvent.change(screen.getByPlaceholderText(/exercice réalisé/), { target: { value: 'Rapport transmis et validé.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmer la terminaison/ }))
    })
    expect(mockClose).toHaveBeenCalledTimes(1)
    const fd = mockClose.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('a1')
    expect(fd.get('site_id')).toBe('site-1')
    expect(fd.get('comment')).toBe('Rapport transmis et validé.')
  })
})

describe('FieldActionsList — menu ••• (Modifier / Replanifier / Voir la fiche)', () => {
  it('Modifier appelle updateActionDetailsAction avec le titre édité', async () => {
    render(<FieldActionsList actions={[makeAction()]} />)
    const card = cardOf('Transmettre le rapport G3')
    openMenu(card)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier' }))
    const titleInput = screen.getByPlaceholderText('Titre') as HTMLInputElement
    expect(titleInput.value).toBe('Transmettre le rapport G3')
    fireEvent.change(titleInput, { target: { value: 'Transmettre le rapport G3 corrigé' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    })
    expect(mockUpdateDetails).toHaveBeenCalledTimes(1)
    const fd = mockUpdateDetails.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('a1')
    expect(fd.get('site_id')).toBe('site-1')
    expect(fd.get('title')).toBe('Transmettre le rapport G3 corrigé')
  })

  it('propose « Replanifier » quand une échéance existe déjà', async () => {
    render(<FieldActionsList actions={[makeAction({ due_date: '2026-09-01', due_date_status: 'explicit' })]} />)
    const card = cardOf('Transmettre le rapport G3')
    openMenu(card)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Replanifier' }))
    const dateInput = screen.getByDisplayValue('2026-09-01') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-09-10' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    })
    expect(mockSetDueDate).toHaveBeenCalledTimes(1)
    const fd = mockSetDueDate.mock.calls[0][0] as FormData
    expect(fd.get('id')).toBe('a1')
    expect(fd.get('due_date')).toBe('2026-09-10')
  })

  it('propose « Planifier une échéance » quand aucune date n’existe', () => {
    render(<FieldActionsList actions={[makeAction({ due_date: null })]} />)
    const card = cardOf('Transmettre le rapport G3')
    openMenu(card)
    expect(screen.getByRole('menuitem', { name: 'Planifier une échéance' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Replanifier' })).not.toBeInTheDocument()
  })

  it('« Voir la fiche » navigue vers /m/site/{site}/action/{id}', () => {
    render(<FieldActionsList actions={[makeAction()]} />)
    const card = cardOf('Transmettre le rapport G3')
    openMenu(card)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voir la fiche' }))
    expect(mockPush).toHaveBeenCalledWith('/m/site/site-1/action/a1')
  })
})

describe('FieldActionsList — retour de navigation (jeton d’origine contrôlé)', () => {
  it('liste scopée chantier : le lien fiche porte ?from=actions pour revenir à la liste filtrée', () => {
    render(<FieldActionsList actions={[makeAction()]} scopedSiteId="site-1" />)
    const card = cardOf('Transmettre le rapport G3')
    const link = within(card).getByRole('link', { name: /Voir la fiche/ })
    expect(link).toHaveAttribute('href', '/m/site/site-1/action/a1?from=actions')
  })

  it('liste scopée : « Voir la fiche » (menu) navigue avec le jeton ?from=actions', () => {
    render(<FieldActionsList actions={[makeAction()]} scopedSiteId="site-1" />)
    const card = cardOf('Transmettre le rapport G3')
    openMenu(card)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voir la fiche' }))
    expect(mockPush).toHaveBeenCalledWith('/m/site/site-1/action/a1?from=actions')
  })

  it('liste globale (sans scope) : aucun jeton, la fiche garde son retour chantier historique', () => {
    render(<FieldActionsList actions={[makeAction()]} />)
    const card = cardOf('Transmettre le rapport G3')
    const link = within(card).getByRole('link', { name: /Voir la fiche/ })
    expect(link).toHaveAttribute('href', '/m/site/site-1/action/a1')
  })
})

describe('FieldActionsList — ligne de provenance (compacte, structurelle)', () => {
  it('affiche la ligne quand une provenance existe, cliquable si href /m', () => {
    render(
      <FieldActionsList
        actions={[makeAction()]}
        provenance={{ a1: { label: 'Issue de la visite du 30 août 2026', href: '/m/visite/r2' } }}
      />,
    )
    const card = cardOf('Transmettre le rapport G3')
    const link = within(card).getByRole('link', { name: /Issue de la visite du 30 août 2026/ })
    expect(link).toHaveAttribute('href', '/m/visite/r2')
  })

  it('provenance sans href (PV/sujet) : libellé affiché SANS lien', () => {
    render(
      <FieldActionsList
        actions={[makeAction()]}
        provenance={{ a1: { label: 'Issue du PV du 25 août 2026', href: null } }}
      />,
    )
    const card = cardOf('Transmettre le rapport G3')
    expect(within(card).getByText(/Issue du PV du 25 août 2026/)).toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: /Issue du PV/ })).not.toBeInTheDocument()
  })

  it('aucune provenance démontrable → aucune ligne « Issue de… » sur la carte', () => {
    render(<FieldActionsList actions={[makeAction()]} provenance={{}} />)
    const card = cardOf('Transmettre le rapport G3')
    expect(within(card).queryByText(/^↳|Issue d|Créée manuellement/)).not.toBeInTheDocument()
  })
})
