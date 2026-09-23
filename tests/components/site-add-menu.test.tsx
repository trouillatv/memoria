import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── G1 — LE MENU « AJOUTER » ÉTAIT INUTILISABLE SUR ORDINATEUR ──────────────
//
// Guillaume : « le menu s'ouvre, mais impossible de sélectionner une entrée, il
// se referme aussitôt. »
//
// Cause : le menu s'ouvrait sur `onMouseEnter` et se fermait sur le
// `onMouseLeave` du conteneur. Le panneau étant décollé du bouton de 8 px
// (`mt-2`), descendre vers une entrée faisait traverser ce vide — qui
// n'appartient à aucun descendant — et refermait le menu avant qu'on l'atteigne.
// Le bouton n'avait par ailleurs aucun `onClick` : au clavier et au toucher, le
// menu n'existait pas.
//
// Ces tests interdisent le retour du survol comme mécanisme d'ouverture.

const uploadSiteDocumentAction = vi.fn(async (_siteId: string, _fd: FormData) => ({ ok: true }))
const uploadSiteContractualDocumentAction = vi.fn(async (_siteId: string, _fd: FormData) => ({ ok: true, documentId: 'doc-1' }))
const importSiteEvidenceAction = vi.fn(async (_siteId: string, _fd: FormData) => ({ ok: true, created: 1 }))

vi.mock('@/app/(dashboard)/sites/[id]/site-add-actions', () => ({
  uploadSiteDocumentAction: (siteId: string, fd: FormData) => uploadSiteDocumentAction(siteId, fd),
  uploadSiteContractualDocumentAction: (siteId: string, fd: FormData) => uploadSiteContractualDocumentAction(siteId, fd),
  importSiteEvidenceAction: (siteId: string, fd: FormData) => importSiteEvidenceAction(siteId, fd),
}))
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}))

const { SiteAddMenu } = await import('@/app/(dashboard)/sites/[id]/SiteAddMenu')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Le menu « Ajouter » s’ouvre au clic', () => {
  it('est fermé au départ', () => {
    render(<SiteAddMenu siteId="s1" />)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: /Ajouter/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('s’ouvre quand on clique le bouton', () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Document PDF/ })).toBeTruthy()
  })

  it('ne s’ouvre PAS au simple survol — le survol n’est plus un mécanisme', () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Ajouter/ }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('Le menu reste ouvert le temps de choisir', () => {
  it('survivre à un mouseleave — c’était LE défaut', () => {
    const { container } = render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.mouseLeave(container.firstChild as HTMLElement)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('laisse cliquer une entrée, qui ouvre bien son dialogue', () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.click(screen.getByRole('button', { name: /Document PDF/ }))
    expect(screen.getByText('Ajouter un document au chantier')).toBeTruthy()
  })
})

describe('Le menu se ferme comme on l’attend', () => {
  it('sur un second clic du bouton', () => {
    render(<SiteAddMenu siteId="s1" />)
    const bouton = screen.getByRole('button', { name: /Ajouter/ })
    fireEvent.click(bouton)
    fireEvent.click(bouton)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('sur Échap', () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('sur un clic à l’extérieur', () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

// ── P0-1 — Document contractuel : le dialogue réel doit produire le bon contrat ──
//
// Un CCTP importé via « Document contractuel » est apparu en bibliothèque
// comme "preuve" (recette Vincent, OCEF, 2026-09-23) alors que les tests
// existants ne prouvaient que le passage tel quel d'une FormData construite à
// la main à uploadSiteDocumentAction — jamais que le dialogue RÉELLEMENT
// rendu, avec sa sélection par défaut et son interaction, produit bien cette
// FormData. Ces tests rendent le vrai SiteContractualDocumentDialog (via
// SiteAddMenu) et vérifient l'appel serveur effectivement déclenché.
describe('Document contractuel — le dialogue réel appelle le bon contrat serveur', () => {
  it('CCTP (sélection par défaut) + date d’effet → uploadSiteContractualDocumentAction reçoit document_type=cctp et effective_date, jamais uploadSiteDocumentAction', async () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.click(screen.getByRole('button', { name: /Document contractuel/ }))

    const form = document.querySelector('form') as HTMLFormElement
    expect(form).toBeTruthy()

    const typeSelect = screen.getByLabelText('Nature du document') as HTMLSelectElement
    expect(typeSelect.value).toBe('cctp')

    const file = new File(['contenu-cctp'], 'CCTP.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('PDF'), { target: { files: [file] } })

    fireEvent.change(screen.getByLabelText(/Date d.effet/), { target: { value: '2026-09-01' } })

    fireEvent.submit(form)

    await waitFor(() => expect(uploadSiteContractualDocumentAction).toHaveBeenCalledTimes(1))
    const [siteId, fd] = uploadSiteContractualDocumentAction.mock.calls[0]!
    expect(siteId).toBe('s1')
    expect(fd.get('document_type')).toBe('cctp')
    expect(fd.get('effective_date')).toBe('2026-09-01')
    expect(uploadSiteDocumentAction).not.toHaveBeenCalled()
  })

  it('« Document PDF » (générique) continue d’appeler uploadSiteDocumentAction, jamais l’action contractuelle', async () => {
    render(<SiteAddMenu siteId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/ }))
    fireEvent.click(screen.getByRole('button', { name: /Document PDF/ }))

    const form = document.querySelector('form') as HTMLFormElement
    const file = new File(['contenu'], 'doc.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('PDF'), { target: { files: [file] } })

    fireEvent.submit(form)

    await waitFor(() => expect(uploadSiteDocumentAction).toHaveBeenCalledTimes(1))
    const [, fd] = uploadSiteDocumentAction.mock.calls[0]!
    expect(fd.get('document_type')).toBe('preuve')
    expect(uploadSiteContractualDocumentAction).not.toHaveBeenCalled()
  })
})
