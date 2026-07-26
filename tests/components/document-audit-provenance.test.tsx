// Audit documentaire multipièces — le composant rend la provenance PERSISTÉE :
//   exact          → pièce démontrée + page + surlignage
//   document_only  → pièce démontrée, page non localisée
//   unavailable    → « Source non localisée », le lecteur ne bouge pas
// La pièce d'ouverture n'est qu'une cible de consultation, jamais une source.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DocumentAudit, type AuditEngagement } from '@/app/(dashboard)/tenders/[id]/audit/DocumentAudit'
import type { AuditProvenance } from '@/app/(dashboard)/tenders/[id]/audit/audit-provenance'

// pdf.js n'existe pas en jsdom — le viewer est remplacé par un témoin qui
// expose l'URL et la page reçues (ce que le contrat de navigation décide).
vi.mock('@/app/(dashboard)/tenders/[id]/audit/PdfAuditViewer', () => ({
  PdfAuditViewer: ({ url, page }: { url: string; page: number | null }) => (
    <div data-testid="pdf-viewer" data-url={url} data-page={page ?? ''} />
  ),
}))

const DOC_A = { id: 'doc-a', filename: 'CCAP.pdf', url: 'https://signed/ccap' }
const DOC_B = { id: 'doc-b', filename: 'CCTP.pdf', url: 'https://signed/cctp' }

function engagement(p: Partial<AuditEngagement> & { provenance: AuditProvenance }): AuditEngagement {
  return {
    id: p.id ?? 'e-1',
    kind: p.kind ?? 'obligation',
    shortLabel: p.shortLabel ?? 'Nettoyage quotidien',
    excerpt: p.excerpt ?? 'nettoyage quotidien des locaux',
    context: p.context ?? null,
    occurrences: p.occurrences ?? [],
    provenance: p.provenance,
  }
}

const exactEng = engagement({
  id: 'e-exact', shortLabel: 'Pénalité de retard',
  provenance: { state: 'exact', documentId: 'doc-b', pageNumber: 12, filename: 'CCTP.pdf' },
})
const documentOnlyEng = engagement({
  id: 'e-doc-only', shortLabel: 'Contrôle mensuel',
  provenance: { state: 'document_only', documentId: 'doc-b', pageNumber: null, filename: 'CCTP.pdf' },
})
const unavailableEng = engagement({
  id: 'e-unavailable', shortLabel: 'Obligation héritée',
  provenance: { state: 'unavailable', documentId: null, pageNumber: null, filename: null },
})

const tab = (name: string) => screen.getByRole('tab', { name })

describe('DocumentAudit — sélecteur de pièces et ouverture', () => {
  it('toutes les pièces du dossier sont un sélecteur de première classe', async () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[exactEng]} />)
    expect(tab('CCAP.pdf')).toBeInTheDocument()
    expect(tab('CCTP.pdf')).toBeInTheDocument()
    // Ouverture : première pièce = consultation, pas une source démontrée.
    expect(tab('CCAP.pdf')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('CCAP.pdf — consultation')).toBeInTheDocument()
    expect((await screen.findByTestId('pdf-viewer')).dataset.page).toBe('')
  })

  it('une pièce se consulte à la main même sans engagement sélectionné', async () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[]} />)
    fireEvent.click(tab('CCTP.pdf'))
    expect(tab('CCTP.pdf')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('CCTP.pdf — consultation')).toBeInTheDocument()
    expect((await screen.findByTestId('pdf-viewer')).dataset.url).toBe(DOC_B.url)
  })

  it('dossier sans pièce → état vide explicite', () => {
    render(<DocumentAudit documents={[]} engagements={[unavailableEng]} />)
    expect(screen.getByText('Aucune pièce dans ce dossier.')).toBeInTheDocument()
  })
})

describe('DocumentAudit — navigation par état de provenance', () => {
  it('exact → la pièce démontrée s\'ouvre à la page vérifiée', async () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[exactEng]} />)
    fireEvent.click(screen.getByText('Pénalité de retard'))
    expect(tab('CCTP.pdf')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('CCTP.pdf — page 12')).toBeInTheDocument()
    const v = await screen.findByTestId('pdf-viewer')
    expect(v.dataset.url).toBe(DOC_B.url)
    expect(v.dataset.page).toBe('12')
  })

  it('document_only → la pièce démontrée s\'ouvre SANS forcer de page', async () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[documentOnlyEng]} />)
    fireEvent.click(screen.getByText('Contrôle mensuel'))
    expect(tab('CCTP.pdf')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('CCTP.pdf — page non localisée')).toBeInTheDocument()
    expect((await screen.findByTestId('pdf-viewer')).dataset.page).toBe('')
  })

  it('unavailable → « Source non localisée » et le lecteur ne bouge pas', async () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[unavailableEng]} />)
    fireEvent.click(screen.getByText('Obligation héritée'))
    // Aucun repli : la pièce consultée reste la première, sans page.
    expect(tab('CCAP.pdf')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Source non localisée')).toBeInTheDocument()
    const v = await screen.findByTestId('pdf-viewer')
    expect(v.dataset.url).toBe(DOC_A.url)
    expect(v.dataset.page).toBe('')
  })

  it('la liste porte l\'état de chaque engagement (badge de ligne)', () => {
    render(<DocumentAudit documents={[DOC_A, DOC_B]} engagements={[exactEng, documentOnlyEng, unavailableEng]} />)
    expect(screen.getByText('p.12')).toBeInTheDocument()
    expect(screen.getByText('page non localisée')).toBeInTheDocument()
    expect(screen.getByText('source non localisée')).toBeInTheDocument()
  })
})
