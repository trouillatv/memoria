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
  reports: new Map<string, string>(),         // key = extraction_run_id, value = report_id
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
        const full: Row = { ...row, id, created_at: new Date().toISOString() }
        if (tableName === 'document_extraction_run')     store.runs.set(id, full)
        if (tableName === 'document_extraction_proposal') store.proposals.set(id, full)
        if (tableName === 'document_extraction_evidence') store.evidence.set(id, full)
        if (tableName === 'document_proposal_materialization') {
          const key = `${full['proposal_id']}:${full['target_entity_type']}:${full['target_entity_id']}`
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

// Simule la fonction PL/pgSQL `promote_canonical_extraction_run` (migration 428)
// contre le même store.runs en mémoire — mêmes règles : un seul is_canonical
// par document_id, transfert atomique, no-op si déjà canonique.
function rpcPromoteCanonicalExtractionRun(args: { p_document_id: string; p_run_id: string }) {
  const run = store.runs.get(args.p_run_id)
  if (!run || run.document_id !== args.p_document_id) {
    return { data: false, error: null }
  }
  if (run.is_canonical === true) {
    return { data: true, error: null }
  }
  for (const [id, row] of store.runs) {
    if (row.document_id === args.p_document_id && row.is_canonical === true) {
      store.runs.set(id, { ...row, is_canonical: false })
    }
  }
  store.runs.set(args.p_run_id, { ...run, is_canonical: true })
  return { data: true, error: null }
}

// Simule le transfert is_canonical de `materialize_historical_visit` (migration
// 429) contre le même store.runs — deux branches, mêmes règles que la fonction
// SQL réelle : la branche IDEMPOTENTE (visite déjà créée pour ce run) ne touche
// JAMAIS is_canonical ; seule la branche NOMINALE (nouvelle finalisation) transfère
// l'autorité. Un rejeu ne doit jamais pouvoir redéplacer le canonique.
function rpcMaterializeHistoricalVisit(args: { p_run_id: string }) {
  const run = store.runs.get(args.p_run_id)
  if (!run) return { data: null, error: { message: `Run ${args.p_run_id} introuvable` } }

  const existingReportId = store.reports.get(args.p_run_id)
  if (existingReportId) {
    // IDEMPOTENCE — aucune mutation is_canonical.
    return { data: existingReportId, error: null }
  }

  const reportId = nextId()
  store.reports.set(args.p_run_id, reportId)
  for (const [id, row] of store.runs) {
    if (row.document_id === run.document_id && row.is_canonical === true && id !== args.p_run_id) {
      store.runs.set(id, { ...row, is_canonical: false })
    }
  }
  store.runs.set(args.p_run_id, { ...run, is_canonical: true })
  return { data: reportId, error: null }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => buildFromChain(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'promote_canonical_extraction_run') {
        return Promise.resolve(rpcPromoteCanonicalExtractionRun(args as { p_document_id: string; p_run_id: string }))
      }
      if (fn === 'materialize_historical_visit') {
        return Promise.resolve(rpcMaterializeHistoricalVisit(args as { p_run_id: string }))
      }
      return Promise.resolve({ data: null, error: { message: `rpc inconnu: ${fn}` } })
    },
  }),
}))

