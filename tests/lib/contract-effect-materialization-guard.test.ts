// DOC-CONTRACT-OS-1A — FIX de fermeture (mandat Vincent 2026-09-28). La structure
// EFFET × TEMPORALITÉ (SHA 31473dfe) est validée ; ce fichier teste les invariants
// serveur ajoutés par le fix : setContractEffectAction applique les règles métier
// côté serveur (pas seulement l'UI ProposalCard), et createEngagementFromProposalAction
// / linkEngagementToProposalAction ne dépendent jamais uniquement du garde client
// (canMaterializeEngagement) pour bloquer une matérialisation interdite par l'effet
// qualifié. Le bulk finalizer est couvert séparément dans
// tests/lib/finalize-accepted-engagements.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  getUserRoleById: vi.fn(),
  getOrgIdsOfUser: vi.fn(),
  materializeEngagementCreateNew: vi.fn(),
  materializeEngagementLinkExisting: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))

vi.mock('@/lib/db/users', () => ({
  getUserRoleById: mocks.getUserRoleById,
}))

vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: mocks.getOrgIdsOfUser,
}))

// Seule la Server Action est sous test : la vraie RPC (migration 436/438) est
// hors périmètre, comme dans tests/lib/historical-visit-review.test.ts Section 6.
vi.mock('@/lib/db/materialize-engagement', () => ({
  materializeEngagementCreateNew: mocks.materializeEngagementCreateNew,
  materializeEngagementLinkExisting: mocks.materializeEngagementLinkExisting,
  finalizeAcceptedEngagementsForRun: vi.fn(),
}))

import {
  setContractEffectAction,
  createEngagementFromProposalAction,
  linkEngagementToProposalAction,
} from '../../app/(dashboard)/documents/[id]/extraction/[runId]/review-actions'

// ─── Helpers (même convention que historical-visit-review.test.ts) ────────────

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

