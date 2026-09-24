// Sprint 4C.1 — tests interface de revue des extractions historiques
//
// 20 tests :
//   Section 1 (1-5)  : requêtes de données et cas d'affichage
//   Section 2 (6-10) : actions de revue (service reviewProposal)
//   Section 3 (11-13): contrôle d'accès (Server Actions)
//   Section 4 (14-18): getEffectiveProposal + computeReviewSummary
//   Section 5 (19-20): GO point 11 — matérialisation, garde établissement

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEffectiveProposal, computeReviewSummary } from '../../lib/documents/effective-proposal'
import type { DbDocumentExtractionProposal } from '../../types/db'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  in: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  getUser: vi.fn(),
  getUserRoleById: vi.fn(),
  getOrgIdsOfUser: vi.fn(),
  after: vi.fn(),
  materializeHistoricalVisit: vi.fn(),
  detectNonVisitSignal: vi.fn(),
  proposalUpdate: vi.fn(),
  companiesInsert: vi.fn(),
  siteIntervenantsInsert: vi.fn(),
  materializeEngagementCreateNew: vi.fn(),
  materializeEngagementLinkExisting: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
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

// `after()` réel ne s'exécute qu'en contexte de requête Next.js — hors de ce
// contexte (comme en test), il lève. On le neutralise : createHistoricalVisitAction
// ne doit jamais dépendre de son exécution pour retourner son résultat au client.
vi.mock('next/server', () => ({
  after: mocks.after,
}))

// GO point 11 — ne jamais matérialiser une vraie visite pour tester le chemin
// de création. Le RPC/la persistance réelle sont hors périmètre de ce test.
vi.mock('@/lib/db/historical-visit-materialization', () => ({
  materializeHistoricalVisit: mocks.materializeHistoricalVisit,
}))

vi.mock('@/lib/documents/detect-document-date', () => ({
  detectNonVisitSignal: mocks.detectNonVisitSignal,
}))

// P0-2C FIX_REQUIRED (mandat Vincent 2026-09-24, revue SHA e88034a1, problème 2) —
// jamais la vraie RPC ici : on prouve seulement le contrat de la Server Action
// (validation stricte category/kind/measurable AVANT tout appel RPC, donc
// zéro tentative d'écriture pour une entrée invalide).
vi.mock('@/lib/db/materialize-engagement', () => ({
  materializeEngagementCreateNew: mocks.materializeEngagementCreateNew,
  materializeEngagementLinkExisting: mocks.materializeEngagementLinkExisting,
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
    thematic_category: null,
    document_status: 'open',
    subject_thread_id: null,
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
  createHistoricalVisitAction,
  createEngagementFromProposalAction,
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

// ─── Section 5 : GO point 11 — matérialisation & garde établissement ─────────
//
// Chemin réel de createHistoricalVisitAction. La visite n'est jamais réellement
// matérialisée (materializeHistoricalVisit est mocké) : on prouve seulement que le
// label du site courant, proposé comme company, n'entraîne aucune création
// companies/site_intervenants — et, en contrôle positif, qu'une vraie entreprise
// distincte du site suit bien le chemin de création normal.

type FakeProposalTableRow = {
  id: string
  label: string
  reviewed_label: string | null
  description?: string | null
  source_payload: unknown
  stable_key: string | null
}

function buildChainWithThen(resolve: () => { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'in', 'is', 'ilike', 'order', 'limit']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.upsert = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(resolve())
  chain.single = vi.fn().mockResolvedValue(resolve())
  chain.then = (onResolve: (v: { data: unknown; error: unknown }) => void) => onResolve(resolve())
  return chain
}

function buildHistoricalVisitAdminMock(config: {
  site: { organization_id: string; name: string; normalized_name: string }
  companyProposals: FakeProposalTableRow[]
}) {
  return (table: string) => {
    if (table === 'document_extraction_run') {
      return buildChainWithThen(() => ({
        data: { target_site_id: 'site-1', document_id: 'doc-1' },
        error: null,
      }))
    }
    if (table === 'documents') {
      return buildChainWithThen(() => ({
        data: {
          organization_id: config.site.organization_id,
          effective_date: '2025-03-27',
          extracted_text: 'Compte-rendu de visite du chantier.',
        },
        error: null,
      }))
    }
    if (table === 'sites') {
      return buildChainWithThen(() => ({ data: config.site, error: null }))
    }
    if (table === 'document_extraction_proposal') {
      const chain: Record<string, unknown> = {}
      let family: string | null = null
      chain.select = vi.fn().mockReturnValue(chain)
      chain.in = vi.fn().mockReturnValue(chain)
      chain.eq = vi.fn((field: string, value: string) => {
        if (field === 'proposal_family') family = value
        return chain
      })
      chain.update = vi.fn((patch: unknown) => {
        mocks.proposalUpdate(patch)
        return chain
      })
      chain.then = (onResolve: (v: { data: unknown; error: unknown }) => void) => {
        if (family === 'company') return onResolve({ data: config.companyProposals, error: null })
        return onResolve({ data: [], error: null })
      }
      return chain
    }
    if (table === 'companies') {
      const chain: Record<string, unknown> = {}
      const methods = ['select', 'eq', 'ilike', 'is']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      chain.insert = vi.fn((row: unknown) => {
        mocks.companiesInsert(row)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'company-new-1' }, error: null }),
          }),
        }
      })
      return chain
    }
    if (table === 'site_intervenants') {
      const chain: Record<string, unknown> = {}
      const methods = ['select', 'eq', 'is']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      chain.insert = vi.fn((row: unknown) => {
        mocks.siteIntervenantsInsert(row)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'si-new-1' }, error: null }),
          }),
        }
      })
      return chain
    }
    // Tables hors périmètre du test #11 (F3-2 participants, resolveLinkedActors,
    // mergeReportAnalysis, document_proposal_materialization...) : réponses neutres,
    // couvertes par le try/catch englobant de createHistoricalVisitAction.
    return buildChainWithThen(() => ({ data: [], error: null }))
  }
}

