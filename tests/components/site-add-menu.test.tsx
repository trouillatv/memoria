import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

vi.mock('@/app/(dashboard)/sites/[id]/site-add-actions', () => ({
  uploadSiteDocumentAction: () => Promise.resolve({ ok: true }),
  importSiteEvidenceAction: () => Promise.resolve({ ok: true, created: 1 }),
}))
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}))

const { SiteAddMenu } = await import('@/app/(dashboard)/sites/[id]/SiteAddMenu')

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
