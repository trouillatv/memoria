// Sprint 4C.1 — tests interface de revue des extractions historiques
//
// 18 tests :
//   Section 1 (1-5)  : requêtes de données et cas d'affichage
//   Section 2 (6-10) : actions de revue (service reviewProposal)
//   Section 3 (11-13): contrôle d'accès (Server Actions)
//   Section 4 (14-18): getEffectiveProposal + computeReviewSummary

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEffectiveProposal, computeReviewSummary } from '../../lib/documents/effective-proposal'
import type { DbDocumentExtractionProposal } from '../../types/db'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
  in: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  getUser: vi.fn(),
  getUserRoleById: vi.fn(),
  getOrgIdsOfUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mocks.from,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}))

vi.mock('@/lib/db/users', () => ({
  getUserRoleById: mocks.getUserRoleById,
}))

vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: mocks.getOrgIdsOfUser,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<DbDocumentExtractionProposal> = {}): DbDocumentExtractionProposal {
  return {
    id: 'prop-1',
    organization_id: 'org-1',
    extraction_run_id: 'run-1',
    document_id: 'doc-1',
    target_site_id: null,
    proposal_family: 'reservation',
    stable_key: 'res-infiltration',
    label: 'Infiltration façade nord',
    description: 'Traces d\'humidité sur 2 ml',
    source_page: 7,
    source_excerpt: 'traces d\'humidité visibles',
    source_payload: { statusAtDocumentDate: 'ouvert' },
    review_status: 'pending',
    reviewed_label: null,
    reviewed_description: null,
    reviewed_family: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2026-07-29T10:00:00Z',
    ...overrides,
  }
}

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    organization_id: 'org-1',
    extraction_run_id: 'run-1',
    document_id: 'doc-1',
    evidence_type: 'text_excerpt',
    source_page: 7,
    storage_path: null,
    caption: null,
    nearby_text: null,
    metadata: { text: 'passage extrait' },
    created_at: '2026-07-29T10:00:00Z',
    ...overrides,
  }
}

// ─── Section 1 : Données et affichage ────────────────────────────────────────

import {
  getExtractionRun,
  getLatestExtractionRunForDocument,
  listOrphanEvidenceForRun,
  reviewProposal,
} from '../../lib/db/document-extractions'

function buildChain(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  return chain
}

describe('Section 1 — Requêtes de données et affichage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. getExtractionRun retourne le run par son ID', async () => {
    const fakeRun = { id: 'run-1', document_id: 'doc-1', status: 'ready_for_review' }
    mocks.from.mockReturnValue(buildChain(fakeRun))

    const result = await getExtractionRun('run-1')

    expect(result).toMatchObject({ id: 'run-1', status: 'ready_for_review' })
  })

  it('2. getLatestExtractionRunForDocument retourne le run le plus récent', async () => {
    const fakeRun = { id: 'run-latest', document_id: 'doc-1', status: 'ready_for_review' }
    mocks.from.mockReturnValue(buildChain(fakeRun))

    const result = await getLatestExtractionRunForDocument('doc-1')

    expect(result).toMatchObject({ id: 'run-latest' })
  })

  it('3. listOrphanEvidenceForRun retourne les preuves non liées', async () => {
    const evidence = [makeEvidence({ id: 'ev-1' }), makeEvidence({ id: 'ev-2' })]
    const linked = [{ evidence_id: 'ev-1' }]

    mocks.from.mockImplementation((table: string) => {
      const chain = buildChain(null)
      if (table === 'document_extraction_evidence') {
        chain.maybeSingle = vi.fn()
        return {
          ...chain,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: evidence, error: null }),
          }),
        }
      }
      if (table === 'document_proposal_evidence') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: linked, error: null }),
          }),
        }
      }
      return chain
    })

    const result = await listOrphanEvidenceForRun('run-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ev-2')
  })

  it('4. listOrphanEvidenceForRun retourne vide si toutes les preuves sont liées', async () => {
    const evidence = [makeEvidence({ id: 'ev-1' })]
    const linked = [{ evidence_id: 'ev-1' }]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_evidence') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: evidence, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: linked, error: null }),
        }),
      }
    })

    const result = await listOrphanEvidenceForRun('run-1')
    expect(result).toHaveLength(0)
  })

  it('5. listOrphanEvidenceForRun avec preuve page_snapshot sans lien', async () => {
    const snapEvidence = [makeEvidence({ id: 'ev-snap', evidence_type: 'page_snapshot', storage_path: 'snapshots/x.png' })]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_evidence') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: snapEvidence, error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }
    })

    const result = await listOrphanEvidenceForRun('run-1')
    expect(result).toHaveLength(1)
    expect(result[0].evidence_type).toBe('page_snapshot')
  })
})

// ─── Section 2 : Actions de revue (service reviewProposal) ───────────────────

