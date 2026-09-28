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
import {
  effectAllowsCreateNew,
  effectAllowsLinkExisting,
  effectAllowsCreateNewForDocument,
  effectAllowsLinkExistingForDocument,
  documentRequiresContractEffectQualification,
  type ContractEffect,
} from '@/lib/engagements/contract-effect'

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
  documentType?: string | null
} = {}) {
  const {
    documentId = 'doc-1',
    proposalFamily = 'engagement',
    targetSiteId = null,
    sourcePayload = {},
    targetEngagementSiteId = 'site-1',
    documentType = 'cctp',
  } = config
  return (table: string) => {
    if (table === 'documents') {
      return buildChainWithThen(() => ({ data: { organization_id: 'org-1', document_type: documentType }, error: null }))
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

  // Micro-fix de fermeture (mandat Vincent 2026-09-28, point 1) : un conflit
  // documentaire peut rester sans cible identifiée — ce n'est plus une erreur
  // de saisie, c'est l'état normal d'un « je ne sais pas encore quel Engagement
  // est concerné ». effectRequiresTarget() ne couvre plus conflict.
  it('conflict sans cible — qualification enregistrable', async () => {
    const result = await setContractEffectAction(buildForm({ effect: 'conflict', temporality: 'permanent' }))
    expect(result).toEqual({ ok: true })
  })
})

// ─── setContractEffectAction — validation de cible fail-closed (mandat de
// fermeture Vincent 2026-09-28, point 2) ─────────────────────────────────────
// Avec un admin client, l'absence de proposal.target_site_id ne doit jamais
// laisser passer une cible arbitraire : refus, jamais un fallback permissif.

describe('setContractEffectAction — validation cible fail-closed (DOC-CONTRACT-OS-1A)', () => {
  it('target fourni + proposal.target_site_id null — refus', async () => {
    mocks.from.mockImplementation(buildAccessMock({ targetSiteId: null }))
    const result = await setContractEffectAction(buildForm({
      effect: 'confirm', temporality: 'permanent', target_engagement_id: 'eng-1',
    }))
    expect(result).toEqual({ ok: false, error: 'Chantier de la proposition introuvable' })
  })

  it('target fourni + engagement.site_id différent de proposal.target_site_id — refus', async () => {
    mocks.from.mockImplementation(buildAccessMock({ targetSiteId: 'site-1', targetEngagementSiteId: 'site-2' }))
    const result = await setContractEffectAction(buildForm({
      effect: 'confirm', temporality: 'permanent', target_engagement_id: 'eng-1',
    }))
    expect(result).toEqual({ ok: false, error: 'Engagement cible : chantier différent' })
  })

  it('target fourni + même chantier — accepté', async () => {
    mocks.from.mockImplementation(buildAccessMock({ targetSiteId: 'site-1', targetEngagementSiteId: 'site-1' }))
    const result = await setContractEffectAction(buildForm({
      effect: 'confirm', temporality: 'permanent', target_engagement_id: 'eng-1',
    }))
    expect(result).toEqual({ ok: true })
  })
})

// ─── effectAllowsCreateNew / effectAllowsLinkExisting — matrice UI/serveur
// (mandat de fermeture Vincent 2026-09-28, point 3) ──────────────────────────
// ProposalCard doit n'afficher que le geste que le serveur autorise réellement ;
// ces fonctions pures sont la source de vérité partagée entre les deux.

describe('effectAllowsCreateNew / effectAllowsLinkExisting — matrice complète', () => {
  const MATRIX: Array<{ effect: ContractEffect; createNew: boolean; linkExisting: boolean }> = [
    { effect: 'new', createNew: true, linkExisting: false },
    { effect: 'confirm', createNew: false, linkExisting: true },
    { effect: 'modify', createNew: false, linkExisting: false },
    { effect: 'suspend', createNew: false, linkExisting: false },
    { effect: 'conflict', createNew: false, linkExisting: false },
    { effect: 'non_engagement', createNew: false, linkExisting: false },
  ]

  it.each(MATRIX)('$effect — createNew=$createNew, linkExisting=$linkExisting', ({ effect, createNew, linkExisting }) => {
    expect(effectAllowsCreateNew(effect)).toBe(createNew)
    expect(effectAllowsLinkExisting(effect)).toBe(linkExisting)
  })

  it('non qualifié (null, CCTP historique) — autorise les deux, comportement préservé', () => {
    expect(effectAllowsCreateNew(null)).toBe(true)
    expect(effectAllowsLinkExisting(null)).toBe(true)
  })
})

// ─── effectAllowsCreateNewForDocument / effectAllowsLinkExistingForDocument —
// dernier gate de fermeture DOC-CONTRACT-OS-1A (mandat Vincent 2026-09-28) :
// null ne signifie plus « autorisé » pour un document qui exige une
// qualification explicite (ordre_service, avenant). Un effet déjà qualifié
// suit exactement la même matrice que ci-dessus, quel que soit le document.

describe('effectAllowsCreateNewForDocument / effectAllowsLinkExistingForDocument — legacy vs qualification requise', () => {
  it('documentRequiresContractEffectQualification — seuls ordre_service et avenant', () => {
    expect(documentRequiresContractEffectQualification('ordre_service')).toBe(true)
    expect(documentRequiresContractEffectQualification('avenant')).toBe(true)
    expect(documentRequiresContractEffectQualification('cctp')).toBe(false)
    expect(documentRequiresContractEffectQualification('ccap')).toBe(false)
    expect(documentRequiresContractEffectQualification(null)).toBe(false)
    expect(documentRequiresContractEffectQualification(undefined)).toBe(false)
  })

  it('CCTP (legacy) sans qualification — create et link toujours autorisés', () => {
    expect(effectAllowsCreateNewForDocument('cctp', null)).toBe(true)
    expect(effectAllowsLinkExistingForDocument('cctp', null)).toBe(true)
  })

  it('ordre_service sans qualification — create et link refusés', () => {
    expect(effectAllowsCreateNewForDocument('ordre_service', null)).toBe(false)
    expect(effectAllowsLinkExistingForDocument('ordre_service', null)).toBe(false)
  })

  it('avenant sans qualification — create et link refusés', () => {
    expect(effectAllowsCreateNewForDocument('avenant', null)).toBe(false)
    expect(effectAllowsLinkExistingForDocument('avenant', null)).toBe(false)
  })

  it('ordre_service + new qualifié — create autorisé (la matrice prime dès qu\'un effet existe)', () => {
    expect(effectAllowsCreateNewForDocument('ordre_service', 'new')).toBe(true)
    expect(effectAllowsLinkExistingForDocument('ordre_service', 'new')).toBe(false)
  })

  it('ordre_service + confirm qualifié — link autorisé', () => {
    expect(effectAllowsCreateNewForDocument('ordre_service', 'confirm')).toBe(false)
    expect(effectAllowsLinkExistingForDocument('ordre_service', 'confirm')).toBe(true)
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

// ─── DOC-CONTRACT-OS-1A — dernier gate de fermeture (mandat Vincent 2026-09-28) ──
// null ne signifie plus « CCTP historique, autorisé » pour un ordre_service ou un
// avenant : la qualification devient obligatoire avant create ET link, y compris
// côté serveur (documents.document_type, jamais un second champ inventé).

describe('createEngagementFromProposalAction / linkEngagementToProposalAction — qualification obligatoire pour ordre_service/avenant (DOC-CONTRACT-OS-1A dernier gate)', () => {
  it('CCTP legacy sans contract_effect — create toujours possible', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'cctp', sourcePayload: {} }))
    mocks.materializeEngagementCreateNew.mockResolvedValue('eng-x')
    const result = await createEngagementFromProposalAction(buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-x' })
  })

  it('CCTP legacy sans contract_effect — link toujours possible', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'cctp', sourcePayload: {} }))
    mocks.materializeEngagementLinkExisting.mockResolvedValue('eng-1')
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-1' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-1' })
  })

  it('ordre_service sans contract_effect — create refusé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: {} }))
    const result = await createEngagementFromProposalAction(buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }))
    expect(result).toMatchObject({ ok: false, error: 'Qualifiez d’abord l’effet contractuel de ce document avant de créer un Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('ordre_service sans contract_effect — link refusé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: {} }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Qualifiez d’abord l’effet contractuel de ce document avant de rattacher un Engagement' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('avenant sans contract_effect — create refusé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'avenant', sourcePayload: {} }))
    const result = await createEngagementFromProposalAction(buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }))
    expect(result).toMatchObject({ ok: false, error: 'Qualifiez d’abord l’effet contractuel de ce document avant de créer un Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('avenant sans contract_effect — link refusé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'avenant', sourcePayload: {} }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Qualifiez d’abord l’effet contractuel de ce document avant de rattacher un Engagement' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('ordre_service + effet NEW qualifié — create autorisé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: { contract_effect: { effect: 'new' } } }))
    mocks.materializeEngagementCreateNew.mockResolvedValue('eng-x')
    const result = await createEngagementFromProposalAction(buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-x' })
  })

  it('ordre_service + effet CONFIRM qualifié — link autorisé', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-1' } } }))
    mocks.materializeEngagementLinkExisting.mockResolvedValue('eng-1')
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-1' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-1' })
  })
})