function buildForm(fields: Record<string, string>) {
  const fd = new FormData()
  fd.set('proposal_id', 'prop-1')
  fd.set('document_id', 'doc-1')
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function buildAccessMock(config: {
  documentId?: string
  proposalFamily?: string
  targetSiteId?: string | null
  sourcePayload?: Record<string, unknown>
  targetEngagementSiteId?: string
} = {}) {
  const {
    documentId = 'doc-1',
    proposalFamily = 'engagement',
    targetSiteId = null,
    sourcePayload = {},
    targetEngagementSiteId = 'site-1',
  } = config
  return (table: string) => {
    if (table === 'documents') {
      return buildChainWithThen(() => ({ data: { organization_id: 'org-1' }, error: null }))
    }
    if (table === 'document_extraction_proposal') {
      return buildChainWithThen(() => ({
        data: {
          document_id: documentId,
          proposal_family: proposalFamily,
          target_site_id: targetSiteId,
          source_payload: sourcePayload,
        },
        error: null,
      }))
    }
    if (table === 'engagements') {
      return buildChainWithThen(() => ({ data: { site_id: targetEngagementSiteId }, error: null }))
    }
    return buildChainWithThen(() => ({ data: null, error: null }))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-admin' } } })
  mocks.getUserRoleById.mockResolvedValue('admin')
  mocks.getOrgIdsOfUser.mockResolvedValue(['org-1'])
  mocks.from.mockImplementation(buildAccessMock())
})

// ─── setContractEffectAction — invariants métier côté serveur ─────────────────
// Ces invariants sont vérifiés AVANT tout accès DB/auth (cf. review-actions.ts) :
// aucun mock d'accès n'est nécessaire pour prouver le refus.

describe('setContractEffectAction — invariants EFFET × TEMPORALITÉ (DOC-CONTRACT-OS-1A)', () => {
  it('suspend sans cible — refus', async () => {
    const result = await setContractEffectAction(buildForm({ effect: 'suspend', temporality: 'permanent' }))
    expect(result).toEqual({ ok: false, error: 'Cet effet nécessite un Engagement cible' })
  })

  it('confirm sans cible — refus', async () => {
    const result = await setContractEffectAction(buildForm({ effect: 'confirm', temporality: 'permanent' }))
    expect(result).toEqual({ ok: false, error: 'Cet effet nécessite un Engagement cible' })
  })

  it('bounded sans dates — refus', async () => {
    const result = await setContractEffectAction(buildForm({ effect: 'new', temporality: 'bounded' }))
    expect(result).toEqual({ ok: false, error: 'Une temporalité bornée nécessite une date de début et de fin' })
  })

  it('starts_on postérieur à ends_on — refus', async () => {
    const result = await setContractEffectAction(buildForm({
      effect: 'new', temporality: 'permanent', starts_on: '2026-05-10', ends_on: '2026-05-01',
    }))
    expect(result).toEqual({ ok: false, error: 'La date de début doit précéder ou égaler la date de fin' })
  })

  it('resume_on antérieur à ends_on — refus', async () => {
    const result = await setContractEffectAction(buildForm({
      effect: 'new', temporality: 'permanent', ends_on: '2026-05-10', resume_on: '2026-05-01',
    }))
    expect(result).toEqual({ ok: false, error: 'La date de reprise ne peut pas précéder la date de fin' })
  })

  it('qualification valide — enregistrée normalement', async () => {
    const result = await setContractEffectAction(buildForm({ effect: 'new', temporality: 'permanent' }))
    expect(result).toEqual({ ok: true })
  })
})

// ─── createEngagementFromProposalAction — garde de matérialisation ────────────
// NEW/pas de qualification → autorisé (déjà couvert par Section 6 de
// historical-visit-review.test.ts). Ici : les effets qui doivent bloquer create_new.

describe('createEngagementFromProposalAction — garde EFFET × TEMPORALITÉ (DOC-CONTRACT-OS-1A)', () => {
  function buildEngagementForm(effect: string, extra: Record<string, unknown> = {}) {
    mocks.from.mockImplementation(buildAccessMock({
      sourcePayload: { contract_effect: { effect, ...extra } },
    }))
    return buildForm({ category: 'sla', kind: 'controle', measurable: 'true' })
  }

  it('conflict — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(buildEngagementForm('conflict'))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('non_engagement — refus, aucun appel RPC', async () => {
    const result = await createEngagementFromProposalAction(buildEngagementForm('non_engagement'))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('confirm + cible qualifiée — refus (create_new jamais permis pour confirm)', async () => {
    const result = await createEngagementFromProposalAction(buildEngagementForm('confirm', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it("modify — refus, aucune matérialisation tant que DOC-CONTRACT-OS-1B n'existe pas", async () => {
    const result = await createEngagementFromProposalAction(buildEngagementForm('modify', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it("suspend — refus, aucune matérialisation tant que DOC-CONTRACT-OS-1B n'existe pas", async () => {
    const result = await createEngagementFromProposalAction(buildEngagementForm('suspend', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })
})

// ─── linkEngagementToProposalAction — garde de matérialisation ────────────────
// CONFIRM est le seul effet qualifié qui autorise link_existing (mandat : « CONFIRM
// → link_existing uniquement »).

describe('linkEngagementToProposalAction — garde EFFET × TEMPORALITÉ (DOC-CONTRACT-OS-1A)', () => {
  function buildEngagementForm(effect: string, extra: Record<string, unknown> = {}) {
    mocks.from.mockImplementation(buildAccessMock({
      sourcePayload: { contract_effect: { effect, ...extra } },
    }))
    return buildForm({ engagement_id: 'eng-1' })
  }

  it('conflict — refus, aucun appel RPC', async () => {
    const result = await linkEngagementToProposalAction(buildEngagementForm('conflict'))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('non_engagement — refus, aucun appel RPC', async () => {
    const result = await linkEngagementToProposalAction(buildEngagementForm('non_engagement'))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('confirm + cible qualifiée — autorisé (link_existing uniquement)', async () => {
    mocks.materializeEngagementLinkExisting.mockResolvedValue('eng-1')
    const result = await linkEngagementToProposalAction(buildEngagementForm('confirm', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-1' })
    expect(mocks.materializeEngagementLinkExisting).toHaveBeenCalledWith('prop-1', 'eng-1', 'user-admin')
  })

  it("modify — refus, aucune matérialisation tant que DOC-CONTRACT-OS-1B n'existe pas", async () => {
    const result = await linkEngagementToProposalAction(buildEngagementForm('modify', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it("suspend — refus, aucune matérialisation tant que DOC-CONTRACT-OS-1B n'existe pas", async () => {
    const result = await linkEngagementToProposalAction(buildEngagementForm('suspend', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })
})
