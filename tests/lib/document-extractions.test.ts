// Invariants du modèle générique de propositions documentaires (Sprint 4B.0).
//
// Ce fichier vérifie les contrats de comportement — sans LLM, sans extraction
// réelle, sans appel réseau. Le client Supabase est simulé par un store en
// mémoire qui reproduit les contraintes importantes (UNIQUE, idempotence).
//
// Scénario fil rouge (critère de fin de lot) :
//
//   PV historique
//   ├── Réserve : infiltration en toiture
//   │   ├── extrait source page 7
//   │   ├── photo générale page 7
//   │   └── photo de détail page 8
//   ├── Action : reprendre le joint de couvertine
//   │   └── même photo de détail page 8
//   └── Photo page 12 non associée

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  DbDocumentExtractionProposal,
  DbDocumentExtractionEvidence,
  DbDocumentProposalMaterialization,
  DocumentExtractionRunStatus,
  DocumentProposalReviewStatus,
} from '@/types/db'

// ── Store en mémoire ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const store = {
  runs: new Map<string, Row>(),
  proposals: new Map<string, Row>(),
  evidence: new Map<string, Row>(),
  proposalEvidence: new Map<string, Row>(),  // key = "proposal_id:evidence_id:relation_type"
  materializations: new Map<string, Row>(),   // key = "proposal_id:entity_type:entity_id"
}

let idCounter = 0
const nextId = () => `id-${++idCounter}`

function buildFromChain(tableName: string) {
  return {
    // INSERT
    insert(rows: Row | Row[]) {
      const arr = Array.isArray(rows) ? rows : [rows]
      const inserted: Row[] = arr.map((row) => {
        const id = (row.id as string | undefined) ?? nextId()
        const full = { ...row, id, created_at: new Date().toISOString() }
        if (tableName === 'document_extraction_run')     store.runs.set(id, full)
        if (tableName === 'document_extraction_proposal') store.proposals.set(id, full)
        if (tableName === 'document_extraction_evidence') store.evidence.set(id, full)
        if (tableName === 'document_proposal_materialization') {
          const key = `${full.proposal_id}:${full.target_entity_type}:${full.target_entity_id}`
          store.materializations.set(key, full)
        }
        return full
      })
      return {
        select: (_cols?: string) => ({
          single: async () => ({ data: inserted[0] ?? null, error: null }),
          async then(resolve: (v: { data: Row[]; error: null }) => void) {
            resolve({ data: inserted, error: null })
          },
        }),
        async then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: inserted, error: null })
        },
      }
    },

    // UPSERT (idempotent pour proposal_evidence et materializations)
    upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      const arr = Array.isArray(rows) ? rows : [rows]
      const upserted: Row[] = []
      for (const row of arr) {
        if (tableName === 'document_proposal_evidence') {
          const key = `${row.proposal_id}:${row.evidence_id}:${row.relation_type}`
          if (store.proposalEvidence.has(key) && opts?.ignoreDuplicates) {
            upserted.push(store.proposalEvidence.get(key)!)
          } else {
            const full = { ...row, created_at: new Date().toISOString() }
            store.proposalEvidence.set(key, full)
            upserted.push(full)
          }
        } else if (tableName === 'document_proposal_materialization') {
          const key = `${row.proposal_id}:${row.target_entity_type}:${row.target_entity_id}`
          if (store.materializations.has(key) && opts?.ignoreDuplicates) {
            upserted.push(store.materializations.get(key)!)
          } else {
            const id = nextId()
            const full = { ...row, id, created_at: new Date().toISOString() }
            store.materializations.set(key, full)
            upserted.push(full)
          }
        }
      }
      return { error: null, data: upserted }
    },

    // UPDATE
    update(patch: Row) {
      return {
        eq: (col: string, val: unknown) => {
          const maps = [store.runs, store.proposals, store.evidence, store.materializations]
          const map = tableName === 'document_extraction_run' ? store.runs
                    : tableName === 'document_extraction_proposal' ? store.proposals
                    : tableName === 'document_extraction_evidence' ? store.evidence
                    : store.materializations
          for (const [k, row] of map) {
            if (row[col] === val) map.set(k, { ...row, ...patch })
          }
          return { error: null }
        },
      }
    },

    // SELECT
    select(cols?: string) {
      return {
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => ({
            in: (col3: string, vals: unknown[]) => ({
              async then(resolve: (v: { data: Row[]; error: null }) => void) {
                resolve({ data: [], error: null })
              },
            }),
            async then(resolve: (v: { data: Row[]; error: null }) => void) {
              resolve({ data: [], error: null })
            },
          }),
          order: (_col: string, _opts?: unknown) => ({
            async then(resolve: (v: { data: Row[]; error: null }) => void) {
              const map = tableName === 'document_extraction_proposal' ? store.proposals : store.runs
              const rows = [...map.values()].filter((r) => r[col] === val)
              resolve({ data: rows, error: null })
            },
          }),
          single: async () => {
            const map = tableName === 'document_extraction_proposal' ? store.proposals
                      : tableName === 'document_extraction_run' ? store.runs
                      : store.evidence
            const found = [...map.values()].find((r) => r[col] === val)
            return { data: found ?? null, error: found ? null : { message: 'not found' } }
          },
          async then(resolve: (v: { data: Row[]; error: null }) => void) {
            const map = tableName === 'document_extraction_proposal' ? store.proposals
                      : tableName === 'document_extraction_run' ? store.runs
                      : store.evidence
            resolve({ data: [...map.values()].filter((r) => r[col] === val), error: null })
          },
        }),
        in: (col: string, vals: unknown[]) => ({
          async then(resolve: (v: { data: Row[]; error: null }) => void) {
            resolve({ data: [], error: null })
          },
        }),
        async then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: [], error: null })
        },
      }
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => buildFromChain(table),
  }),
}))

