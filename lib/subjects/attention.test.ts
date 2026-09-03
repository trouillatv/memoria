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
//  - #228 : éligibilité opérationnelle = nature DURABLE (durableKind), plus la famille d'occurrence.
//    · business_subject (même dominantFamily=knowledge_fact) → opérationnel ;
//    · actor (même dominantFamily=action) → non opérationnel ;
//    · éligible ≠ mérite attention : un business open sans objet reste calme.
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
    durableKind: 'business_subject',
    dominantFamily: 'action',
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
    displayState: 'unknown',
    provenOpen: false,
    ...overrides,
  }
}

// ── Veto absolu : sujets clôturés ─────────────────────────────────────────────

describe('Veto clôturé', () => {
  it('résolu + isStagnant → isClosed, aucun signal', () => {
    // P0-2 : le veto clôturé est fondé sur displayState==='resolved' (vérité d'état partagée),
    // plus sur currentStatus brut.
    const s = makeSubject({ currentStatus: 'done', displayState: 'resolved', isStagnant: true, stagnationDays: 77, consecutiveMentionsWithoutChange: 4 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })

  it('P0-2 D3 : done documentaire MAIS objets actifs ouverts → réouvert, NON clôturé, signalé', () => {
    // Ancien bug D3 : « done » masquait des actions ouvertes. Désormais objets actifs → provenOpen →
    // displayState='reopened' → attention non vetoée.
    const s = makeSubject({
      currentStatus: 'done', displayState: 'reopened', provenOpen: true,
      activeObjects: { actionsOpen: 3, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 3 },
    })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(false)
    expect(sig.attentionReasons).toContain('open_objects')
  })

  it('cancelled + nombreuses occurrences → isClosed', () => {
    const s = makeSubject({ currentStatus: 'cancelled', displayState: 'resolved', pvCount: 8, consecutiveMentionsWithoutChange: 5 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })

  it('not_applicable → isClosed', () => {
    const s = makeSubject({ currentStatus: 'not_applicable', displayState: 'resolved', isStagnant: true, stagnationDays: 90 })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })
})

// ── Veto non opérationnel ─────────────────────────────────────────────────────

describe('#228 — éligibilité opérationnelle = nature durable, pas la famille', () => {
  it('actor → non opérationnel, aucun signal (même avec objets/famille opérationnelle)', () => {
    const s = makeSubject({ durableKind: 'actor', dominantFamily: 'action', currentStatus: 'in_progress',
      activeObjects: { actionsOpen: 3, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 3 } })
    const sig = computeAttentionSignals(s)
    expect(sig.isClosed).toBe(false)
    expect(sig.isOperational).toBe(false)
    expect(sig.attentionReasons).toEqual([]) // durable actor prime sur la famille/objets
  })

  it('business_subject avec dominantFamily=knowledge_fact PORTANT un objet ouvert → opérationnel + open_objects', () => {
    // Témoins Bella A électrique / C nettoyage : business, 1re occ knowledge_fact, action ouverte.
    const s = makeSubject({ durableKind: 'business_subject', dominantFamily: 'knowledge_fact', currentStatus: 'open',
      currentTriState: 'open', activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 1 } })
    const sig = computeAttentionSignals(s)
    expect(sig.isOperational).toBe(true)
    expect(sig.attentionReasons).toContain('open_objects')
  })

  it('business_subject knowledge_fact OUVERT mais SANS objet → opérationnel mais CALME (0 raison)', () => {
    // Témoins Bella B cuisson / E éclairage : éligible ≠ mérite attention.
    const s = makeSubject({ durableKind: 'business_subject', dominantFamily: 'knowledge_fact', currentStatus: 'open',
      currentTriState: 'open', activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 }, isStagnant: false })
    const sig = computeAttentionSignals(s)
    expect(sig.isOperational).toBe(true)      // navigable comme sujet métier
    expect(sig.attentionReasons).toEqual([])  // mais AUCUNE alerte artificielle
  })

  it('durableKind=null (legacy) → opérationnel (business-like)', () => {
    const s = makeSubject({ durableKind: null, dominantFamily: 'observation', currentStatus: null })
    const sig = computeAttentionSignals(s)
    expect(sig.isOperational).toBe(true)
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

describe('Signal reservation (dépend de la FAMILLE dominantFamily, pas du durableKind)', () => {
  it('dominantFamily=reservation (null status) → reservation', () => {
    const s = makeSubject({ dominantFamily: 'reservation', currentStatus: null })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('reservation')
  })

  it('dominantFamily=reservation + résolu → isClosed, pas de reservation', () => {
    const s = makeSubject({ dominantFamily: 'reservation', currentStatus: 'done', displayState: 'resolved' })
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
    const s = makeSubject({ dominantFamily: 'reservation', currentStatus: 'non_compliant' })
    const sig = computeAttentionSignals(s)
    expect(sig.attentionReasons).toContain('non_conformity')
    expect(sig.attentionReasons).toContain('reservation')
  })

  it('sujet null status, dominantFamily null, no objects → aucun signal', () => {
    const s = makeSubject({ dominantFamily: null, currentStatus: null, activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 }, isStagnant: false })
    const sig = computeAttentionSignals(s)
    // business_subject par défaut → opérationnel, mais aucun signal d'attention actif
    expect(sig.isOperational).toBe(true)
    expect(sig.attentionReasons).toEqual([])
  })
})
