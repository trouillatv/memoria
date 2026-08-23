// Tests P1-3B — moteur d'état canonique tri-state
// Sources de vérité : P1-3A §6 table de vérité, doctrine unknown, D1

import { describe, expect, it } from 'vitest'
import {
  aggregatePvState,
  computeSubjectTransition,
  deriveCurrentResolvedState,
  documentStatusToPvState,
} from './subject-state'

// ── documentStatusToPvState ────────────────────────────────────────────────

describe('documentStatusToPvState', () => {
  it('null → unknown (jamais open par défaut)', () => {
    expect(documentStatusToPvState(null)).toBe('unknown')
  })

  it('done → resolved', () => {
    expect(documentStatusToPvState('done')).toBe('resolved')
  })

  it('cancelled → resolved', () => {
    expect(documentStatusToPvState('cancelled')).toBe('resolved')
  })

  it('informational → resolved', () => {
    expect(documentStatusToPvState('informational')).toBe('resolved')
  })

  it('open → open', () => {
    expect(documentStatusToPvState('open')).toBe('open')
  })

  it('in_progress → open', () => {
    expect(documentStatusToPvState('in_progress')).toBe('open')
  })

  it('planned → open', () => {
    expect(documentStatusToPvState('planned')).toBe('open')
  })

  it('non_compliant → open', () => {
    expect(documentStatusToPvState('non_compliant')).toBe('open')
  })

  it('awaiting_validation → open', () => {
    expect(documentStatusToPvState('awaiting_validation')).toBe('open')
  })

  it('valeur non reconnue → unknown', () => {
    expect(documentStatusToPvState('weird_value')).toBe('unknown')
  })

  it('chaîne vide → unknown', () => {
    expect(documentStatusToPvState('')).toBe('unknown')
  })
})

// ── aggregatePvState ───────────────────────────────────────────────────────

describe('aggregatePvState', () => {
  it('liste vide → unknown', () => {
    expect(aggregatePvState([])).toBe('unknown')
  })

  it('tous null → unknown (pas de faux open)', () => {
    expect(aggregatePvState([null, null])).toBe('unknown')
  })

  it('null + open → open (signal open présent)', () => {
    expect(aggregatePvState([null, 'open'])).toBe('open')
  })

  it('null + done → resolved (signal résolu présent)', () => {
    expect(aggregatePvState([null, 'done'])).toBe('resolved')
  })

  it('open + done → resolved (resolved prime sur open)', () => {
    expect(aggregatePvState(['open', 'done'])).toBe('resolved')
  })

  it('done + open → resolved (court-circuit immédiat)', () => {
    expect(aggregatePvState(['done', 'open'])).toBe('resolved')
  })

  it('planned + cancelled → resolved', () => {
    expect(aggregatePvState(['planned', 'cancelled'])).toBe('resolved')
  })

  it('un seul open → open', () => {
    expect(aggregatePvState(['open'])).toBe('open')
  })

  it('un seul null → unknown', () => {
    expect(aggregatePvState([null])).toBe('unknown')
  })
})

// ── computeSubjectTransition — table de vérité P1-3A §6 ───────────────────