import {
  createExtractionRun,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
  reviewProposal,
  recordMaterialization,
} from '@/lib/db/document-extractions'

const ORG_A = 'org-aaaaaaaa'
const ORG_B = 'org-bbbbbbbb'
const DOC_ID = 'doc-11111111'
const SITE_ID = 'site-22222222'

beforeEach(() => {
  store.runs.clear()
  store.proposals.clear()
  store.evidence.clear()
  store.proposalEvidence.clear()
  store.materializations.clear()
  idCounter = 0
})

// ── 1. Création d'un run ─────────────────────────────────────────────────────

describe('createExtractionRun', () => {
  it('crée un run et retourne son id', async () => {
    const runId = await createExtractionRun({
      document_id: DOC_ID,
      organization_id: ORG_A,
      extractor_key: 'pv_btp_v1',
    })
    expect(runId).toBeTruthy()
    const run = store.runs.get(runId)
    expect(run?.document_id).toBe(DOC_ID)
    expect(run?.organization_id).toBe(ORG_A)
    expect(run?.status).toBe('pending')
    expect(run?.extractor_version).toBe('1.0.0')
  })

  it('plusieurs runs pour un même document coexistent — invariant 8', async () => {
    const run1 = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const run2 = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1', extractor_version: '1.1.0' })
    expect(run1).not.toBe(run2)
    expect(store.runs.size).toBe(2)
    // Le second run ne touche pas le premier
    expect(store.runs.get(run1)?.status).toBe('pending')
    expect(store.runs.get(run2)?.extractor_version).toBe('1.1.0')
  })
})

// ── 2. Propositions ──────────────────────────────────────────────────────────

describe('insertExtractionProposals', () => {
  it('proposition sans preuve — le slot existe, aucune relation requise', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [id] = await insertExtractionProposals(runId, [{
      organization_id: ORG_A,
      document_id: DOC_ID,
      proposal_family: 'observation',
      label: 'Observation sans photo',
    }])
    const p = store.proposals.get(id) as DbDocumentExtractionProposal
    expect(p.label).toBe('Observation sans photo')
    expect(p.review_status).toBe('pending')
    expect(store.proposalEvidence.size).toBe(0)   // aucune relation
  })

  it('retourne un id par proposition insérée', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const ids = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'reservation', label: 'Réserve 1' },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'action',      label: 'Action 1'  },
    ])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

// ── 3. Preuves ───────────────────────────────────────────────────────────────

describe('insertExtractionEvidence', () => {
  it('preuve non associée — invariant 4', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [evId] = await insertExtractionEvidence(runId, [{
      organization_id: ORG_A,
      document_id: DOC_ID,
      evidence_type: 'image',
      source_page: 12,
      caption: 'Photo page 12 non associée',
    }])
    expect(evId).toBeTruthy()
    const ev = store.evidence.get(evId) as DbDocumentExtractionEvidence
    expect(ev.source_page).toBe(12)
    expect(store.proposalEvidence.size).toBe(0)   // aucune relation
  })
})

