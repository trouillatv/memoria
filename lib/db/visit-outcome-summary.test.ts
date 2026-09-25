import { describe, it, expect } from 'vitest'
import { buildVisitOutcomeSummary, type VisitOutcomeSummary } from './visit-outcome-summary'
import type { DbKnowledgeProposal } from './knowledge-proposals'
import type { EntityResolution } from '@/lib/knowledge/semantic-resolution'

// SUIVI-1 — témoin réel Sextant (report ad4abcd2-18e5-4b7f-9f52-e8617a1b764f, site
// 90bdfbd3-d4bb-44c4-bf61-28ade78b4df2) : 3 propositions d'action (1 réconciliée,
// 2 orphelines), 1 échéance orpheline, 1 intervenant ("Monsieur Cope") non résolu
// côté semantic_memory, 1 trace tracked_point_pending_trace en attente, CR en
// brouillon, mémoire non indexée. Valeurs observées en base le 2026-09-25.

const SUBJECT_ID = 'ece93032-1ef4-4bb3-9e92-55acb75b9062'
const SITE_ID = '90bdfbd3-d4bb-44c4-bf61-28ade78b4df2'
const VISIT_ID = 'ad4abcd2-18e5-4b7f-9f52-e8617a1b764f'

function proposal(overrides: Partial<DbKnowledgeProposal> & Pick<DbKnowledgeProposal, 'id' | 'kind' | 'title'>): DbKnowledgeProposal {
  return {
    organization_id: '9862b3b2-b564-4f41-8b04-36a753d7442e',
    site_id: SITE_ID,
    report_id: VISIT_ID,
    analysis_version: 1,
    status: 'proposed',
    body: null,
    payload: {},
    confidence: null,
    source_capture_ids: [],
    dedupe_key: `dedupe-${overrides.id}`,
    promoted_object_type: null,
    promoted_object_id: null,
    superseded_by: null,
    dismiss_reason: null,
    reviewed_at: null,
    reviewed_by: null,
    canonical_subject_id: null,
    canonical_resolution_status: null,
    created_at: '2026-09-24T19:00:00.000Z',
    updated_at: '2026-09-24T19:00:00.000Z',
    ...overrides,
  }
}

const SEXTANT_PROPOSALS: DbKnowledgeProposal[] = [
  proposal({
    id: '13d954fa-4aaf-4166-bf97-80283082a498',
    kind: 'deadline',
    title: 'Intervention pour le nettoyage des vitres des salles de banquets',
    canonical_resolution_status: 'not_found',
  }),
  proposal({
    id: 'dadc2216-7a53-45d8-a42c-2d4bed0443fa',
    kind: 'stakeholder',
    title: 'Monsieur Cope',
    canonical_resolution_status: null,
  }),
  proposal({
    id: '8cfb54a5-e808-4ddc-b4f0-1c0ccee6f49f',
    kind: 'action',
    title: "Préparer une nouvelle offre de prestations d'entretien",
    canonical_resolution_status: 'not_found',
  }),
  proposal({
    id: 'e939e818-3461-4dfe-b8e0-a9b7487a6fec',
    kind: 'action',
    title: 'Organiser une intervention pour le nettoyage des vitres des salles de banquets',
    canonical_resolution_status: 'not_found',
  }),
  proposal({
    id: 'e891c84a-f536-4638-a1c4-474e4a213013',
    kind: 'action',
    title: 'Intégrer le nettoyage des murs par salle dans les roulements de la cuisine du Sextant',
    canonical_subject_id: SUBJECT_ID,
    canonical_resolution_status: 'resolved',
  }),
]

const SEXTANT_PENDING_TRACE = {
  id: 'd3c888bb-9200-4d44-aa05-0b37113b1dae',
  sourceThreadId: SUBJECT_ID,
  reason: 'Founding unit (scope=thread) sans famille actionnable classifiable — trackability indéterminée (5E V2).',
  createdAt: '2026-09-24T19:02:42.784758+00:00',
  evidenceStatus: 'unresolved',
}

const SEXTANT_SUBJECT_LABELS = new Map([[SUBJECT_ID, 'Nettoyage des murs par salle — roulements cuisine']])

