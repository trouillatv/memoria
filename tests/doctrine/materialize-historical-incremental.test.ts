import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/415_incremental_historical_visit_materialization.sql'),
  'utf8',
)

const reviewActions = readFileSync(
  resolve(process.cwd(), 'app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts'),
  'utf8',
)

describe('materialisation historique incrementale', () => {
  it('ne transforme pas "creer la visite" en "tout accepter"', () => {
    const createAction = reviewActions.match(
      /export async function createHistoricalVisitAction[\s\S]*?export async function retryMemoryBuildAction/,
    )?.[0] ?? ''

    expect(createAction).toContain('materializeHistoricalRun')
    expect(createAction).not.toContain('acceptAllPendingForRun')
  })

  it('reutilise un site_report existant au lieu de retourner sans rien faire', () => {
    expect(migration).toContain('IF v_report_id IS NULL THEN')
    expect(migration).toContain('materialiser')
    expect(migration).not.toContain('IF FOUND THEN RETURN v_report_id; END IF;')
  })

  it('ne materialise que les propositions accepted/edited sans lien existant', () => {
    expect(migration).toContain("review_status IN ('accepted', 'edited')")
    expect(migration).toContain('proposal_family NOT IN')
    expect(migration).toContain('document_proposal_materialization dpm')
    expect(migration).toContain('dpm.proposal_id = document_extraction_proposal.id')
  })

  it('declenche la materialisation tardive apres acceptation ou edition explicite', () => {
    const acceptAction = reviewActions.match(
      /export async function acceptProposalAction[\s\S]*?export async function editProposalAction/,
    )?.[0] ?? ''
    const editAction = reviewActions.match(
      /export async function editProposalAction[\s\S]*?export async function rejectProposalAction/,
    )?.[0] ?? ''

    expect(acceptAction).toContain('reviewProposal(proposalId, { action: \'accept\' }')
    expect(acceptAction).toContain('materializeReviewedProposalIfVisitExists')
    expect(editAction).toContain('reviewProposal(')
    expect(editAction).toContain('materializeReviewedProposalIfVisitExists')
  })

  it('rend le post-processing rejouable quand une nouvelle materialisation est produite', () => {
    expect(reviewActions).toContain('materializedSomething')
    expect(reviewActions).toContain('canonical_reconciled_at: null')
    expect(reviewActions).toContain('similarity_analysis_completed_at: null')
    expect(reviewActions).toContain('runHistoricalImportPostProcessing')
  })

  it('laisse les pending hors memoire sans bloquer le post-processing des propositions decidees', () => {
    const postProcessing = readFileSync(
      resolve(process.cwd(), 'lib/subjects/historical-import-post-processing.ts'),
      'utf8',
    )
    const canonicalReconcile = readFileSync(
      resolve(process.cwd(), 'lib/db/canonical-subject-historical-reconcile.ts'),
      'utf8',
    )
    const occurrences = readFileSync(
      resolve(process.cwd(), 'lib/db/canonical-subject-historical-occurrence.ts'),
      'utf8',
    )
    const liveWriter = readFileSync(
      resolve(process.cwd(), 'lib/db/tracked-point-live-writer-historical-adapter.ts'),
      'utf8',
    )

    expect(postProcessing).not.toContain('pendingReview > 0')
    expect(postProcessing).not.toContain('Revue historique incomplete')
    for (const source of [canonicalReconcile, occurrences, liveWriter]) {
      expect(source).toContain(".in('review_status', ['accepted', 'edited', 'materialized'])")
    }
  })
})
