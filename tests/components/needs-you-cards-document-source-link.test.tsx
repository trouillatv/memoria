// 6E.7 — SOURCE / PREUVE DIRECTE. Preuve que SourceExcerpt/PointProofDisclosure/la liste inline
// de ClarifyEvidenceCard n'ouvrent un lien vers le document source QUE lorsque documentHref peut
// honnêtement déterminer une destination (documentId ET documentType réellement connus), et que
// la destination rendue est TOUJOURS celle décidée par la primitive réelle documentHref — jamais
// une copie de sa logique dans ce test. sourcePage reste un texte informatif, jamais un
// fragment/query fabriqué.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QuestionCard, type ActionResult } from '@/app/(dashboard)/sites/[id]/besoin-de-toi/NeedsYouCards'
import { documentHref } from '@/lib/knowledge/document-href'
import type { MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'
import type { TraceIdentityTarget } from '@/lib/knowledge/tracked-point-trace-queue'
import type { ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

const noopRunAction = (_action: () => Promise<ActionResult>, _recapLabel?: string | null) => {}

function traceTarget(overrides: Partial<TraceIdentityTarget> = {}): TraceIdentityTarget {
  return {
    candidateId: 'candidate-1',
    pointId: 'point-1',
    canonicalPointId: null,
    scope: 'thread',
    label: 'Sprinkler zone A',
    identityStatus: null,
    derivedState: 'open',
    subject: null,
    subjectLabel: null,
    latestMeaningfulEventAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    actionability: 'ACTIONABLE',
    blockerReason: null,
    classification: {
      category: 'SAFE_SINGLE_TRACE_THREAD',
      canonicalTargetId: null,
      sourceOwnPointId: null,
      relation: null,
      attachedAt: null,
      blockerReason: null,
    },
    ...overrides,
  } as TraceIdentityTarget
}

function attachInformationQuestion(overrides: {
  sourceDocumentId?: string | null
  sourceDocumentType?: string | null
} = {}): MemoriaNeedsYouQuestion {
  return {
    category: 'attach_information',
    id: 'source-1',
    entry: {
      sourceKey: 'source-1',
      sourceThreadId: 'thread-1',
      sourceProposalIds: ['prop-1'],
      scope: 'thread',
      sourceLabel: 'Sprinkler mentionné',
      sourceDocumentId: overrides.sourceDocumentId ?? 'doc-1',
      sourceDocumentFilename: 'PV réunion 12.pdf',
      sourceDocumentType: overrides.sourceDocumentType === undefined ? 'historical_pdf' : overrides.sourceDocumentType,
      sourceDocumentEffectiveDate: '2026-03-01',
      sourcePage: 3,
      sourceExcerpt: 'Le sprinkler zone A doit être vérifié avant le 15 mars.',
      hasVerbatimExcerpt: true,
      sourceDate: '2026-03-05T10:00:00.000Z',
      targets: [traceTarget()],
      targetCount: 1,
      evidenceScopeStatus: 'ACTIONABLE',
    },
  } as MemoriaNeedsYouQuestion
}

function confirmTrackabilityQuestion(overrides: {
  sourceDocumentId?: string | null
  sourceDocumentType?: string | null
} = {}): MemoriaNeedsYouQuestion {
  return {
    category: 'confirm_trackability',
    id: 'pending-1',
    entry: {
      pendingTraceId: 'pending-1',
      sourceThreadId: 'thread-2',
      siteId: 'site-42',
      subjectId: null,
      subjectLabel: 'Extincteurs',
      reason: null,
      createdAt: null,
      evidenceStatus: 'resolved',
      evidenceProposalIds: ['prop-2'],
      sourceLabel: 'Extincteur manquant hall B',
      sourceDate: '2026-02-10T00:00:00.000Z',
      sourceDocumentId: overrides.sourceDocumentId ?? null,
      sourceDocumentFilename: overrides.sourceDocumentId ? 'PV réunion 8.pdf' : null,
      sourceDocumentType: overrides.sourceDocumentType ?? null,
      sourceDocumentEffectiveDate: '2026-02-08',
      sourcePage: 5,
      sourceExcerpt: null,
      hasVerbatimExcerpt: false,
      actionable: true,
    },
  } as MemoriaNeedsYouQuestion
}

function assignResolutionQuestion(): MemoriaNeedsYouQuestion {
  return {
    category: 'assign_resolution',
    id: 'pending-4',
    entry: {
      pendingTraceId: 'pending-4',
      sourceThreadId: 'thread-4',
      evidenceStatus: 'resolved',
      evidenceBasis: 'human_selected',
      evidenceProposalIds: ['prop-4'],
      sourceLabel: 'Reprise étanchéité toiture',
      sourceDate: '2026-01-20T00:00:00.000Z',
      sourceDocumentId: null,
      sourceDocumentFilename: null,
      sourceDocumentType: null,
      sourceDocumentEffectiveDate: null,
      sourcePage: null,
      sourceExcerpt: null,
      hasVerbatimExcerpt: false,
      knownIdentityTargets: [],
      sameSubjectSuggestions: [],
      targetingMode: 'SEARCH_REQUIRED',
      actionable: true,
    },
  } as MemoriaNeedsYouQuestion
}

function pointSide(id: string, proofs: ConsolidationQueuePointSide['proofs'] = []): ConsolidationQueuePointSide {
  return {
    id,
    label: `Point ${id}`,
    status: 'active',
    identityStatus: 'CONFIRMED',
    derivedState: 'open',
    subjectId: null,
    subjectLabel: null,
    firstAppearanceAt: null,
    lastAppearanceAt: null,
    cboCount: 0,
    hardMemberCount: proofs.length,
    proofs,
    proofCount: proofs.length,
  }
}

function duplicatePointsQuestion(): MemoriaNeedsYouQuestion {
  return {
    category: 'duplicate_points',
    id: 'pair-1',
    entry: {
      pairId: 'pair-1',
      siteId: 'site-42',
      pointA: pointSide('a', [
        {
          proposalId: 'proof-1',
          documentId: 'doc-graph',
          documentFilename: 'PV réunion 4.pdf',
          documentType: 'historical_pdf',
          effectiveDate: '2026-01-10',
          sourcePage: 2,
          sourceExcerpt: 'Extrait de preuve.',
          extractedLabel: 'Extrait de preuve',
          hasVerbatimExcerpt: true,
          provenanceKind: 'hard_membership',
        },
      ]),
      pointB: pointSide('b'),
      candidateIds: ['cand-1'],
      reciprocal: false,
      componentId: 'a',
      componentSize: 2,
      predictedTargetPointId: null,
      predictedSourcePointId: null,
    },
  } as MemoriaNeedsYouQuestion
}

function clarifyEvidenceQuestion(): MemoriaNeedsYouQuestion {
  return {
    category: 'clarify_evidence',
    id: 'pending-3',
    entry: {
      pendingTraceId: 'pending-3',
      kind: 'TRACKABILITY_UNDETERMINED',
      sourceThreadId: 'thread-3',
      siteId: 'site-42',
      subjectId: null,
      subjectLabel: null,
      reason: null,
      createdAt: null,
      proposals: [
        {
          proposalId: 'proop-1',
          family: 'family-1',
          label: 'Information A',
          documentStatus: null,
          documentId: 'doc-litige',
          documentFilename: 'Litige toiture.pdf',
          documentType: 'litige',
          documentEffectiveDate: '2026-01-05',
          sourcePage: 1,
          sourceExcerpt: null,
          hasVerbatimExcerpt: false,
          createdAt: null,
          alreadySelected: false,
        },
        {
          proposalId: 'proop-2',
          family: 'family-1',
          label: 'Information B (source incomplète)',
          documentStatus: null,
          documentId: null,
          documentFilename: null,
          documentType: null,
          documentEffectiveDate: null,
          sourcePage: null,
          sourceExcerpt: null,
          hasVerbatimExcerpt: false,
          createdAt: null,
          alreadySelected: false,
        },
      ],
      proposalCount: 2,
    },
  } as MemoriaNeedsYouQuestion
}

const LINK_TEXT = 'Ouvrir le document source'

describe('NeedsYouCards — 6E.7 lien direct vers le document source', () => {
  it('preuve avec provenance documentaire complète (historical_pdf, siteId connu) -> href canonique = documentHref (fiche graphe du chantier)', () => {
    render(
      <QuestionCard
        question={attachInformationQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="IMPORTANT"
        runAction={noopRunAction}
      />,
    )

    const link = screen.getByRole('link', { name: new RegExp(LINK_TEXT) })
    const expectedHref = documentHref({ id: 'doc-1', document_type: 'historical_pdf' }, 'site-42')
    expect(link).toHaveAttribute('href', expectedHref)
    expect(expectedHref).toBe('/sites/site-42/document/doc-1')
  })

  it('document de type litige -> même décision que documentHref : visionneuse globale même si un siteId est connu', () => {
    render(
      <QuestionCard
        question={attachInformationQuestion({ sourceDocumentType: 'litige' })}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="IMPORTANT"
        runAction={noopRunAction}
      />,
    )

    const link = screen.getByRole('link', { name: new RegExp(LINK_TEXT) })
    const expectedHref = documentHref({ id: 'doc-1', document_type: 'litige' }, 'site-42')
    expect(link).toHaveAttribute('href', expectedHref)
    expect(expectedHref).toBe('/documents/doc-1')
  })

  it('aucun lien et aucun fragment/query de page inventé sur les hrefs rendus', () => {
    render(
      <QuestionCard
        question={attachInformationQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="IMPORTANT"
        runAction={noopRunAction}
      />,
    )

    const link = screen.getByRole('link', { name: new RegExp(LINK_TEXT) })
    const href = link.getAttribute('href') ?? ''
    expect(href).not.toContain('#')
    expect(href).not.toContain('?')
    expect(href).not.toContain('page')
  })

  it('page toujours affichée en texte, jamais absorbée dans le lien', () => {
    render(
      <QuestionCard
        question={attachInformationQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="IMPORTANT"
        runAction={noopRunAction}
      />,
    )

    expect(screen.getByText(/page 3/)).toBeInTheDocument()
  })

  it("provenance insuffisante (documentType inconnu) -> aucun faux lien, le nom du document reste affiché en texte", () => {
    render(
      <QuestionCard
        question={confirmTrackabilityQuestion({ sourceDocumentId: 'doc-9', sourceDocumentType: null })}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="A_CLARIFIER"
        runAction={noopRunAction}
      />,
    )

    expect(screen.queryByRole('link', { name: new RegExp(LINK_TEXT) })).not.toBeInTheDocument()
    expect(screen.getByText(/PV réunion 8\.pdf/)).toBeInTheDocument()
  })

  it('confirm_trackability sans aucune donnée de document ne casse pas et ne rend aucun lien', () => {
    render(
      <QuestionCard
        question={confirmTrackabilityQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="HISTORIQUE"
        runAction={noopRunAction}
      />,
    )

    expect(screen.queryByRole('link', { name: new RegExp(LINK_TEXT) })).not.toBeInTheDocument()
  })

  it('PointProofDisclosure (duplicate_points) ouvre sur la même primitive documentHref une fois les preuves révélées', () => {
    render(
      <QuestionCard
        question={duplicatePointsQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="IMPORTANT"
        runAction={noopRunAction}
      />,
    )

    expect(screen.queryByRole('link', { name: new RegExp(LINK_TEXT) })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Voir les preuves/ }))

    const link = screen.getByRole('link', { name: new RegExp(LINK_TEXT) })
    const expectedHref = documentHref({ id: 'doc-graph', document_type: 'historical_pdf' }, 'site-42')
    expect(link).toHaveAttribute('href', expectedHref)
  })

  it('clarify_evidence : chaque proposition de la liste inline décide indépendamment via documentHref, provenance insuffisante -> pas de lien pour cette entrée seulement', () => {
    render(
      <QuestionCard
        question={clarifyEvidenceQuestion()}
        siteId="site-42"
        pending={false}
        sitePoints={[]}
        priority="A_CLARIFIER"
        runAction={noopRunAction}
      />,
    )

    const links = screen.getAllByRole('link', { name: new RegExp(LINK_TEXT) })
    expect(links).toHaveLength(1)
    const expectedHref = documentHref({ id: 'doc-litige', document_type: 'litige' }, 'site-42')
    expect(links[0]).toHaveAttribute('href', expectedHref)

    const secondItem = screen.getByText('Information B (source incomplète)').closest('label') as HTMLElement
    expect(within(secondItem).queryByRole('link', { name: new RegExp(LINK_TEXT) })).not.toBeInTheDocument()
  })

  it('les 5 catégories de carte continuent de se rendre sans lever d exception (compilation des chemins existants)', () => {
    const questions: MemoriaNeedsYouQuestion[] = [
      duplicatePointsQuestion(),
      attachInformationQuestion(),
      confirmTrackabilityQuestion(),
      assignResolutionQuestion(),
      clarifyEvidenceQuestion(),
    ]

    for (const question of questions) {
      const { unmount } = render(
        <QuestionCard
          question={question}
          siteId="site-42"
          pending={false}
          sitePoints={[]}
          priority="HISTORIQUE"
          runAction={noopRunAction}
        />,
      )
      unmount()
    }
  })
})