import {
  createExtractionRun,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
  reviewProposal,
  recordMaterialization,
  getProposalMaterializationReport,
  isPersonExemptFromMaterialization,
  promoteCanonicalExtractionRun,
  READY_STATUSES,
} from '@/lib/db/document-extractions'
import { materializeHistoricalVisit } from '@/lib/db/historical-visit-materialization'

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
  store.reports.clear()
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
    const p = store.proposals.get(id) as unknown as DbDocumentExtractionProposal
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
    const [{ id: evId }] = await insertExtractionEvidence(runId, [{
      organization_id: ORG_A,
      document_id: DOC_ID,
      evidence_type: 'image',
      source_page: 12,
      caption: 'Photo page 12 non associée',
    }])
    expect(evId).toBeTruthy()
    const ev = store.evidence.get(evId) as unknown as DbDocumentExtractionEvidence
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
    const [{ id: evExtrait }, { id: evPhotoG }, { id: evPhotoD }] = await insertExtractionEvidence(runId, [
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
    const [{ id: eid }] = await insertExtractionEvidence(runId, [{ organization_id: ORG_A, document_id: DOC_ID, evidence_type: 'image', source_page: 1 }])

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
    const p = store.proposals.get(pid) as unknown as DbDocumentExtractionProposal
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
    const p = store.proposals.get(pid) as unknown as DbDocumentExtractionProposal
    expect(p.review_status).toBe('edited')
    expect(p.reviewed_label).toBe('Infiltration toiture-terrasse (zone nord)')
    expect(p.reviewed_description).toBe('Visible au niveau du plancher')
    // Le libellé extrait reste intact
    expect(p.label).toBe('Infiltration en toiture')
  })

  it('refus — review_status devient rejected', async () => {
    const pid = await makeProposal()
    await reviewProposal(pid, { action: 'reject' })
    const p = store.proposals.get(pid) as unknown as DbDocumentExtractionProposal
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
    const [{ id: evExtrait }, { id: evPhotoG }, { id: evPhotoD }, { id: evPage12 }] = await insertExtractionEvidence(runId, [
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
    const reserve = store.proposals.get(pReserve) as unknown as DbDocumentExtractionProposal
    expect(reserve.reviewed_label).toBe('Infiltration en toiture-terrasse (zone nord)')
    expect(reserve.label).toBe('Infiltration en toiture')   // original intact

    // 6. Accepter l'action
    await reviewProposal(pAction, { action: 'accept' })
    expect((store.proposals.get(pAction) as unknown as DbDocumentExtractionProposal).review_status).toBe('accepted')

    // 7. Matérialisation idempotente de l'action
    const ENTITY_ID = 'action-site-001'
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pAction, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pAction, target_entity_type: 'site_action', target_entity_id: ENTITY_ID })
    expect(store.materializations.size).toBe(1)
  })
})

// ── 9. Garde de complétude — exemption des personnes sans lien entreprise ───
//
// P0 PV4 48/51 — une proposition `person` SANS linkedCompanyName résolvable
// n'est, par conception (F3-2), jamais matérialisée : elle reste indéfiniment
// à review_status='accepted'/'edited', gérée par la seule projection
// participants (historical-participant-eligibility.ts). Le dénominateur du
// bilan de complétude doit l'exclure — sans jamais exempter une personne dont
// le lien existe mais ne se résout pas (vrai trou de matérialisation).

describe('isPersonExemptFromMaterialization', () => {
  it('exempte une personne sans linkedCompanyName', () => {
    expect(isPersonExemptFromMaterialization({ proposal_family: 'person', source_payload: null })).toBe(true)
    expect(isPersonExemptFromMaterialization({ proposal_family: 'person', source_payload: { linkedCompanyName: null } })).toBe(true)
  })

  it('n’exempte pas une personne avec linkedCompanyName — même non résolu', () => {
    expect(isPersonExemptFromMaterialization({ proposal_family: 'person', source_payload: { linkedCompanyName: 'Acme' } })).toBe(false)
  })

  it('n’exempte jamais une autre famille', () => {
    expect(isPersonExemptFromMaterialization({ proposal_family: 'company', source_payload: null })).toBe(false)
    expect(isPersonExemptFromMaterialization({ proposal_family: 'knowledge_fact', source_payload: null })).toBe(false)
  })
})