// ─── linkEngagementToProposalAction — cible verrouillée pour CONFIRM (micro-fix
// continuité, mandat Vincent 2026-09-28) ───────────────────────────────────────
// CONFIRM oblige déjà l'utilisateur à choisir contract_effect.targetEngagementId
// pendant la qualification. Le serveur ne doit plus jamais faire confiance à un
// engagement_id différent envoyé par le client — seule la cible persistée fait foi.

describe('linkEngagementToProposalAction — cible verrouillée pour CONFIRM (micro-fix continuité)', () => {
  it('CONFIRM cible A → tentative de rattacher B → refus serveur', async () => {
    mocks.from.mockImplementation(buildAccessMock({
      documentType: 'ordre_service',
      sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-A' } },
    }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-B' }))
    expect(result).toEqual({ ok: false, error: 'Cet Engagement ne correspond pas à la cible validée lors de la qualification' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('CONFIRM cible A → rattacher A → autorisé', async () => {
    mocks.from.mockImplementation(buildAccessMock({
      documentType: 'ordre_service',
      sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-A' } },
    }))
    mocks.materializeEngagementLinkExisting.mockResolvedValue('eng-A')
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-A' }))
    expect(result).toMatchObject({ ok: true, engagementId: 'eng-A' })
    expect(mocks.materializeEngagementLinkExisting).toHaveBeenCalledWith('prop-1', 'eng-A', 'user-admin')
  })
})