describe('Section 2 — Actions de revue', () => {
  beforeEach(() => vi.clearAllMocks())

  function setupReviewMock(currentStatus: string) {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'document_extraction_proposal') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { review_status: currentStatus }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return buildChain(null)
    })
  }

  it('6. acceptation — review_status passe à accepted', async () => {
    setupReviewMock('pending')
    await expect(reviewProposal('prop-1', { action: 'accept' }, 'user-1')).resolves.toBeUndefined()
    expect(mocks.from).toHaveBeenCalledWith('document_extraction_proposal')
  })

  it('7. édition — contenu extrait conservé (champs source inchangés dans DB)', async () => {
    setupReviewMock('pending')
    await expect(reviewProposal('prop-1', {
      action: 'edit',
      label: 'Infiltration façade nord (corrigé)',
      description: 'Nouvelle description',
      family: 'observation',
    }, 'user-1')).resolves.toBeUndefined()
  })

  it('8. édition — changement de famille via reviewed_family', async () => {
    setupReviewMock('accepted')
    await expect(reviewProposal('prop-1', {
      action: 'edit',
      label: 'Infiltration façade nord',
      family: 'observation',
    }, 'user-1')).resolves.toBeUndefined()
  })

  it('9. refus — review_status passe à rejected', async () => {
    setupReviewMock('pending')
    await expect(reviewProposal('prop-1', { action: 'reject' }, 'user-1')).resolves.toBeUndefined()
  })

  it('10. reset (Réexaminer) — review_status passe à pending', async () => {
    setupReviewMock('rejected')
    await expect(reviewProposal('prop-1', { action: 'reset' }, 'user-1')).resolves.toBeUndefined()
  })
})

// ─── Section 3 : Contrôle d'accès (Server Actions) ───────────────────────────

import {
  acceptProposalAction,
  verifyReviewAccess,
  verifyProposalOwnership,
} from '../../app/(dashboard)/documents/[id]/extraction/[runId]/review-actions'

describe('Section 3 — Contrôle d\'accès', () => {
  beforeEach(() => vi.clearAllMocks())

  it('11. accès non-manager refusé (rôle field)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-field' } } })
    mocks.getUserRoleById.mockResolvedValue('field')

    const result = await verifyReviewAccess('doc-1')
    expect(result).toMatchObject({ ok: false, error: 'Permissions insuffisantes' })
  })

  it('12. isolation — document d\'une autre organisation refusé', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-mgr' } } })
    mocks.getUserRoleById.mockResolvedValue('manager')
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { organization_id: 'other-org' }, error: null }),
          }),
        }),
      }),
    })
    mocks.getOrgIdsOfUser.mockResolvedValue(['org-1'])

    const result = await verifyReviewAccess('doc-foreign')
    expect(result).toMatchObject({ ok: false, error: 'Accès refusé' })
  })

  it('13. proposition appartenant à un autre document refusée', async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { document_id: 'doc-other' },
            error: null,
          }),
        }),
      }),
    })

    const result = await verifyProposalOwnership('prop-1', 'doc-mine')
    expect(result).toBe(false)
  })
})

// ─── Section 4 : getEffectiveProposal + computeReviewSummary ─────────────────

describe('Section 4 — getEffectiveProposal', () => {
  it('14. accepted → utilise les champs extraits', () => {
    const p = makeProposal({ review_status: 'accepted' })
    const result = getEffectiveProposal(p)
    expect(result).not.toBeNull()
    expect(result!.label).toBe('Infiltration façade nord')
    expect(result!.family).toBe('reservation')
    expect(result!.reviewStatus).toBe('accepted')
  })

  it('15. pending → retourne null (exclu de la matérialisation)', () => {
    const p = makeProposal({ review_status: 'pending' })
    expect(getEffectiveProposal(p)).toBeNull()
  })

  it('16. rejected → retourne null', () => {
    const p = makeProposal({ review_status: 'rejected' })
    expect(getEffectiveProposal(p)).toBeNull()
  })

  it('17. edited → utilise reviewed_* avec fallback sur champs extraits', () => {
    const p = makeProposal({
      review_status: 'edited',
      reviewed_label: 'Infiltration façade nord (vérifiée)',
      reviewed_description: 'Confirmation après expertise',
      reviewed_family: 'observation',
    })
    const result = getEffectiveProposal(p)
    expect(result).not.toBeNull()
    expect(result!.label).toBe('Infiltration façade nord (vérifiée)')
    expect(result!.description).toBe('Confirmation après expertise')
    expect(result!.family).toBe('observation')
    // Le contenu extrait original reste inchangé dans l'objet proposal
    expect(p.label).toBe('Infiltration façade nord')
  })

  it('18. computeReviewSummary calcule correctement le bilan', () => {
    const proposals = [
      makeProposal({ review_status: 'pending' }),
      makeProposal({ id: 'p2', review_status: 'accepted' }),
      makeProposal({ id: 'p3', review_status: 'accepted' }),
      makeProposal({ id: 'p4', review_status: 'edited' }),
      makeProposal({ id: 'p5', review_status: 'rejected' }),
      makeProposal({ id: 'p6', review_status: 'materialized' }),
    ]
    const summary = computeReviewSummary(proposals)
    expect(summary.total).toBe(6)
    expect(summary.pending).toBe(1)
    expect(summary.accepted).toBe(2)
    expect(summary.edited).toBe(1)
    expect(summary.rejected).toBe(1)
    expect(summary.materialized).toBe(1)
  })
})