describe('getProposalMaterializationReport — dénominateur avec exemption', () => {
  it('famille réellement matérialisable manquante → le dénominateur la compte (garde doit bloquer)', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pAction] = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'action', label: 'Reprendre le joint' },
    ])
    await reviewProposal(pAction, { action: 'accept' })
    // jamais matérialisée dans ce test → doit rester dans le dénominateur

    const report = await getProposalMaterializationReport(runId)
    expect(report.exemptFromMaterialization).toBe(0)
    const acceptedForMaterialization = report.autoAccepted - report.rejectedByGuard - report.exemptFromMaterialization
    expect(acceptedForMaterialization).toBe(1)
    expect(report.materialized).toBeLessThan(acceptedForMaterialization) // garde bloque, à raison
  })

  it('personne sans lien entreprise, intentionnellement hors matérialisation → ne bloque pas la garde', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pCompany, pPerson] = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'company', label: 'Entreprise X' },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'person', label: 'Jean Dupont', source_payload: { linkedCompanyName: null } },
    ])
    await reviewProposal(pCompany, { action: 'accept' })
    await reviewProposal(pPerson, { action: 'accept' })
    // Simule la matérialisation réelle de la company (le person reste accepted à vie — F3-2).
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pCompany, target_entity_type: 'site_intervenants', target_entity_id: 'si-1' })

    const report = await getProposalMaterializationReport(runId)
    expect(report.exemptFromMaterialization).toBe(1)
    const acceptedForMaterialization = report.autoAccepted - report.rejectedByGuard - report.exemptFromMaterialization
    expect(report.materialized).toBeGreaterThanOrEqual(acceptedForMaterialization) // garde NE bloque PAS
  })

  it('familles mixtes → dénominateur correct (exempt soustrait, reste réel conservé)', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    const [pKf, pCompany, pPersonExempt, pPersonUnresolved] = await insertExtractionProposals(runId, [
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'knowledge_fact', label: 'Fait' },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'company', label: 'Entreprise Y' },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'person', label: 'Sans lien', source_payload: { linkedCompanyName: null } },
      { organization_id: ORG_A, document_id: DOC_ID, proposal_family: 'person', label: 'Lien non résolu', source_payload: { linkedCompanyName: 'Entreprise Fantôme' } },
    ])
    await reviewProposal(pKf, { action: 'accept' })
    await reviewProposal(pCompany, { action: 'accept' })
    await reviewProposal(pPersonExempt, { action: 'accept' })
    await reviewProposal(pPersonUnresolved, { action: 'accept' })
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pKf, target_entity_type: 'site_knowledge_entries', target_entity_id: 'ske-1' })
    await recordMaterialization({ organization_id: ORG_A, proposal_id: pCompany, target_entity_type: 'site_intervenants', target_entity_id: 'si-2' })
    // pPersonExempt reste accepted (F3-2, jamais matérialisé) ; pPersonUnresolved reste
    // accepted aussi (lien non résolu = vrai trou), MAIS n'est PAS exempté.

    const report = await getProposalMaterializationReport(runId)
    expect(report.totalExtracted).toBe(4)
    expect(report.autoAccepted).toBe(4)
    expect(report.rejectedByGuard).toBe(0)
    expect(report.exemptFromMaterialization).toBe(1) // seulement pPersonExempt
    const acceptedForMaterialization = report.autoAccepted - report.rejectedByGuard - report.exemptFromMaterialization
    expect(acceptedForMaterialization).toBe(3) // kf + company + person-lien-non-résolu
    expect(report.materialized).toBe(2)
    expect(report.materialized).toBeLessThan(acceptedForMaterialization) // le vrai trou (lien non résolu) reste visible
  })
})

// ── 10. P0 Unicité des runs historiques — transfert atomique du canonique ────
//
// Un run brut n'acquiert pas l'autorité parce qu'il a terminé en premier : seul
// le run que l'humain finalise réellement (materialize_historical_visit réussi)
// devient is_canonical=true, par transfert atomique depuis l'ancien canonique
// (migration 428, RPC promote_canonical_extraction_run). Aucune suppression,
// aucun statut "superseded".

describe('READY_STATUSES', () => {
  it('couvre exactement les 3 statuts exploitables sans recréer de run', () => {
    expect(READY_STATUSES.has('ready_for_review')).toBe(true)
    expect(READY_STATUSES.has('partially_materialized')).toBe(true)
    expect(READY_STATUSES.has('materialized')).toBe(true)
    expect(READY_STATUSES.has('pending')).toBe(false)
    expect(READY_STATUSES.has('processing')).toBe(false)
    expect(READY_STATUSES.has('failed')).toBe(false)
  })
})

describe('promoteCanonicalExtractionRun', () => {
  it('transfère is_canonical de l\'ancien run vers le run finalisé', async () => {
    const oldRunId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    store.runs.set(oldRunId, { ...store.runs.get(oldRunId), is_canonical: true })
    const newRunId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    store.runs.set(newRunId, { ...store.runs.get(newRunId), is_canonical: false })

    const result = await promoteCanonicalExtractionRun(DOC_ID, newRunId)

    expect(result).toBe(true)
    expect((store.runs.get(oldRunId) as { is_canonical: boolean }).is_canonical).toBe(false)
    expect((store.runs.get(newRunId) as { is_canonical: boolean }).is_canonical).toBe(true)
    // Aucune suppression : l'ancien run reste consultable dans le store.
    expect(store.runs.has(oldRunId)).toBe(true)
  })

  it('idempotent — un run déjà canonique reste canonique (no-op)', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    store.runs.set(runId, { ...store.runs.get(runId), is_canonical: true })

    const result = await promoteCanonicalExtractionRun(DOC_ID, runId)

    expect(result).toBe(true)
    expect((store.runs.get(runId) as { is_canonical: boolean }).is_canonical).toBe(true)
  })

  it('un run non revu ne vole jamais le canonique — seul l\'appel explicite promeut', async () => {
    const oldRunId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    store.runs.set(oldRunId, { ...store.runs.get(oldRunId), is_canonical: true })
    // Un deuxième run existe (ex. via Réanalyser) mais n'est jamais finalisé —
    // promoteCanonicalExtractionRun n'est jamais appelé pour lui.
    await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })

    expect((store.runs.get(oldRunId) as { is_canonical: boolean }).is_canonical).toBe(true)
  })

  it('run appartenant à un autre document → false, aucun état modifié', async () => {
    const runId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'pv_btp_v1' })
    store.runs.set(runId, { ...store.runs.get(runId), is_canonical: false })

    const result = await promoteCanonicalExtractionRun('doc-autre', runId)

    expect(result).toBe(false)
    expect((store.runs.get(runId) as { is_canonical: boolean }).is_canonical).toBe(false)
  })
})

