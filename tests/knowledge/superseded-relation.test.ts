import { describe, expect, it } from 'vitest'
import {
  resolveSupersededRelation,
  buildActiveByCanonicalSubject,
} from '@/lib/knowledge/superseded-relation'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'

// ── RÉSOLUTION DES PROPOSITIONS SUPERSEDED ───────────────────────────────────
//
// Trois niveaux sans inventer de filiation :
//   1. superseded_by FK      → 'replaced_by'       (preuve structurelle directe)
//   2. canonical_subject_id, 1 active unique        → 'same_subject_one' (deterministe)
//   3. canonical_subject_id, N > 1 actives          → 'same_subject_many' (ambigu)
//   4. aucun lien exploitable                       → 'previous_version'
//
// superseded_by reste prioritaire sur canonical_subject_id.
// Ne pas remplir superseded_by par heuristique.

function makeProposal(overrides: Partial<DbKnowledgeProposal>): DbKnowledgeProposal {
  return {
    id: 'p-default',
    organization_id: 'org-1',
    site_id: 'site-1',
    report_id: 'report-1',
    kind: 'knowledge',
    title: 'Titre par defaut',
    body: null,
    payload: {},
    confidence: null,
    source_capture_ids: [],
    dedupe_key: 'key-default',
    analysis_version: 1,
    status: 'superseded',
    promoted_object_type: null,
    promoted_object_id: null,
    superseded_by: null,
    dismiss_reason: null,
    reviewed_at: null,
    reviewed_by: null,
    canonical_subject_id: null,
    canonical_resolution_status: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const ACTIVE_A = makeProposal({ id: 'active-a', status: 'proposed', canonical_subject_id: 'cs-1', title: 'Formulation finale A' })
const ACTIVE_B = makeProposal({ id: 'active-b', status: 'proposed', canonical_subject_id: 'cs-1', title: 'Formulation finale B' })
const ACTIVE_C = makeProposal({ id: 'active-c', status: 'proposed', canonical_subject_id: 'cs-2', title: 'Formulation finale C' })

describe('buildActiveByCanonicalSubject', () => {
  it('indexe les actives par canonical_subject_id', () => {
    const map = buildActiveByCanonicalSubject([ACTIVE_A, ACTIVE_B, ACTIVE_C])
    expect(map.get('cs-1')).toHaveLength(2)
    expect(map.get('cs-2')).toHaveLength(1)
  })

  it('ignore les proposals sans canonical_subject_id', () => {
    const noSubject = makeProposal({ id: 'x', status: 'proposed', canonical_subject_id: null })
    const map = buildActiveByCanonicalSubject([noSubject])
    expect(map.size).toBe(0)
  })
})

describe('resolveSupersededRelation', () => {
  const activeTitleById = new Map([
    ['active-a', ACTIVE_A.title],
    ['active-b', ACTIVE_B.title],
    ['active-c', ACTIVE_C.title],
  ])

  describe('niveau 1 — superseded_by FK explicite', () => {
    it('retourne replaced_by quand superseded_by pointe vers une active connue', () => {
      const old = makeProposal({ superseded_by: 'active-a', canonical_subject_id: 'cs-1' })
      const map = buildActiveByCanonicalSubject([ACTIVE_A, ACTIVE_B])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel).toEqual({ kind: 'replaced_by', title: 'Formulation finale A' })
    })

    it('prioritaire sur canonical_subject_id meme si celui-ci donnerait same_subject_one', () => {
      const old = makeProposal({ superseded_by: 'active-c', canonical_subject_id: 'cs-2' })
      const map = buildActiveByCanonicalSubject([ACTIVE_C])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel.kind).toBe('replaced_by')
    })

    it('tombe au niveau suivant si superseded_by ne correspond a aucune active', () => {
      const old = makeProposal({ superseded_by: 'introuvable', canonical_subject_id: 'cs-2' })
      const map = buildActiveByCanonicalSubject([ACTIVE_C])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel.kind).toBe('same_subject_one')
    })
  })

  describe('niveau 2 — canonical_subject_id, 1 active', () => {
    it('retourne same_subject_one quand une seule active partage le canonical_subject_id', () => {
      const old = makeProposal({ canonical_subject_id: 'cs-2' })
      const map = buildActiveByCanonicalSubject([ACTIVE_A, ACTIVE_C])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel).toEqual({ kind: 'same_subject_one', title: 'Formulation finale C' })
    })
  })

  describe('niveau 3 — canonical_subject_id, N > 1 actives', () => {
    it('retourne same_subject_many quand plusieurs actives partagent le canonical_subject_id', () => {
      const old = makeProposal({ canonical_subject_id: 'cs-1' })
      const map = buildActiveByCanonicalSubject([ACTIVE_A, ACTIVE_B])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel.kind).toBe('same_subject_many')
      if (rel.kind === 'same_subject_many') {
        expect(rel.count).toBe(2)
        expect(rel.titles).toContain('Formulation finale A')
        expect(rel.titles).toContain('Formulation finale B')
      }
    })
  })

  describe('niveau 4 — aucun lien exploitable', () => {
    it('retourne previous_version quand canonical_subject_id est NULL', () => {
      const old = makeProposal({ canonical_subject_id: null })
      const map = buildActiveByCanonicalSubject([ACTIVE_A])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel).toEqual({ kind: 'previous_version' })
    })

    it('retourne previous_version quand le canonical_subject_id a zero active', () => {
      const old = makeProposal({ canonical_subject_id: 'cs-orphelin' })
      const map = buildActiveByCanonicalSubject([ACTIVE_A])
      const rel = resolveSupersededRelation(old, activeTitleById, map)
      expect(rel).toEqual({ kind: 'previous_version' })
    })

    it('PETRO — stakeholder sans canonical_subject_id retourne previous_version', () => {
      const agp = makeProposal({ kind: 'stakeholder', title: 'AGP', canonical_subject_id: null })
      const map = buildActiveByCanonicalSubject([])
      const rel = resolveSupersededRelation(agp, new Map(), map)
      expect(rel).toEqual({ kind: 'previous_version' })
    })

    it('PETRO — 1 cible via canonical_subject retourne same_subject_one', () => {
      const absenceJus = makeProposal({ kind: 'vigilance', title: 'Absence de jus au TD', canonical_subject_id: 'cs-td' })
      const ilNyAPas   = makeProposal({ id: 'active-td', status: 'proposed', canonical_subject_id: 'cs-td', title: 'Pas de jus sortant du TD' })
      const map = buildActiveByCanonicalSubject([ilNyAPas])
      const rel = resolveSupersededRelation(absenceJus, new Map([['active-td', ilNyAPas.title]]), map)
      expect(rel).toEqual({ kind: 'same_subject_one', title: 'Pas de jus sortant du TD' })
    })

    it('PETRO — 5 cibles via canonical_subject retourne same_subject_many', () => {
      const depose = makeProposal({ kind: 'decision', title: 'Le lancement de la depose est acte.', canonical_subject_id: 'cs-depose' })
      const actives = ['A', 'B', 'C', 'D', 'E'].map((l) =>
        makeProposal({ id: `active-${l}`, status: 'proposed', canonical_subject_id: 'cs-depose', title: `Formulation ${l}` })
      )
      const map = buildActiveByCanonicalSubject(actives)
      const rel = resolveSupersededRelation(depose, new Map(actives.map((a) => [a.id, a.title])), map)
      expect(rel.kind).toBe('same_subject_many')
      if (rel.kind === 'same_subject_many') expect(rel.count).toBe(5)
    })
  })
})
