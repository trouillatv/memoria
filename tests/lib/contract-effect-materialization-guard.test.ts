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
  materializeEngagementContractEffect: vi.fn(),
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
  materializeEngagementContractEffect: mocks.materializeEngagementContractEffect,
  finalizeAcceptedEngagementsForRun: vi.fn(),
}))

import {
  setContractEffectAction,
  createEngagementFromProposalAction,
  linkEngagementToProposalAction,
  materializeContractEffectAction,
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
  const methods = ['select', 'eq', 'neq', 'in', 'is', 'ilike', 'order', 'limit']
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
  reviewStatus?: string
} = {}) {
  const {
    documentId = 'doc-1',
    proposalFamily = 'engagement',
    targetSiteId = null,
    sourcePayload = {},
    targetEngagementSiteId = 'site-1',
    documentType = 'cctp',
    reviewStatus = 'accepted',
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
          review_status: reviewStatus,
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
    expect(result).toEqual({ ok: false, error: 'La date de reprise doit être strictement postérieure à la date de fin' })
  })

  // Fix DOC-CONTRACT-OS-1B1 (2e revue Vincent 2026-09-28, défaut B) : resumeOn
  // égal à endsOn revenait à « reprise le jour même de la fin » côté serveur,
  // incohérent avec le CHECK strict de la RPC (migration 445 : resume_on <=
  // ends_on refusé). Le garde applicatif doit refuser exactement la même
  // frontière, jamais une version plus permissive.
  it('resume_on égal à ends_on — refus (frontière stricte alignée sur la RPC)', async () => {
    const result = await setContractEffectAction(buildForm({
      effect: 'new', temporality: 'permanent', ends_on: '2026-05-10', resume_on: '2026-05-10',
    }))
    expect(result).toEqual({ ok: false, error: 'La date de reprise doit être strictement postérieure à la date de fin' })
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

// ─── setContractEffectAction — immutabilité post-matérialisation (fix DOC-CONTRACT-OS-1B1
// défaut 3, revue Vincent 2026-09-28) ──────────────────────────────────────────
// Une proposition déjà matérialisée (review_status='materialized') ne doit plus
// jamais accepter de réécriture de contract_effect — sinon source_payload et
// engagement_contract_effects (migration 445) divergeraient silencieusement.
describe('setContractEffectAction — immutabilité post-matérialisation (fix défaut 3)', () => {
  it('proposition déjà matérialisée — toute réécriture refusée', async () => {
    mocks.from.mockImplementation(buildAccessMock({ reviewStatus: 'materialized' }))
    const result = await setContractEffectAction(buildForm({ effect: 'new', temporality: 'permanent' }))
    expect(result).toEqual({ ok: false, error: 'Proposition déjà matérialisée : la qualification ne peut plus être modifiée' })
  })

  it('proposition non matérialisée (accepted) — qualification toujours modifiable', async () => {
    mocks.from.mockImplementation(buildAccessMock({ reviewStatus: 'accepted' }))
    const result = await setContractEffectAction(buildForm({ effect: 'new', temporality: 'permanent' }))
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

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29,
  // défaut 1) : un effet déjà qualifié — même NEW/CONFIRM — ne rouvre plus le
  // chemin legacy create_new/link_existing. Seule la primitive canonique 1B1
  // (materializeContractEffectAction) matérialise un effet qualifié.
  it('ordre_service + new qualifié — create ET link refusés (seul 1B1 matérialise)', () => {
    expect(effectAllowsCreateNewForDocument('ordre_service', 'new')).toBe(false)
    expect(effectAllowsLinkExistingForDocument('ordre_service', 'new')).toBe(false)
  })

  it('ordre_service + confirm qualifié — create ET link refusés (seul 1B1 matérialise)', () => {
    expect(effectAllowsCreateNewForDocument('ordre_service', 'confirm')).toBe(false)
    expect(effectAllowsLinkExistingForDocument('ordre_service', 'confirm')).toBe(false)
  })

  it('cctp (legacy) + new qualifié — create ET link refusés malgré le document legacy', () => {
    expect(effectAllowsCreateNewForDocument('cctp', 'new')).toBe(false)
    expect(effectAllowsLinkExistingForDocument('cctp', 'confirm')).toBe(false)
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

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29,
  // défaut 1) : un CONFIRM qualifié n'autorise plus link_existing (legacy) —
  // il doit passer exclusivement par materializeContractEffectAction (1B1).
  it('confirm + cible qualifiée — refus (link_existing legacy jamais permis pour un effet qualifié)', async () => {
    const result = await linkEngagementToProposalAction(buildEngagementForm('confirm', { targetEngagementId: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
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

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29,
  // défaut 1) : un NEW/CONFIRM qualifié ne doit plus jamais matérialiser via les
  // anciennes RPC create_new/link_existing — seul materializeContractEffectAction
  // (1B1) le fait. Avant ce durcissement, ces deux tests attendaient encore
  // { ok: true } : c'était exactement le trou d'exclusivité signalé en revue.
  it('ordre_service + effet NEW qualifié — create refusé, jamais routé vers l’ancienne RPC', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: { contract_effect: { effect: 'new' } } }))
    const result = await createEngagementFromProposalAction(buildForm({ category: 'sla', kind: 'controle', measurable: 'true' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de créer un nouvel Engagement' })
    expect(mocks.materializeEngagementCreateNew).not.toHaveBeenCalled()
  })

  it('ordre_service + effet CONFIRM qualifié — link refusé, jamais routé vers l’ancienne RPC', async () => {
    mocks.from.mockImplementation(buildAccessMock({ documentType: 'ordre_service', sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-1' } } }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-1' }))
    expect(result).toMatchObject({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })
})

// ─── linkEngagementToProposalAction — cible verrouillée pour CONFIRM (micro-fix
// continuité, mandat Vincent 2026-09-28) ───────────────────────────────────────
// CONFIRM oblige déjà l'utilisateur à choisir contract_effect.targetEngagementId
// pendant la qualification. Le serveur ne doit plus jamais faire confiance à un
// engagement_id différent envoyé par le client — seule la cible persistée fait foi.
//
// Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE (revue Vincent/ChatGPT 2026-09-29, défaut 1) :
// un CONFIRM qualifié est désormais refusé par effectAllowsLinkExistingForDocument
// avant même d'atteindre cette vérification de cible — link_existing legacy n'est
// plus jamais atteignable pour un effet qualifié, cible correcte ou non. Le
// verrouillage de cible reste correct pour le CCTP historique (non qualifié),
// seul cas où link_existing legacy s'exécute encore.
describe('linkEngagementToProposalAction — cible verrouillée pour CONFIRM (micro-fix continuité)', () => {
  it('CONFIRM cible A → tentative de rattacher B → refus serveur (gate 1B1, avant même la vérification de cible)', async () => {
    mocks.from.mockImplementation(buildAccessMock({
      documentType: 'ordre_service',
      sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-A' } },
    }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-B' }))
    expect(result).toEqual({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })

  it('CONFIRM cible A → rattacher A → refus quand même (seul 1B1 matérialise un effet qualifié)', async () => {
    mocks.from.mockImplementation(buildAccessMock({
      documentType: 'ordre_service',
      sourcePayload: { contract_effect: { effect: 'confirm', targetEngagementId: 'eng-A' } },
    }))
    const result = await linkEngagementToProposalAction(buildForm({ engagement_id: 'eng-A' }))
    expect(result).toEqual({ ok: false, error: 'Cet effet contractuel ne permet pas de rattacher un Engagement existant' })
    expect(mocks.materializeEngagementLinkExisting).not.toHaveBeenCalled()
  })
})

// ─── materializeContractEffectAction — chemin canonique unique (DOC-CONTRACT-OS-1B1-UX-BRIDGE) ──
// Seul chemin qui écrit dans engagement_contract_effects : NEW/MODIFY/SUSPEND/CONFIRM
// qualifiés passent tous par materializeEngagementContractEffect (RPC migration 447),
// jamais par materializeEngagementCreateNew/LinkExisting (chemin legacy CCTP).

describe('materializeContractEffectAction — chemin canonique unique (DOC-CONTRACT-OS-1B1-UX-BRIDGE)', () => {
  function buildMaterializeForm(effect: string | null, extra: Record<string, unknown> = {}, formFields: Record<string, string> = {}) {
    mocks.from.mockImplementation(buildAccessMock({
      sourcePayload: effect ? { contract_effect: { effect, ...extra } } : {},
    }))
    return buildForm(formFields)
  }

  it('non qualifié — refus, aucun appel RPC', async () => {
    const fd = buildMaterializeForm(null)
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: false, error: 'Qualifiez d’abord l’effet contractuel de ce document' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('conflict — refus bloqué (OS14), aucun appel RPC', async () => {
    const fd = buildMaterializeForm('conflict')
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: false, error: 'Conflit documentaire non résolu — requalifiez avant toute matérialisation' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('non_engagement — refus bloqué, aucun appel RPC', async () => {
    const fd = buildMaterializeForm('non_engagement')
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: false, error: 'Effet « Non-Engagement » — ne doit jamais être matérialisé' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('new sans catégorie — refus, aucun appel RPC', async () => {
    const fd = buildMaterializeForm('new')
    const result = await materializeContractEffectAction(fd)
    expect(result).toMatchObject({ ok: false, error: 'Catégorie invalide' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('new avec catégorie mais sans nature — refus', async () => {
    const fd = buildMaterializeForm('new', {}, { category: 'sla' })
    const result = await materializeContractEffectAction(fd)
    expect(result).toMatchObject({ ok: false, error: 'Nature invalide' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('new avec catégorie/nature mais measurable invalide — refus', async () => {
    const fd = buildMaterializeForm('new', {}, { category: 'sla', kind: 'controle', measurable: 'peut-être' })
    const result = await materializeContractEffectAction(fd)
    expect(result).toMatchObject({ ok: false, error: 'Mesurable invalide' })
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  // Durci DOC-CONTRACT-OS-1B1-UX-BRIDGE, correctif défaut 2 (revue Vincent/ChatGPT
  // 2026-09-29) : cette UX ne collecte qu'un texte libre humain pour MODIFY,
  // jamais une structure effect_payload générique — l'application est bloquée
  // ici quel que soit l'état du payload de qualification, avant même d'atteindre
  // la RPC. La qualification elle-même (setContractEffectAction) reste possible,
  // seule cette matérialisation est suspendue.
  it('modify qualifié sans effectPayload — refus (application indisponible)', async () => {
    const fd = buildMaterializeForm('modify', { targetEngagementId: 'eng-1', effectPayload: null })
    const result = await materializeContractEffectAction(fd)
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toMatch(/indisponible/)
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('modify qualifié avec effectPayload renseigné — refus quand même, jamais matérialisé avec un texte libre', async () => {
    const fd = buildMaterializeForm('modify', {
      targetEngagementId: 'eng-1',
      effectPayload: { description: 'fréquence trimestrielle' },
    })
    const result = await materializeContractEffectAction(fd)
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toMatch(/indisponible/)
    expect(mocks.materializeEngagementContractEffect).not.toHaveBeenCalled()
  })

  it('new qualifié complet — appelle la RPC canonique avec category/kind/measurable', async () => {
    mocks.materializeEngagementContractEffect.mockResolvedValue({ engagementId: 'eng-new', effectId: 'effect-1' })
    const fd = buildMaterializeForm('new', {}, { category: 'sla', kind: 'controle', measurable: 'true' })
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: true, engagementId: 'eng-new', effectId: 'effect-1' })
    expect(mocks.materializeEngagementContractEffect).toHaveBeenCalledWith('prop-1', 'user-admin', {
      category: 'sla', kind: 'controle', measurable: true, effectPayload: undefined,
    })
  })

  it('confirm qualifié — appelle la RPC sans category/kind/measurable (null)', async () => {
    mocks.materializeEngagementContractEffect.mockResolvedValue({ engagementId: 'eng-A', effectId: 'effect-2' })
    const fd = buildMaterializeForm('confirm', { targetEngagementId: 'eng-A' })
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: true, engagementId: 'eng-A', effectId: 'effect-2' })
    expect(mocks.materializeEngagementContractEffect).toHaveBeenCalledWith('prop-1', 'user-admin', {
      category: null, kind: null, measurable: null, effectPayload: undefined,
    })
  })

  it('RPC lève une erreur (ex. concurrence) — propagée en résultat ok:false', async () => {
    mocks.materializeEngagementContractEffect.mockRejectedValue(new Error('Qualification introuvable ou modifiée depuis (concurrence)'))
    const fd = buildMaterializeForm('new', {}, { category: 'sla', kind: 'controle', measurable: 'true' })
    const result = await materializeContractEffectAction(fd)
    expect(result).toEqual({ ok: false, error: 'Qualification introuvable ou modifiée depuis (concurrence)' })
  })
})
