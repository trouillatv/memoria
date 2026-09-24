// P0-2C FIX_REQUIRED (mandat Vincent 2026-09-24, revue SHA e88034a1) — problème 1.
// La surface de revue est partagée entre PV historique et documents contractuels
// (Engagement). Un run Engagement ne doit JAMAIS proposer de matérialisation de
// visite (CreateVisitBlock) — un run historique doit continuer à le faire
// exactement comme avant (témoin de non-régression).

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExtractionReviewClient } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/ExtractionReviewClient'
import { computeReviewSummary } from '@/lib/documents/effective-proposal'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/documents/doc-1/extraction/run-1',
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions', () => ({
  createHistoricalVisitAction: vi.fn(),
  acceptAllPendingAction: vi.fn(),
  toggleEvidencePinAction: vi.fn(),
  pinAllSnapshotsAction: vi.fn(),
  confirmPhotoAssociationAction: vi.fn(),
  dismissPhotoAssociationAction: vi.fn(),
  revertIllustratesAction: vi.fn(),
  finalizeAcceptedEngagementsAction: vi.fn(),
}))

vi.mock('@/app/(dashboard)/documents/[id]/extraction/[runId]/SubjectSuggestionsSection', () => ({
  SubjectSuggestionsSection: () => null,
}))

function renderClient(isEngagementRun?: boolean) {
  const summary = computeReviewSummary([])
  return render(
    <ExtractionReviewClient
      proposals={[]}
      orphanEvidence={[]}
      signedUrls={{}}
      documentId="doc-1"
      runId="run-1"
      summary={summary}
      effectiveDate="2026-09-01"
      targetSiteId="site-1"
      alreadySiteReportId={null}
      candidateLinks={[]}
      initialIllustratesLinks={[]}
      isEngagementRun={isEngagementRun}
    />,
  )
}

describe('ExtractionReviewClient — isEngagementRun gate', () => {
  it('run historique (isEngagementRun absent) : CreateVisitBlock affiché — témoin de non-régression', () => {
    renderClient(false)
    expect(screen.getByRole('heading', { name: 'Créer la visite historique' })).toBeInTheDocument()
  })

  it('run Engagement (isEngagementRun=true) : jamais de CTA de matérialisation de visite', () => {
    renderClient(true)
    expect(screen.queryByRole('heading', { name: 'Créer la visite historique' })).not.toBeInTheDocument()
    expect(screen.queryByText('Créer la visite historique')).not.toBeInTheDocument()
    expect(screen.queryByText(/Voir la visite historique/)).not.toBeInTheDocument()
  })
})
