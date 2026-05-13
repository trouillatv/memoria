// Sprint 6 — Tests du dialog de clôture mentale CloseDossierDialog.
//
// Doctrine V5 verrou V3 :
//   - Wording autorisé : "Clôturer", "Clôturé", "Dossier clôturé".
//   - Wording INTERDIT : "résolu", "résolus", "résolue", "résolues",
//     "resolved", "issue closed", "conflit terminé".
//
// Couvre :
//   1. Rendu initial (token ouvert) : bouton "Clôturer ce dossier"
//   2. Click → dialog visible avec placeholder factuel
//   3. Textarea limitée à 200 chars (maxLength)
//   4. Submit → server action mockée appelée { tokenId, note trimmé }
//   5. Doctrine grep : aucun mot "résolu" / "resolved" / "issue closed"
//      dans le rendu DOM (verrou V3)
//   6. État clôturé : badge + bouton "Rouvrir" appelle reopenAction

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CloseDossierDialog } from '@/app/(dashboard)/preuves/[id]/CloseDossierDialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const TOKEN_ID = '11111111-1111-1111-1111-111111111111'

type CloseResult = { ok: boolean; error?: string }
type CloseFn = (input: { tokenId: string; note?: string }) => Promise<CloseResult>
type ReopenFn = (tokenId: string) => Promise<CloseResult>

function mkCloseOk(): CloseFn {
  return vi.fn<CloseFn>(async () => ({ ok: true }))
}
function mkReopenOk(): ReopenFn {
  return vi.fn<ReopenFn>(async () => ({ ok: true }))
}

describe('CloseDossierDialog — rendu initial (token ouvert)', () => {
  it('affiche le bouton « Clôturer ce dossier »', () => {
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    const trigger = screen.getByTestId('close-dossier-trigger')
    expect(trigger).toHaveTextContent(/clôturer ce dossier/i)
    expect(screen.queryByTestId('close-dossier-dialog')).not.toBeInTheDocument()
  })

  it('click sur le trigger → dialog visible avec textarea + placeholder factuel', () => {
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))

    expect(screen.getByTestId('close-dossier-dialog')).toBeInTheDocument()
    const textarea = screen.getByTestId('close-dossier-note') as HTMLTextAreaElement
    expect(textarea.placeholder).toMatch(/échange finalisé après réunion/i)
  })
})

describe('CloseDossierDialog — édition contrainte (200 chars max)', () => {
  it('textarea maxLength = 200', () => {
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))
    const textarea = screen.getByTestId('close-dossier-note') as HTMLTextAreaElement
    expect(textarea.maxLength).toBe(200)
  })
})

describe('CloseDossierDialog — soumission', () => {
  it('submit avec note → server action appelée avec { tokenId, note trimmée }', async () => {
    const action = vi.fn<CloseFn>(async ({ tokenId, note }) => {
      expect(tokenId).toBe(TOKEN_ID)
      expect(note).toBe('Échange finalisé après réunion du 15 mai')
      return { ok: true }
    })
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={action}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))
    fireEvent.change(screen.getByTestId('close-dossier-note'), {
      target: { value: '   Échange finalisé après réunion du 15 mai   ' },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('close-dossier-submit'))
    })

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
  })

  it('submit sans note → server action appelée avec note=undefined', async () => {
    const action = vi.fn<CloseFn>(async ({ tokenId, note }) => {
      expect(tokenId).toBe(TOKEN_ID)
      expect(note).toBeUndefined()
      return { ok: true }
    })
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={action}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-dossier-submit'))
    })
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1)
    })
  })

  it('server retourne { ok: false, error } → message affiché, dialog reste ouvert', async () => {
    const action = vi.fn<CloseFn>(async () => ({
      ok: false,
      error: 'Dossier déjà clôturé.',
    }))
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={action}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-dossier-submit'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('close-dossier-error')).toHaveTextContent(/déjà clôturé/i)
    })
    expect(screen.getByTestId('close-dossier-dialog')).toBeInTheDocument()
  })
})

describe('CloseDossierDialog — état clôturé', () => {
  it('si closed_at NOT NULL : affiche badge "Clôturé" + bouton Rouvrir', () => {
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt="2026-05-13T10:00:00.000Z"
        closureNote="Échange finalisé après réunion du 15 mai"
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    expect(screen.getByTestId('close-dossier-closed-state')).toBeInTheDocument()
    expect(screen.getByTestId('close-dossier-closed-state')).toHaveTextContent(/clôturé/i)
    expect(screen.getByTestId('close-dossier-closure-note')).toHaveTextContent(
      /échange finalisé/i,
    )
    expect(screen.getByTestId('close-dossier-reopen')).toBeInTheDocument()
  })

  it('click Rouvrir → reopenAction appelée avec le tokenId', async () => {
    const reopen = vi.fn<ReopenFn>(async (id) => {
      expect(id).toBe(TOKEN_ID)
      return { ok: true }
    })
    render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt="2026-05-13T10:00:00.000Z"
        closeAction={mkCloseOk()}
        reopenAction={reopen}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-dossier-reopen'))
    })
    await waitFor(() => {
      expect(reopen).toHaveBeenCalledTimes(1)
    })
  })
})

describe('CloseDossierDialog — doctrine V5 verrou V3 (wording)', () => {
  // Verrou doctrinal : aucun mot "résolu" / "resolved" / "issue closed" /
  // "conflit terminé" ne doit apparaître dans le DOM rendu, que ce soit
  // en état ouvert (avec dialog) ou en état clôturé.
  const FORBIDDEN = /(résolu(?:s|e|es)?|resolved|issue closed|conflit terminé)/i

  it('état ouvert + dialog ouverte : aucun mot interdit', () => {
    const { container } = render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt={null}
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    fireEvent.click(screen.getByTestId('close-dossier-trigger'))
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN)
  })

  it('état clôturé : aucun mot interdit (badge, note, bouton Rouvrir)', () => {
    const { container } = render(
      <CloseDossierDialog
        tokenId={TOKEN_ID}
        closedAt="2026-05-13T10:00:00.000Z"
        closureNote="Incident traité"
        closeAction={mkCloseOk()}
        reopenAction={mkReopenOk()}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN)
  })
})
