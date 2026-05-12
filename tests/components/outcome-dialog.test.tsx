import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock de la server action avant import du composant.
vi.mock('@/app/(dashboard)/tenders/[id]/outcome-actions', () => ({
  setTenderOutcomeAction: vi.fn(async () => ({ ok: true })),
}))

// Mock sonner (toast) pour éviter les side effects dans jsdom.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { OutcomeDialog } from '@/app/(dashboard)/tenders/[id]/OutcomeDialog'
import { setTenderOutcomeAction } from '@/app/(dashboard)/tenders/[id]/outcome-actions'

const TENDER_ID = '11111111-1111-1111-1111-111111111111'

describe('OutcomeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('affiche 4 radios statut quand outcome est null', () => {
    render(
      <OutcomeDialog
        open={true}
        onOpenChange={() => {}}
        tenderId={TENDER_ID}
        initialOutcome={null}
      />,
    )

    expect(screen.getByText('Gagné')).toBeInTheDocument()
    expect(screen.getByText('Perdu')).toBeInTheDocument()
    expect(screen.getByText('Retiré')).toBeInTheDocument()
    expect(screen.getByText('Pas de réponse client')).toBeInTheDocument()
  })

  it('révèle le champ raison + radios tag quand on coche "Perdu"', () => {
    render(
      <OutcomeDialog
        open={true}
        onOpenChange={() => {}}
        tenderId={TENDER_ID}
        initialOutcome={null}
      />,
    )

    // Pas de tag visible initialement
    expect(screen.queryByText('Thème')).not.toBeInTheDocument()

    // Click sur l'input radio "Perdu"
    const lostRadio = screen
      .getAllByRole('radio')
      .find((el) => (el as HTMLInputElement).value === 'lost') as HTMLInputElement
    fireEvent.click(lostRadio)

    // Maintenant raison + thème
    expect(screen.getByText('Raison principale')).toBeInTheDocument()
    expect(screen.getByText('Thème')).toBeInTheDocument()
    expect(screen.getByText('Prix')).toBeInTheDocument()
    expect(screen.getByText('Qualité')).toBeInTheDocument()
  })

  it('submit "Gagné" sans raison appelle l\'action avec outcome=won uniquement', async () => {
    render(
      <OutcomeDialog
        open={true}
        onOpenChange={() => {}}
        tenderId={TENDER_ID}
        initialOutcome={null}
      />,
    )

    const wonRadio = screen
      .getAllByRole('radio')
      .find((el) => (el as HTMLInputElement).value === 'won') as HTMLInputElement
    fireEvent.click(wonRadio)

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }))

    await waitFor(() => {
      expect(setTenderOutcomeAction).toHaveBeenCalledTimes(1)
    })
    expect(setTenderOutcomeAction).toHaveBeenCalledWith({
      tenderId: TENDER_ID,
      outcome: 'won',
    })
  })

  it('submit "Perdu" + raison + tag appelle l\'action avec tous les champs', async () => {
    render(
      <OutcomeDialog
        open={true}
        onOpenChange={() => {}}
        tenderId={TENDER_ID}
        initialOutcome={null}
      />,
    )

    const lostRadio = screen
      .getAllByRole('radio')
      .find((el) => (el as HTMLInputElement).value === 'lost') as HTMLInputElement
    fireEvent.click(lostRadio)

    const textarea = screen.getByPlaceholderText(
      /qu'est-ce qui a pesé/i,
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Prix trop haut' } })

    const prixRadio = screen
      .getAllByRole('radio')
      .find((el) => (el as HTMLInputElement).value === 'prix') as HTMLInputElement
    fireEvent.click(prixRadio)

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }))

    await waitFor(() => {
      expect(setTenderOutcomeAction).toHaveBeenCalledTimes(1)
    })
    expect(setTenderOutcomeAction).toHaveBeenCalledWith({
      tenderId: TENDER_ID,
      outcome: 'lost',
      reason: 'Prix trop haut',
      tag: 'prix',
    })
  })

  it('limite la raison à 200 caractères côté input (slice)', () => {
    render(
      <OutcomeDialog
        open={true}
        onOpenChange={() => {}}
        tenderId={TENDER_ID}
        initialOutcome={null}
      />,
    )

    const lostRadio = screen
      .getAllByRole('radio')
      .find((el) => (el as HTMLInputElement).value === 'lost') as HTMLInputElement
    fireEvent.click(lostRadio)

    const textarea = screen.getByPlaceholderText(
      /qu'est-ce qui a pesé/i,
    ) as HTMLTextAreaElement

    const longValue = 'a'.repeat(250)
    fireEvent.change(textarea, { target: { value: longValue } })

    expect(textarea.value.length).toBe(200)
    expect(screen.getByText('200/200')).toBeInTheDocument()
  })
})