// ── 4. Relations M-M ─────────────────────────────────────────────────────────

describe('linkProposalEvidence', () => {
  it('proposition avec deux preuves — la même preuve peut illustrer deux propositions', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [p1, p2] = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'reservation', label: 'Infiltration en toiture', source_page: 7 },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'action',      label: 'Reprendre le joint de couvertine' },
    ])
    const [evExtrait, evPhotoG, evPhotoD] = await insertExtractionEvidence(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'text_excerpt',  source_page: 7, nearby_text: 'extrait source p.7' },
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image',         source_page: 7, caption: 'Photo générale p.7' },
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image',         source_page: 8, caption: 'Photo de détail p.8' },
    ])

    // Réserve ← extrait + photo générale + photo de détail
    await linkProposalEvidence(p1, evExtrait, 'source')
    await linkProposalEvidence(p1, evPhotoG, 'illustrates')
    await linkProposalEvidence(p1, evPhotoD, 'illustrates')
    // Action ← même photo de détail (preuve partagée)
    await linkProposalEvidence(p2, evPhotoD, 'illustrates')

    expect(store.proposalEvidence.size).toBe(4)
    // La clé M-M contient bien les deux liens vers la photo de détail
    expect(store.proposalEvidence.has(`${p1}:${evPhotoD}:illustrates`)).toBe(true)
    expect(store.proposalEvidence.has(`${p2}:${evPhotoD}:illustrates`)).toBe(true)
  })

  it('relation idempotente — insérer deux fois le même lien ne crée pas de doublon — invariant 5', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pid] = await insertExtractionProposals(runId, [{ organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'observation', label: 'Obs' }])
    const [eid] = await insertExtractionEvidence(runId, [{ organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image', source_page: 1 }])

    await linkProposalEvidence(pid, eid, 'supports', 0.9)
    await linkProposalEvidence(pid, eid, 'supports', 0.9)   // doublon
    expect(store.proposalEvidence.size).toBe(1)
  })
})

// ── 5. Validation humaine ────────────────────────────────────────────────────

describe('reviewProposal', () => {
  async function makeProposal() {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pid] = await insertExtractionProposals(runId, [{
      organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'reservation',
      label: 'Infiltration en toiture', source_excerpt: 'extrait original',
    }])
    return pid
  }

  it('acceptation sans modification — review_status devient accepted', async () => {
    const pid = await makeProposal()
    await reviewProposal(pid, { action: 'accept' }, 'user-01')
    const p = store.proposals.get(pid) as DbDocumentExtractionProposal
    expect(p.review_status).toBe('accepted')
    expect(p.reviewed_by).toBe('user-01')
    // Le contenu extrait reste intact — invariant 3
    expect(p.label).toBe('Infiltration en toiture')
    expect(p.source_excerpt).toBe('extrait original')
    // Champs de correction absents
    expect(p.reviewed_label).toBeUndefined()
  })

  it('correction humaine — reviewed_label distinct de label — invariant 3', async () => {
    const pid = await makeProposal()
    await reviewProposal(pid, {
      action: 'edit',
      label: 'Infiltration toiture-terrasse (zone nord)',
      description: 'Visible au niveau du plancher',
    })
    const p = store.proposals.get(pid) as DbDocumentExtractionProposal
    expect(p.review_status).toBe('edited')
    expect(p.reviewed_label).toBe('Infiltration toiture-terrasse (zone nord)')
    expect(p.reviewed_description).toBe('Visible au niveau du plancher')
    // Le libellé extrait reste intact
    expect(p.label).toBe('Infiltration en toiture')
  })

  it('refus — review_status devient rejected', async () => {
    const pid = await makeProposal()
    await reviewProposal(pid, { action: 'reject' })
    const p = store.proposals.get(pid) as DbDocumentExtractionProposal
    expect(p.review_status).toBe('rejected')
  })
})

// ── 6. Matérialisation ───────────────────────────────────────────────────────

