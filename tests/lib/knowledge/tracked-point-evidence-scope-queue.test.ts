// P0-D (mandat Vincent, 2026-09-17) — test UNITAIRE (pur, zéro DB) de buildEvidenceScopeQueue.
//
// Couvre les deux défauts corrigés sur le witness Centre commercial Dumbéa Mall :
// 1) dédup de propositions identiques (même document + page + extrait normalisé) au sein d'une
//    même entrée — jamais de fusion quand l'extrait est vide/absent (identité non prouvée) ;
// 2) exclusion STALE_ALREADY_TRACKED (thread déjà membre actif d'un tracked_point, ou déjà
//    founding_reference littéral) — même règle que tracked-point-pending-trackability-queue.ts,
//    ids exclus conservés dans excludedAlreadyTracked (jamais perdus en silence).

import { describe, it, expect } from 'vitest'
import {
  buildEvidenceScopeQueue,
  type EvidenceScopeCandidateProposal,
  type EvidenceScopePendingTraceRow,
} from '@/lib/knowledge/tracked-point-evidence-scope-queue'

function trace(id: string, overrides: Partial<EvidenceScopePendingTraceRow> = {}): EvidenceScopePendingTraceRow {
  return {
    id,
    kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
    sourceThreadId: `thread-${id}`,
    siteId: 'site-1',
    reason: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function proposal(id: string, overrides: Partial<EvidenceScopeCandidateProposal> = {}): EvidenceScopeCandidateProposal {
  return {
    proposalId: id,
    family: 'obligation',
    label: `proposal ${id}`,
    documentStatus: null,
    documentId: 'doc-1',
    documentFilename: 'doc.pdf',
    documentType: 'pv',
    documentEffectiveDate: '2026-01-01',
    sourcePage: 3,
    sourceExcerpt: 'Vérifier le désenfumage du niveau 2.',
    hasVerbatimExcerpt: true,
    createdAt: '2026-01-01T00:00:00Z',
    alreadySelected: false,
    ...overrides,
  }
}

describe('buildEvidenceScopeQueue', () => {
  it('déduplique deux propositions identiques (même document+page+extrait normalisé)', () => {
    const t = trace('t1')
    const proposals = new Map([
      [t.sourceThreadId, [proposal('p1'), proposal('p2', { sourceExcerpt: '  Vérifier   le désenfumage du niveau 2.  ' })]],
    ])

    const queue = buildEvidenceScopeQueue('site-1', [t], proposals, new Map(), new Map(), new Set())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].proposalCount).toBe(1)
    expect(queue.entries[0].proposals.map((p) => p.proposalId)).toEqual(['p1'])
  })

  it('ne déduplique jamais deux propositions à extrait vide/absent (identité non prouvée)', () => {
    const t = trace('t1')
    const proposals = new Map([
      [t.sourceThreadId, [proposal('p1', { sourceExcerpt: null, hasVerbatimExcerpt: false }), proposal('p2', { sourceExcerpt: null, hasVerbatimExcerpt: false })]],
    ])

    const queue = buildEvidenceScopeQueue('site-1', [t], proposals, new Map(), new Map(), new Set())

    expect(queue.entries[0].proposalCount).toBe(2)
  })

  it('garde deux propositions distinctes si la page diffère', () => {
    const t = trace('t1')
    const proposals = new Map([
      [t.sourceThreadId, [proposal('p1', { sourcePage: 3 }), proposal('p2', { sourcePage: 4 })]],
    ])

    const queue = buildEvidenceScopeQueue('site-1', [t], proposals, new Map(), new Map(), new Set())

    expect(queue.entries[0].proposalCount).toBe(2)
  })

  it('exclut un thread STALE_ALREADY_TRACKED et conserve son id dans excludedAlreadyTracked', () => {
    const t1 = trace('t1')
    const t2 = trace('t2')
    const proposals = new Map([
      [t1.sourceThreadId, [proposal('p1')]],
      [t2.sourceThreadId, [proposal('p2')]],
    ])
    const alreadyTrackedThreadIds = new Set([t1.sourceThreadId])

    const queue = buildEvidenceScopeQueue('site-1', [t1, t2], proposals, new Map(), new Map(), alreadyTrackedThreadIds)

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].pendingTraceId).toBe('t2')
    expect(queue.excludedAlreadyTracked).toEqual(['t1'])
    expect(queue.totalEntries).toBe(1)
  })

  it('ne exclut rien quand aucun thread n\'est déjà tracké', () => {
    const t1 = trace('t1')
    const proposals = new Map([[t1.sourceThreadId, [proposal('p1')]]])

    const queue = buildEvidenceScopeQueue('site-1', [t1], proposals, new Map(), new Map(), new Set())

    expect(queue.excludedAlreadyTracked).toEqual([])
    expect(queue.totalEntries).toBe(1)
  })

  // Mandat Vincent P0 Needs-you (2026-09-22) : le filtrage document-actif se fait en amont, dans
  // loadEvidenceScopeQueue (jamais dans buildEvidenceScopeQueue, qui reste pur) — quand toutes les
  // propositions d'un thread ont déjà été retirées avant l'appel, la trace n'a plus d'option
  // active et bascule dans excludedNoActiveEvidence, jamais silencieusement absente de la file.
  it('exclut une trace dont le thread n\'a plus aucune proposition (document soft-supprimé en amont) dans excludedNoActiveEvidence', () => {
    const t1 = trace('t1')
    const t2 = trace('t2')
    const proposals = new Map([
      [t1.sourceThreadId, []],
      [t2.sourceThreadId, [proposal('p2')]],
    ])

    const queue = buildEvidenceScopeQueue('site-1', [t1, t2], proposals, new Map(), new Map(), new Set())

    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0].pendingTraceId).toBe('t2')
    expect(queue.excludedNoActiveEvidence).toEqual(['t1'])
    expect(queue.totalEntries).toBe(1)
  })
})