describe('computeSubjectTransition', () => {
  // ── NEW_CYCLE (priorité absolue) ──
  it('NEW_CYCLE prend priorité absolue', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: true, currSignal: 'open', isNewCycle: true })).toBe('NEW_CYCLE')
    expect(computeSubjectTransition({ prevResolved: false, hasGap: false, currSignal: 'open', isNewCycle: true })).toBe('NEW_CYCLE')
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'unknown', isNewCycle: true })).toBe('NEW_CYCLE')
  })

  // ── REOPEN ──
  it('prevResolved=true + open sans gap → REOPEN', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: false, currSignal: 'open', isNewCycle: false })).toBe('REOPEN')
  })

  it('D1 : resolved → gap → open = REOPEN (jamais REAPPEARANCE)', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: true, currSignal: 'open', isNewCycle: false })).toBe('REOPEN')
  })

  // ── REAPPEARANCE ──
  it('gap + prevResolved=false + open → REAPPEARANCE', () => {
    expect(computeSubjectTransition({ prevResolved: false, hasGap: true, currSignal: 'open', isNewCycle: false })).toBe('REAPPEARANCE')
  })

  it('gap + prevResolved=null + open → REAPPEARANCE', () => {
    expect(computeSubjectTransition({ prevResolved: null, hasGap: true, currSignal: 'open', isNewCycle: false })).toBe('REAPPEARANCE')
  })

  it('gap + prevResolved=false + unknown → REAPPEARANCE (retour quelconque)', () => {
    expect(computeSubjectTransition({ prevResolved: false, hasGap: true, currSignal: 'unknown', isNewCycle: false })).toBe('REAPPEARANCE')
  })

  it('gap + prevResolved=null + unknown → REAPPEARANCE', () => {
    expect(computeSubjectTransition({ prevResolved: null, hasGap: true, currSignal: 'unknown', isNewCycle: false })).toBe('REAPPEARANCE')
  })

  // ── RESOLVED ──
  it('prevResolved=false + resolved sans gap → RESOLVED', () => {
    expect(computeSubjectTransition({ prevResolved: false, hasGap: false, currSignal: 'resolved', isNewCycle: false })).toBe('RESOLVED')
  })

  it('prevResolved=null + resolved → RESOLVED', () => {
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'resolved', isNewCycle: false })).toBe('RESOLVED')
  })

  // ── REPEAT_WITHOUT_CHANGE ──
  it('prevResolved=true + resolved → REPEAT_WITHOUT_CHANGE (maintien résolu)', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: false, currSignal: 'resolved', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('prevResolved=true + unknown → REPEAT_WITHOUT_CHANGE (gap résolu→unknown)', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: false, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('D1 côté unknown : resolved → gap → unknown = REPEAT_WITHOUT_CHANGE', () => {
    expect(computeSubjectTransition({ prevResolved: true, hasGap: true, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('currSignal=unknown sans contexte → REPEAT_WITHOUT_CHANGE', () => {
    expect(computeSubjectTransition({ prevResolved: false, hasGap: false, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('currSignal=unknown + prevResolved=null → REPEAT_WITHOUT_CHANGE', () => {
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  // ── CONTINUATION ──
  it('prevResolved=false + open sans gap → CONTINUATION', () => {
    expect(computeSubjectTransition({ prevResolved: false, hasGap: false, currSignal: 'open', isNewCycle: false })).toBe('CONTINUATION')
  })

  it('prevResolved=null + open sans gap → CONTINUATION (première occurrence)', () => {
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'open', isNewCycle: false })).toBe('CONTINUATION')
  })

  // ── Cas unknown spécifiques (doctrine P1-3B §6) ──
  it('open → unknown : REPEAT_WITHOUT_CHANGE (unknown sans changement positif)', () => {
    // prevResolved=false (open précédent), signal=unknown, pas de gap
    expect(computeSubjectTransition({ prevResolved: false, hasGap: false, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('resolved → unknown : REPEAT_WITHOUT_CHANGE (résolu maintenu)', () => {
    // prevResolved=true, signal=unknown, pas de gap
    expect(computeSubjectTransition({ prevResolved: true, hasGap: false, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })

  it('unknown → open : CONTINUATION (première évidence open)', () => {
    // prevResolved=null (tous unknown avant), signal=open
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'open', isNewCycle: false })).toBe('CONTINUATION')
  })

  it('unknown → resolved : RESOLVED (première évidence resolved)', () => {
    // prevResolved=null (tous unknown avant), signal=resolved
    expect(computeSubjectTransition({ prevResolved: null, hasGap: false, currSignal: 'resolved', isNewCycle: false })).toBe('RESOLVED')
  })

  it('unknown → gap → unknown : REAPPEARANCE (retour avec gap sans résolution antérieure)', () => {
    // prevResolved=null, gap=true, signal=unknown
    expect(computeSubjectTransition({ prevResolved: null, hasGap: true, currSignal: 'unknown', isNewCycle: false })).toBe('REAPPEARANCE')
  })

  it('resolved → gap → unknown : REPEAT_WITHOUT_CHANGE (résolu antérieur préservé)', () => {
    // prevResolved=true, gap=true, signal=unknown
    expect(computeSubjectTransition({ prevResolved: true, hasGap: true, currSignal: 'unknown', isNewCycle: false })).toBe('REPEAT_WITHOUT_CHANGE')
  })
})

// ── deriveCurrentResolvedState ─────────────────────────────────────────────

describe('deriveCurrentResolvedState', () => {
  it('liste vide → null (aucun signal connu)', () => {
    expect(deriveCurrentResolvedState([])).toBeNull()
  })

  it('tous unknown → null (aucun signal fiable)', () => {
    expect(deriveCurrentResolvedState(['unknown', 'unknown'])).toBeNull()
  })

  it('dernier open → false', () => {
    expect(deriveCurrentResolvedState(['resolved', 'open'])).toBe(false)
  })

  it('dernier resolved → true', () => {
    expect(deriveCurrentResolvedState(['open', 'resolved'])).toBe(true)
  })

  it('unknown intermédiaire ignoré : open, unknown, resolved → true', () => {
    expect(deriveCurrentResolvedState(['open', 'unknown', 'resolved'])).toBe(true)
  })

  it('unknown intermédiaire ignoré : resolved, unknown, open → false', () => {
    expect(deriveCurrentResolvedState(['resolved', 'unknown', 'open'])).toBe(false)
  })

  it('unknown final ignoré, lit le dernier signal utile : open, resolved, unknown → true', () => {
    expect(deriveCurrentResolvedState(['open', 'resolved', 'unknown'])).toBe(true)
  })

  it('séquence longue avec plusieurs unknown intercalés', () => {
    // open, unknown, unknown, resolved, unknown → true (resolved est le dernier non-unknown)
    expect(deriveCurrentResolvedState(['open', 'unknown', 'unknown', 'resolved', 'unknown'])).toBe(true)
  })

  it('un seul open → false', () => {
    expect(deriveCurrentResolvedState(['open'])).toBe(false)
  })

  it('un seul resolved → true', () => {
    expect(deriveCurrentResolvedState(['resolved'])).toBe(true)
  })

  it('un seul unknown → null', () => {
    expect(deriveCurrentResolvedState(['unknown'])).toBeNull()
  })
})