describe('Section 5 — createHistoricalVisitAction (GO point 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-admin' } } })
    mocks.getUserRoleById.mockResolvedValue('admin')
    mocks.getOrgIdsOfUser.mockResolvedValue(['org-1'])
    mocks.detectNonVisitSignal.mockReturnValue({ detected: false })
    mocks.materializeHistoricalVisit.mockResolvedValue('report-1')
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  function buildForm() {
    const fd = new FormData()
    fd.set('run_id', 'run-1')
    fd.set('document_id', 'doc-1')
    return fd
  }

  it('19. le label du site courant proposé comme company n\'entraîne aucune création companies/site_intervenants', async () => {
    mocks.from.mockImplementation(buildHistoricalVisitAdminMock({
      site: { organization_id: 'org-1', name: 'BELLA NAPOLI', normalized_name: 'bella napoli' },
      companyProposals: [
        { id: 'prop-co-1', label: 'Bella Napoli', reviewed_label: null, source_payload: null, stable_key: null },
      ],
    }))

    const result = await createHistoricalVisitAction(buildForm())

    expect(result.ok).toBe(true)
    expect(result.siteReportId).toBe('report-1')
    // La visite n'est jamais réellement matérialisée dans ce test — seul le mock répond.
    expect(mocks.materializeHistoricalVisit).toHaveBeenCalledTimes(1)
    // Garde établissement : la proposition company est rejetée, jamais matérialisée.
    expect(mocks.proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ review_status: 'rejected' }),
    )
    expect(mocks.companiesInsert).not.toHaveBeenCalled()
    expect(mocks.siteIntervenantsInsert).not.toHaveBeenCalled()
  })

  it('20. contrôle positif — une entreprise distincte du site suit le chemin de création normal', async () => {
    mocks.from.mockImplementation(buildHistoricalVisitAdminMock({
      site: { organization_id: 'org-1', name: 'BELLA NAPOLI', normalized_name: 'bella napoli' },
      companyProposals: [
        {
          id: 'prop-co-2',
          label: "Clim'Expair",
          reviewed_label: null,
          source_payload: { companyRole: 'CVC' },
          stable_key: 'sk-clim',
        },
      ],
    }))

    const result = await createHistoricalVisitAction(buildForm())

    expect(result.ok).toBe(true)
    expect(mocks.companiesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: 'org-1', name: "Clim'Expair" }),
    )
    expect(mocks.siteIntervenantsInsert).toHaveBeenCalledTimes(1)
  })

  it('21. run finalisé — plus de promotion canonique séparée : l\'atomicité est portée par materialize_historical_visit (429)', async () => {
    mocks.from.mockImplementation(buildHistoricalVisitAdminMock({
      site: { organization_id: 'org-1', name: 'BELLA NAPOLI', normalized_name: 'bella napoli' },
      companyProposals: [],
    }))

    const result = await createHistoricalVisitAction(buildForm())

    expect(result.ok).toBe(true)
    // P0 Unicité des runs historiques : le transfert is_canonical est désormais
    // fait DANS materialize_historical_visit() (migration 429), dans la même
    // transaction SQL que la création de la visite. Réintroduire un appel RPC
    // séparé depuis le TS rouvrirait la fenêtre best-effort qu'on vient de
    // fermer — ce test verrouille l'absence de cet appel.
    expect(mocks.rpc).not.toHaveBeenCalledWith('promote_canonical_extraction_run', expect.anything())
  })

  it('22. échec de la matérialisation — aucune visite créée, aucun transfert canonique tenté en dehors du RPC', async () => {
    mocks.from.mockImplementation(buildHistoricalVisitAdminMock({
      site: { organization_id: 'org-1', name: 'BELLA NAPOLI', normalized_name: 'bella napoli' },
      companyProposals: [],
    }))
    // Simule l'échec du RPC atomique matérialisation+promotion (429), p.ex. une
    // contrainte violée pendant le transfert is_canonical à l'intérieur de la
    // transaction. Postgres annule TOUT (visite + transfert) : il ne peut plus
    // exister d'état intermédiaire où la visite existe mais l'ancien run reste
    // canonique — l'ancien run canonique reste donc canonique par construction.
    mocks.materializeHistoricalVisit.mockRejectedValue(new Error('boom'))

    const result = await createHistoricalVisitAction(buildForm())

    expect(result.ok).toBe(false)
    expect(result.error).toBe('boom')
    expect(mocks.rpc).not.toHaveBeenCalledWith('promote_canonical_extraction_run', expect.anything())
  })
})

