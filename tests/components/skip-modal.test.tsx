// Slice 6.4 — Tests composant SkipInterventionTrigger + modal « Pas aujourd'hui ».
//
// Tests :
//   1. Bouton « Pas aujourd'hui » visible au rendu initial.
//   2. Click bouton → modal s'ouvre (titre apparait).
//   3. Textarea vide → bouton Confirmer disabled.
//   4. Texte < 3 chars (trimmed) → Confirmer disabled.
//   5. Confirmer avec texte valide → server action appelée avec
//      intervention_id + reason corrects.
//   6. Server retourne { ok: false, error } → message d'erreur affiché.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SkipInterventionTrigger } from '@/app/(field)/m/intervention/[id]/skip-modal'

// next/navigation est appelé via useRouter().refresh() après succès.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// On mocke l'action serveur via le prop `action` du SkipInterventionTrigger
// (plus simple et plus déterministe que vi.mock du module 'actions'). Le code
// utilise `action ?? skipInterventionAction` côté composant.

const INTERVENTION_ID = '11111111-1111-1111-1111-111111111111'

type SkipActionResult = { ok: true } | { ok: false; error?: string } | { error: string }
type SkipAction = (fd: FormData) => Promise<SkipActionResult>

function mkOk(): SkipAction {
  return vi.fn<SkipAction>(async () => ({ ok: true as const }))
}

describe('SkipInterventionTrigger — rendu initial', () => {
  it('affiche le bouton "Pas aujourd\'hui"', () => {
    const action = mkOk()
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    expect(screen.getByTestId('skip-trigger')).toHaveTextContent(
      /annuler l'opération de ce jour/i,
    )
  })

  it('ne rend pas la modale au mount', () => {
    const action = mkOk()
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('SkipInterventionTrigger — ouverture & validation', () => {
  let action: SkipAction

  beforeEach(() => {
    action = mkOk()
  })

  it('click sur le bouton → modale visible avec titre', () => {
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByText(/annuler l'opération de ce jour\s*\?/i),
    ).toBeInTheDocument()
  })

  it('textarea vide → Confirmer disabled', () => {
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    const confirm = screen.getByTestId('skip-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('texte trop court (2 chars) → Confirmer disabled', () => {
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    const textarea = screen.getByTestId('skip-reason-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'ok' } })
    const confirm = screen.getByTestId('skip-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('texte whitespace-only → Confirmer disabled (trim → <3)', () => {
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    const textarea = screen.getByTestId('skip-reason-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '     ' } })
    const confirm = screen.getByTestId('skip-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('texte valide (>=3 chars) → Confirmer activé', () => {
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    const textarea = screen.getByTestId('skip-reason-input') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Site fermé' } })
    const confirm = screen.getByTestId('skip-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
  })
})

describe('SkipInterventionTrigger — soumission', () => {
  it('appelle la server action avec intervention_id + reason trimmés', async () => {
    const action = vi.fn<SkipAction>(async (fd: FormData) => {
      // Capturer le FormData pour vérification — return ok
      expect(fd.get('intervention_id')).toBe(INTERVENTION_ID)
      expect(fd.get('reason')).toBe('Site fermé pour travaux')
      return { ok: true as const }
    })
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    fireEvent.change(screen.getByTestId('skip-reason-input'), {
      target: { value: '  Site fermé pour travaux  ' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('skip-confirm'))
    })
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
  })

  it('server retourne { ok: false, error } → message d\'erreur affiché', async () => {
    const action = vi.fn<SkipAction>(async () => ({
      ok: false as const,
      error: 'Cette intervention est déjà commencée',
    }))
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    fireEvent.change(screen.getByTestId('skip-reason-input'), {
      target: { value: 'Raison test' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('skip-confirm'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('skip-error')).toHaveTextContent(
        /déjà commencée/i
      )
    })
    // La modale reste ouverte pour permettre de corriger
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Annuler ferme la modale sans appeler l\'action', () => {
    const action = vi.fn<SkipAction>(async () => ({ ok: true as const }))
    render(<SkipInterventionTrigger interventionId={INTERVENTION_ID} action={action} />)
    fireEvent.click(screen.getByTestId('skip-trigger'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('skip-cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
  })
})