// ── 11. materialize_historical_visit — atomicité canonique (migration 429) ──
//
// Revue Vincent sur 429 v1 : la branche IDEMPOTENTE ne doit jamais transférer
// is_canonical. Sinon, rejouer materialize_historical_visit sur un ancien run A
// après qu'un run B réanalysé a été finalisé et est devenu canonique redonnerait
// l'autorité à A par simple replay — alors que seule une NOUVELLE finalisation
// humaine peut déplacer l'autorité documentaire.
//
// rpcMaterializeHistoricalVisit ci-dessus modélise exactement les deux branches
// de la migration 429 (idempotente = no-op sur is_canonical, nominale = transfert
// atomique) contre le même store.runs — pas d'exécution SQL réelle : la preuve
// définitive d'atomicité viendra de la recette après application de la migration.

describe('materializeHistoricalVisit — atomicité canonique (migration 429)', () => {
  it('la branche idempotente ne repromeut jamais un ancien run réanalysé', async () => {
    const runA = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'historical_visit_report_v1' })
    store.runs.set(runA, { ...store.runs.get(runA), is_canonical: false })

    // A finalisé en premier → branche nominale → devient canonique.
    await materializeHistoricalVisit({ runId: runA, userId: 'user-1', siteId: SITE_ID, visitDate: '2026-01-10' })
    expect((store.runs.get(runA) as { is_canonical: boolean }).is_canonical).toBe(true)

    // Réanalyser : un nouveau run B est créé pour le même document, puis finalisé
    // → branche nominale pour B → B devient canonique, A perd l'autorité.
    const runB = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'historical_visit_report_v1' })
    store.runs.set(runB, { ...store.runs.get(runB), is_canonical: false })
    await materializeHistoricalVisit({ runId: runB, userId: 'user-1', siteId: SITE_ID, visitDate: '2026-02-15' })

    expect((store.runs.get(runA) as { is_canonical: boolean }).is_canonical).toBe(false)
    expect((store.runs.get(runB) as { is_canonical: boolean }).is_canonical).toBe(true)

    // Rejeu idempotent de A (retry réseau, double appel) : la visite existe déjà
    // pour A → branche idempotente → AUCUNE mutation is_canonical.
    await materializeHistoricalVisit({ runId: runA, userId: 'user-1', siteId: SITE_ID, visitDate: '2026-01-10' })

    expect((store.runs.get(runB) as { is_canonical: boolean }).is_canonical).toBe(true)
    expect((store.runs.get(runA) as { is_canonical: boolean }).is_canonical).toBe(false)
  })

  it('branche nominale — transfert atomique visible avec la création de la visite', async () => {
    const oldRunId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'historical_visit_report_v1' })
    store.runs.set(oldRunId, { ...store.runs.get(oldRunId), is_canonical: true })
    const newRunId = await createExtractionRun({ document_id: DOC_ID, organization_id: ORG_A, extractor_key: 'historical_visit_report_v1' })
    store.runs.set(newRunId, { ...store.runs.get(newRunId), is_canonical: false })

    const reportId = await materializeHistoricalVisit({ runId: newRunId, userId: 'user-1', siteId: SITE_ID, visitDate: '2026-03-01' })

    expect(reportId).toBeTruthy()
    expect((store.runs.get(oldRunId) as { is_canonical: boolean }).is_canonical).toBe(false)
    expect((store.runs.get(newRunId) as { is_canonical: boolean }).is_canonical).toBe(true)
  })
})
