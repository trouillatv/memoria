// SourceList (synthèse IA) — une source PDF affiche l'état structuré, et ne
// présente JAMAIS une page comme fiable quand elle ne l'est pas.
// Bibliothèque et analyse gardent leur rendu (inchangé).

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceList } from '@/app/(dashboard)/tenders/[id]/SourceList'
import type { Source } from '@/types/db'

function pdf(p: Partial<Source>): Source {
  return { type: 'pdf', quote: p.quote ?? 'nettoyage quotidien des locaux', ...p }
}

// Les sources sont dans un <details> fermé ; on l'ouvre pour lire le contenu.
function open() {
  document.querySelectorAll('details').forEach((d) => d.setAttribute('open', 'true'))
}

describe('SourceList — provenance PDF structurée', () => {
  it('vérifiée → « CCTP.pdf — page 12 »', () => {
    render(<SourceList sources={[pdf({ document: 'CCTP.pdf', page: 12, verified: true })]} />)
    open()
    expect(screen.getByText('CCTP.pdf — page 12')).toBeInTheDocument()
  })

  it('NON vérifiée → « CCTP.pdf — page non localisée », jamais « page 12 »', () => {
    render(<SourceList sources={[pdf({ document: 'CCTP.pdf', page: 12, verified: false })]} />)
    open()
    expect(screen.getByText('CCTP.pdf — page non localisée')).toBeInTheDocument()
    expect(screen.queryByText(/page 12/)).toBeNull()
    // Le tag « non vérifiée » n'est plus affiché pour un PDF (subsumé par l'état).
    expect(screen.queryByText('non vérifiée')).toBeNull()
  })

  it('pièce sans page → « CCTP.pdf — page non localisée »', () => {
    render(<SourceList sources={[pdf({ document: 'CCTP.pdf', verified: true })]} />)
    open()
    expect(screen.getByText('CCTP.pdf — page non localisée')).toBeInTheDocument()
  })

  it('pas de pièce démontrée → « Source non localisée »', () => {
    render(<SourceList sources={[pdf({ document: undefined, verified: false })]} />)
    open()
    expect(screen.getByText('Source non localisée')).toBeInTheDocument()
  })
})

describe('SourceList — autres types inchangés', () => {
  it('bibliothèque non vérifiée garde son tag « non vérifiée »', () => {
    render(<SourceList sources={[{ type: 'library', quote: 'q', library_item_title: 'Fiche béton', verified: false }]} />)
    open()
    expect(screen.getByText('Fiche béton')).toBeInTheDocument()
    expect(screen.getByText('non vérifiée')).toBeInTheDocument()
  })
})