describe('recordMaterialization', () => {
  async function makeAcceptedProposal() {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pid] = await insertExtractionProposals(runId, [{
      organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'action', label: 'Reprendre le joint',
    }])
    await reviewProposal(pid, { action: 'accept' })
    return pid
  }

  it('impossible de matérialiser un refus — invariant 6', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pid] = await insertExtractionProposals(runId, [{
      organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'action', label: 'Action indésirable',
    }])
    await reviewProposal(pid, { action: 'reject' })
    await expect(recordMaterialization({
      organization_id: ORG_A,
      proposal_id: pid,
      target_entity_type: 'site_action',
      target_entity_id: 'action-99',
    })).rejects.toThrow(/refusée/)
  })

  it('registre de matérialisation idempotent — invariant 7', async () => {
    const pid = await makeAcceptedProposal()
    const ENTITY_ID = 'action-42'
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pid, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pid, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    const key = `${pid}:site_action:${ENTITY_ID}`
    expect(store.materializations.has(key)).toBe(true)
    expect(store.materializations.size).toBe(1)   // pas de doublon
  })
})

// ── 7. Isolation par organisation ────────────────────────────────────────────

describe('isolation organisation', () => {
  it('les runs de deux organisations sont indépendants — invariant 1', async () => {
    const rA = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const rB = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_B, extractor_key: 'pv_btp_v1' })
    expect(store.runs.get(rA)?.organization_id).toBe(ORG_A)
    expect(store.runs.get(rB)?.organization_id).toBe(ORG_B)
  })

  it('les propositions portent organization_id de leur run — invariant 1', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pid] = await insertExtractionProposals(runId, [{
      organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'observation', label: 'Obs A',
    }])
    expect(store.proposals.get(pid)?.organization_id).toBe(ORG_A)
  })
})

// ── 8. Scénario fil rouge (critère de fin de lot) ────────────────────────────

describe('scénario complet PV historique', () => {
  it('crée la structure cible, corrige, accepte, refuse, matérialise idempotent', async () => {
    // 1. Run
    const runId = await createExtractionRun({
      document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1',
    })

    // 2. Propositions
    const [pReserve, pAction] = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, target_site_id: SITE_ID,
        proposal_family: 'reservation', label: 'Infiltration en toiture',
        source_page: 7, source_excerpt: 'infiltration constatée en périphérie' },
      { organization_id: ORG_A, document_id: DOC_ID, target_site_id: SITE_ID,
        proposal_family: 'action',      label: 'Reprendre le joint de couvertine' },
    ])

    // 3. Preuves
    const [evExtrait, evPhotoG, evPhotoD, evPage12] = await insertExtractionEvidence(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'text_excerpt', source_page: 7,  nearby_text: 'extrait source p.7' },
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image',        source_page: 7,  caption: 'Photo générale p.7' },
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image',        source_page: 8,  caption: 'Photo de détail p.8' },
      { organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image',        source_page: 12, caption: 'Photo page 12 non associée' },
    ])

    // 4. Relations
    await linkProposalEvidence(pReserve, evExtrait, 'source')
    await linkProposalEvidence(pReserve, evPhotoG, 'illustrates')
    await linkProposalEvidence(pReserve, evPhotoD, 'illustrates')
    await linkProposalEvidence(pAction,  evPhotoD, 'illustrates')
    // evPage12 reste sans proposition — invariant 4 respecté

    // Vérifications structure
    expect(store.proposals.size).toBe(2)
    expect(store.evidence.size).toBe(4)
    expect(store.proposalEvidence.size).toBe(4)
    expect(store.proposalEvidence.has(`${pReserve}:${evPhotoD}:illustrates`)).toBe(true)
    expect(store.proposalEvidence.has(`${pAction}:${evPhotoD}:illustrates`)).toBe(true)

    // 5. Corriger le libellé de la réserve
    await reviewProposal(pReserve, {
      action: 'edit',
      label: 'Infiltration en toiture-terrasse (zone nord)',
    })
    const reserve = store.proposals.get(pReserve) as DbDocumentExtractionProposal
    expect(reserve.reviewed_label).toBe('Infiltration en toiture-terrasse (zone nord)')
    expect(reserve.label).toBe('Infiltration en toiture')   // original intact

    // 6. Accepter l'action
    await reviewProposal(pAction, { action: 'accept' })
    expect((store.proposals.get(pAction) as DbDocumentExtractionProposal).review_status).toBe('accepted')

    // 7. Matérialisation idempotente de l'action
    const ENTITY_ID = 'action-site-001'
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pAction, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pAction, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    expect(store.materializations.size).toBe(1)
  })
})