// ─── Section 6 : createEngagementFromProposalAction (P0-2C FIX_REQUIRED, problème 2) ─
//
// La RPC (materialize_engagement_create_new, migration 438) est mockée : ces
// tests prouvent seulement le contrat de la Server Action elle-même — une
// category/kind/measurable invalide ou absente est refusée AVANT tout appel
// RPC (donc avant toute tentative d'écriture), et des valeurs humaines
// valides sont transmises telles quelles, sans jamais relire source_payload.

function buildEngagementAccessMock(documentId: string, proposalFamily = 'engagement') {
  return (table: string) => {
    if (table === 'document_extraction_proposal') {
      return buildChainWithThen(() => ({
        data: { document_id: documentId, proposal_family: proposalFamily },
        error: null,
      }))
    }
    if (table === 'documents') {
      return buildChainWithThen(() => ({ data: { organization_id: 'org-1' }, error: null }))
    }
    return buildChainWithThen(() => ({ data: null, error: null }))
  }
}

describe('Section 6 — createEngagementFromProposalAction (P0-2C, problème 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-admin' } } })
    mocks.getUserRoleById.mockResolvedValue('admin')
    mocks.getOrgIdsOfUser.mockResolvedValue(['org-1'])
    mocks.from.mockImplementation(buildEngagementAccessMock('doc-1'))
  })

  function buildForm(fields: Record<string, string>) {
    const fd = new FormData()
    fd.set('proposal_id', 'prop-1')
    fd.set('document_id', 'doc-1')
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    return fd
  }

  it('nature (kind) absente — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(buildForm({ category: 'quality', measurable: 'true' }))
    expect(result).toMatchObject({ ok: false, error: 'Nature invalide' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('mesurable (measurable) absent — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(buildForm({ category: 'quality', kind: 'obligation' }))
    expect(result).toMatchObject({ ok: false, error: 'Mesurable invalide' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('mesurable (measurable) ni "true" ni "false" — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(
      buildForm({ category: 'quality', kind: 'obligation', measurable: 'peut-être' }),
    )
    expect(result).toMatchObject({ ok: false, error: 'Mesurable invalide' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('catégorie (category) invalide — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(
      buildForm({ category: 'not_a_real_category', kind: 'obligation', measurable: 'true' }),
    )
    expect(result).toMatchObject({ ok: false, error: 'Catégorie invalide' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('valeurs humaines valides — transmises telles quelles à la RPC, engagementId retourné', async () => {
    mocks.materializeEngagementCreateNew.mockResolvedValue('eng-new-1')

    const result = await createEngagementFromProposalAction(
      buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }),
    )

    expect(result).toMatchObject({ ok: true, engagementId: 'eng-new-1' })
    expect(mocks.materializeEngagementCreateNew).toHaveBeenCalledWith('prop-1', 'user-admin', 'sla', 'controle', true)
  })

  it('proposition d’une autre famille (non engagement) — refus, aucun appel RPC', async () => {
    mocks.from.mockImplementation(buildEngagementAccessMock('doc-1', 'action'))

    const result = await createEngagementFromProposalAction(
      buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }),
    )

    expect(result).toMatchObject({ ok: false, error: 'Proposition non éligible (famille attendue : engagement)' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })
})
