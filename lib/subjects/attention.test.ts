// Tests unitaires — computeAttentionSignals + getBucket veto
//
// Cas couverts :
//  - Veto absolu : done + isStagnant → isClosed=true, aucun signal
//  - Veto absolu : cancelled + activeObjects historiques → isClosed=true
//  - Veto absolu : not_applicable + nombreuses occurrences → isClosed=true
//  - Opérationnel avec objets actifs → open_objects
//  - Non conforme → non_conformity
//  - Réserve → reservation
//  - En attente → awaiting
//  - Stagnant → stagnant
//  - Combinaisons : stagnant + objets actifs → les deux raisons
//  - knowledge_fact → isOperational=false, aucun signal
//  - Deadline → STAGNATION_INELIGIBLE, donc jamais stagnant côté serveur
//              mais si isStagnant=true (ancien bug), le veto closed protège

import { describe, it, expect } from 'vitest'
import { computeAttentionSignals } from './attention'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'

function makeSubject(overrides: Partial<NavigableSubjectSummary>): NavigableSubjectSummary {
  return {
    canonicalSubjectId: 'cs-test',
    title: 'Sujet test',
    aliases: [],
    kind: 'action',
    currentStatus: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    lastMeaningfulChangeAt: '2026-01-01',
    pvCount: 3,
    threadCount: 1,
    nativeOccurrenceCount: 0,
    activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    isStagnant: false,
    stagnationDays: 0,
    consecutiveMentionsWithoutChange: 0,
    terrainObjects: [],
    currentTriState: 'unknown',
    ...overrides,
  }
}

// ── Veto absolu : sujets clôturés ─────────────────────────────────────────────

describe('Veto clôturé', () => {
  it('done + isStagnant → isClosed, aucun signal', () => {
    const s = makeSubject({ currentStatus: 'done', isStagnant: true, stagnationDays: 77, consecutiveMentionsWithoutChange: 4 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })

  it('done + activeObjects historiques → isClosed, aucun signal', () => {
    const s = makeSubject({
      currentStatus: 'done',
      activeObjects: { actionsOpen: 3, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 3 },
    })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })

  it('cancelled + nombreuses occurrences → isClosed', () => {
    const s = makeSubject({ currentStatus: 'cancelled', pvCount: 8, consecutiveMentionsWithoutChange: 5 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })

  it('not_applicable → isClosed', () => {
    const s = makeSubject({ currentStatus: 'not_applicable', isStagnant: true, stagnationDays: 90 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })
})

// ── Veto non opérationnel ─────────────────────────────────────────────────────

describe('Veto non opérationnel', () => {
  it('knowledge_fact → isOperational=false, aucun signal', () => {
    const s = makeSubject({ kind: 'knowledge_fact', currentStatus: 'in_progress', pvCount: 5 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(false)
    expect(sig.isOperational).toBe(false)
    expect(sig.attentionReasons).toEqual([])
  })

  it('person → aucun signal', () => {
    const s = makeSubject({ kind: 'person' })
    const sig = computeAttentionSignals(s)
    expect(sig.isOperational).toBe(false)
    expect(sig.attentionReasons).toEqual([])
  })

  it('company → aucun signal', () => {
    const s = makeSubject({ kind: 'company' })
    const sig = computeAttentionSignals(s)
    expect(sig.isOperational).toBe(false)
    expect(sig.attentionReasons).toEqual([])
  })
})

// ── Signaux individuels ───────────────────────────────────────────────────────

describe('Signal open_objects', () => {
  it('activeObjects.total > 0 → open_objects', () => {
    const s = makeSubject({ activeObjects: { actionsOpen: 2, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 2 } })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('open_objects')
  })

  it('activeObjects.total = 0 → pas de open_objects', () => {
    const s = makeSubject({ activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 } })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).not.toContain('open_objects')
  })
})

describe('Signal non_conformity', () => {
  it('non_compliant → non_conformity', () => {
    const s = makeSubject({ currentStatus: 'non_compliant' })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('non_conformity')
  })
})

describe('Signal reservation', () => {
  it('kind=reservation (null status) → reservation', () => {
    const s = makeSubject({ kind: 'reservation', currentStatus: null })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('reservation')
  })

  it('kind=reservation + done → isClosed, pas de reservation', () => {
    const s = makeSubject({ kind: 'reservation', currentStatus: 'done' })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })
})

describe('Signal awaiting', () => {
  it('awaiting_validation → awaiting', () => {
    const s = makeSubject({ currentStatus: 'awaiting_validation' })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('awaiting')
  })
})

describe('Signal stagnant', () => {
  it('isStagnant=true + statut ouvert → stagnant', () => {
    const s = makeSubject({ isStagnant: true, stagnationDays: 45, currentStatus: 'open' })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('stagnant')
  })

  it('isStagnant=false → pas de stagnant', () => {
    const s = makeSubject({ isStagnant: false })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).not.toContain('stagnant')
  })
})

// ── Combinaisons ──────────────────────────────────────────────────────────────

describe('Combinaisons', () => {
  it('stagnant + objets actifs → les deux raisons', () => {
    const s = makeSubject({
      isStagnant: true,
      stagnationDays: 77,
      activeObjects: { actionsOpen: 5, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 5 },
      currentStatus: null,
    })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('open_objects')
    expect(sig.attentionReasons).toContain('stagnant')
    expect(sig.isClosed).toBe(false)
  })

  it('réserve non conforme → non_conformity + reservation', () => {
    const s = makeSubject({ kind: 'reservation', currentStatus: 'non_compliant' })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('non_conformity')
    expect(sig.attentionReasons).toContain('reservation')
  })

  it('sujet null status, null kind, no objects → aucun signal', () => {
    const s = makeSubject({ kind: null, currentStatus: null, activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 }, isStagnant: false })
    const sig = computeAttentionSignals(s)
    // kind=null → opérationnel par défaut, mais aucun signal d'attention actif
    expect(sig.isOperational).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })
})
