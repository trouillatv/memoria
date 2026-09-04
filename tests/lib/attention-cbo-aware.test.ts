// P2 — CONTRAT : les signaux d'urgence Attention (open_with_objects + boost stagnant) se fondent sur
// l'activité DURABLE CBO-aware exposée par NavigableSubjectSummary.activeObjectsCboAware, qui vaut
// activeObjectsTotalForState(subjectCbo, rawActionOpen, nonActionOpen) — la MÊME projection que P0-2.
// Une site_action brute obsolète d'un CBO complété ne compte plus comme activité.

import { describe, it, expect } from 'vitest'
import { activeObjectsTotalForState, deriveCanonicalSubjectCboState, type CboReducedState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const rs = (s: CboReducedState['computedCurrentState']): CboReducedState =>
  ({ computedCurrentState: s, historicalTrajectory: [], stateBasis: [], conflicts: s === 'conflict' ? ['x'] : [], documentaryDivergences: [] })
const scbo = (...states: CboReducedState['computedCurrentState'][]) => deriveCanonicalSubjectCboState(states.map(rs))

// Le signal Attention s'allume ssi activeObjectsCboAware > 0 (open_with_objects, boost stagnant).
const urgencyActive = (subjectCbo: ReturnType<typeof scbo> | undefined, rawActionOpen: boolean, nonActionOpen: boolean) =>
  activeObjectsTotalForState(subjectCbo, rawActionOpen, nonActionOpen) > 0

describe('P2 — activité CBO-aware pour l\'urgence Attention', () => {
  it('action brute open + CBO completed + aucun non-action → PAS d\'activité (pas open_with_objects)', () => {
    expect(urgencyActive(scbo('documentary_completed'), true, false)).toBe(false)
  })
  it('même cas + réserve active → activité via non-action (open_with_objects reste possible)', () => {
    expect(urgencyActive(scbo('documentary_completed'), true, true)).toBe(true)
  })
  it('CBO open → activité (open_with_objects)', () => {
    expect(urgencyActive(scbo('open'), false, false)).toBe(true)
  })
  it('CBO unknown seul → aucune activité inventée', () => {
    expect(urgencyActive(scbo('unknown'), false, false)).toBe(false)
  })
  it('conflict → activité bloquante (compte comme actif)', () => {
    expect(urgencyActive(scbo('conflict'), false, false)).toBe(true)
  })
  it('fallback sans CBO → comportement C2D (vérité brute des actions)', () => {
    expect(urgencyActive(undefined, true, false)).toBe(true)
    expect(urgencyActive(undefined, false, false)).toBe(false)
  })
  it('native_cancelled → non actif (jamais un accomplissement, jamais une activité)', () => {
    expect(urgencyActive(scbo('native_cancelled'), true, false)).toBe(false)
  })
  it('boost stagnant : MÊME projection que open_with_objects (activeObjectsCboAware>0)', () => {
    // completed+raw → 0 (score retombe à 45) ; open → >0 (score 68)
    expect(activeObjectsTotalForState(scbo('documentary_completed'), true, false) > 0).toBe(false)
    expect(activeObjectsTotalForState(scbo('open'), false, false) > 0).toBe(true)
  })
})
