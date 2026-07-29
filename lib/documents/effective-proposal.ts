// Calcul de la proposition effective pour Sprint 4C.2 (matérialisation).
// Règles :
//   accepted    → champs extraits (immuables)
//   edited      → champs reviewed_* avec fallback sur extraits
//   rejected    → exclu (null)
//   pending     → exclu de toute matérialisation (null)
//   materialized → consultable (champs extraits)
//
// Fonctions pures — pas de 'server-only', utilisables côté client aussi.

import type { DbDocumentExtractionProposal, DocumentProposalFamily, DocumentProposalReviewStatus } from '@/types/db'

export interface EffectiveDocumentProposal {
  id: string
  family: DocumentProposalFamily
  label: string
  description: string | null
  reviewStatus: DocumentProposalReviewStatus
  sourcePage: number | null
  sourceExcerpt: string | null
  sourcePayload: unknown
}

export function getEffectiveProposal(
  proposal: DbDocumentExtractionProposal,
): EffectiveDocumentProposal | null {
  if (proposal.review_status === 'rejected' || proposal.review_status === 'pending') {
    return null
  }

  if (proposal.review_status === 'edited') {
    return {
      id: proposal.id,
      family: (proposal.reviewed_family ?? proposal.proposal_family) as DocumentProposalFamily,
      label: proposal.reviewed_label ?? proposal.label,
      description: proposal.reviewed_description ?? proposal.description,
      reviewStatus: proposal.review_status,
      sourcePage: proposal.source_page,
      sourceExcerpt: proposal.source_excerpt,
      sourcePayload: proposal.source_payload,
    }
  }

  // accepted, materialized, failed — champs extraits
  return {
    id: proposal.id,
    family: proposal.proposal_family as DocumentProposalFamily,
    label: proposal.label,
    description: proposal.description,
    reviewStatus: proposal.review_status,
    sourcePage: proposal.source_page,
    sourceExcerpt: proposal.source_excerpt,
    sourcePayload: proposal.source_payload,
  }
}

export interface ReviewSummary {
  total: number
  pending: number
  accepted: number
  edited: number
  rejected: number
  materialized: number
}

export function computeReviewSummary(proposals: DbDocumentExtractionProposal[]): ReviewSummary {
  const summary: ReviewSummary = { total: proposals.length, pending: 0, accepted: 0, edited: 0, rejected: 0, materialized: 0 }
  for (const p of proposals) {
    const key = p.review_status as keyof ReviewSummary
    if (key in summary) (summary[key] as number)++
  }
  return summary
}
