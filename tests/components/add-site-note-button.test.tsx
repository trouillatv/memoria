// Sprint 2 — Mémoire des lieux : tests du bouton + form inline AddSiteNoteButton.
//
// Couvre :
//   1. Bouton « Ajouter une note sur ce site » rendu initial
//   2. Click → form apparaît + textarea avec placeholder factuel
//   3. Body < 3 chars → bouton Ajouter disabled
//   4. Body 140 chars → maxLength respecté côté textarea
//   5. Submit valide → server action mockée appelée avec { siteId, body trimmé }
//   6. Server retourne { ok: false, error } → message d'erreur affiché
//   7. Annuler ferme le form sans appeler l'action

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AddSiteNoteButton } from '@/app/(field)/m/intervention/[id]/AddSiteNoteButton'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const SITE_ID = '22222222-2222-2222-2222-222222222222'

type ActionResult = { ok: true } | { ok: false; error: string }
type ActionFn = (input: { siteId: string; body: string }) => Promise<ActionResult>

function mkOk(): ActionFn {
  return vi.fn<ActionFn>(async () => ({ ok: true as const }))
}

describe('AddSiteNoteButton — rendu initial', () => {
  it('affiche le bouton « Ajouter une note sur ce site » par défaut', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    const trigger = screen.getByTestId('add-site-note-trigger')
    expect(trigger).toHaveTextContent(/ajouter une note sur ce site/i)
    // Form pas affiché au mount.
    expect(screen.queryByTestId('add-site-note-form')).not.toBeInTheDocument()
  })

  it('click sur le trigger → form visible avec placeholder factuel', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    expect(screen.getByTestId('add-site-note-form')).toBeInTheDocument()
    const input = screen.getByTestId('add-site-note-input') as HTMLTextAreaElement
    expect(input.placeholder).toMatch(/bloc b\s*:\s*humidité signalée/i)
    // Verrou V4 — pas de wording de contrôle dans le placeholder.
    expect(input.placeholder).not.toMatch(/attention|pense à|n'oublie/i)
  })
})

describe('AddSiteNoteButton — validation 3-140 chars', () => {
  it('body vide → bouton Ajouter disabled', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    const submit = screen.getByTestId('add-site-note-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('body < 3 chars (après trim) → bouton Ajouter disabled', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    const input = screen.getByTestId('add-site-note-input')
    fireEvent.change(input, { target: { value: 'ok' } })
    const submit = screen.getByTestId('add-site-note-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('textarea maxLength=140 (verrou V5 édition contrainte)', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    const input = screen.getByTestId('add-site-note-input') as HTMLTextAreaElement
    expect(input.maxLength).toBe(140)
  })

  it('body 3 chars valides → bouton Ajouter activé', () => {
    render(<AddSiteNoteButton siteId={SITE_ID} action={mkOk()} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    fireEvent.change(screen.getByTestId('add-site-note-input'), {
      target: { value: 'Bloc B humide' },
    })
    const submit = screen.getByTestId('add-site-note-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })
})

describe('AddSiteNoteButton — soumission', () => {
  it('submit valide → server action appelée avec { siteId, body trimmé }', async () => {
    const action = vi.fn<ActionFn>(async ({ siteId, body }) => {
      expect(siteId).toBe(SITE_ID)
      expect(body).toBe('Code accès cuisine changé : 4521')
      return { ok: true as const }
    })
    render(<AddSiteNoteButton siteId={SITE_ID} action={action} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    fireEvent.change(screen.getByTestId('add-site-note-input'), {
      target: { value: '   Code accès cuisine changé : 4521   ' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-site-note-submit'))
    })
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
    // Après succès → form fermé.
    expect(screen.queryByTestId('add-site-note-form')).not.toBeInTheDocument()
    expect(screen.getByText(/code accès cuisine changé : 4521/i)).toBeInTheDocument()
  })

  it('server retourne { ok: false, error } → message d\'erreur affiché, form reste ouvert', async () => {
    const action = vi.fn<ActionFn>(async () => ({
      ok: false as const,
      error: 'Note trop longue (140 caractères maximum)',
    }))
    render(<AddSiteNoteButton siteId={SITE_ID} action={action} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    fireEvent.change(screen.getByTestId('add-site-note-input'), {
      target: { value: 'Note valide pour test' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-site-note-submit'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('add-site-note-error')).toHaveTextContent(/trop longue/i)
    })
    // Form reste ouvert pour permettre la correction.
    expect(screen.getByTestId('add-site-note-form')).toBeInTheDocument()
  })

  it('Annuler ferme le form sans appeler l\'action', () => {
    const action = mkOk()
    render(<AddSiteNoteButton siteId={SITE_ID} action={action} />)
    fireEvent.click(screen.getByTestId('add-site-note-trigger'))
    expect(screen.getByTestId('add-site-note-form')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('add-site-note-cancel'))
    expect(screen.queryByTestId('add-site-note-form')).not.toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
  })
})