const UNRESOLVED_ACTOR: EntityResolution = { status: 'unknown', source: 'llm_only', needs_resolution: true }
const RESOLVED_ACTOR: EntityResolution = {
  status: 'resolved',
  source: 'semantic_memory',
  entityId: 'entity-1',
  canonical: 'Jean Dupont',
  needs_resolution: false,
}

describe('buildVisitOutcomeSummary — témoin Sextant', () => {
  const summary: VisitOutcomeSummary = buildVisitOutcomeSummary({
    visitId: VISIT_ID,
    siteId: SITE_ID,
    crStatus: 'draft',
    proposals: SEXTANT_PROPOSALS,
    pendingTraces: [SEXTANT_PENDING_TRACE],
    subjectLabelsById: SEXTANT_SUBJECT_LABELS,
    actorResolutions: { 'Monsieur Cope': UNRESOLVED_ACTOR, 'Jean Dupont': RESOLVED_ACTOR },
    memoryIndexed: false,
  })

  it('produced liste les 5 propositions de la visite, tous kinds confondus', () => {
    expect(summary.produced.proposals).toHaveLength(5)
  })

  it('materialized ne retient que la proposition réconciliée (canonical_resolution_status=resolved)', () => {
    expect(summary.materialized.proposals).toHaveLength(1)
    expect(summary.materialized.proposals[0].ref.id).toBe('e891c84a-f536-4638-a1c4-474e4a213013')
    expect(summary.materialized.proposals[0].canonicalSubjectLabel).toBe('Nettoyage des murs par salle — roulements cuisine')
  })

  it('unresolved.orphanedProposals retient les 2 actions + 1 échéance non rattachées (not_found)', () => {
    expect(summary.unresolved.orphanedProposals).toHaveLength(3)
    const kinds = summary.unresolved.orphanedProposals.map((p) => p.kind).sort()
    expect(kinds).toEqual(['action', 'action', 'deadline'])
  })

  it('le stakeholder (canonical_resolution_status=null) n\'apparaît ni matérialisé ni orphelin', () => {
    const stakeholder = summary.produced.proposals.find((p) => p.kind === 'stakeholder')
    expect(stakeholder?.canonicalResolutionStatus).toBeNull()
    expect(summary.materialized.proposals.some((p) => p.kind === 'stakeholder')).toBe(false)
    expect(summary.unresolved.orphanedProposals.some((p) => p.kind === 'stakeholder')).toBe(false)
  })

  it('pending.traces expose la trace TRACKABILITY_UNDETERMINED liée au sujet canonique de la visite', () => {
    expect(summary.pending.traces).toHaveLength(1)
    expect(summary.pending.traces[0].canonicalSubjectId).toBe(SUBJECT_ID)
    expect(summary.pending.traces[0].evidenceStatus).toBe('unresolved')
  })

  it('unresolved.actors ne retient que "Monsieur Cope" (needs_resolution=true), pas l\'acteur résolu', () => {
    expect(summary.unresolved.actors).toHaveLength(1)
    expect(summary.unresolved.actors[0].rawText).toBe('Monsieur Cope')
  })

  it('crStatus reflète le statut réel du CR (brouillon)', () => {
    expect(summary.crStatus).toBe('draft')
  })

  it('memoryIndexed reflète l\'absence de knowledge_chunks pour cette visite', () => {
    expect(summary.memoryIndexed).toBe(false)
  })
})

describe('buildVisitOutcomeSummary — visite sans aucune sortie', () => {
  const empty = buildVisitOutcomeSummary({
    visitId: 'empty-visit',
    siteId: 'empty-site',
    crStatus: 'curated',
    proposals: [],
    pendingTraces: [],
    subjectLabelsById: new Map(),
    actorResolutions: {},
    memoryIndexed: false,
  })

  it('toutes les sections sont vides, aucune erreur', () => {
    expect(empty.produced.proposals).toEqual([])
    expect(empty.materialized.proposals).toEqual([])
    expect(empty.pending.traces).toEqual([])
    expect(empty.unresolved.orphanedProposals).toEqual([])
    expect(empty.unresolved.actors).toEqual([])
    expect(empty.memoryIndexed).toBe(false)
  })
})
