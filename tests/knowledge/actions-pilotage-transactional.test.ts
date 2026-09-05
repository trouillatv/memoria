import { describe, it, expect } from 'vitest'
import { assembleActionsPilotage, type PilotageSubjectContext } from '@/lib/knowledge/actions-pilotage'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import { reduceCboLifecycle, isActiveCboState, type CboLifecycleEvent } from '@/lib/knowledge/cbo-lifecycle-reducer'

// P3-Actions-Lot1 — le read-model expose targetActionId ; le geste humain (native) traverse C2A.

function entry(over: Partial<CboReducedEntry> = {}): CboReducedEntry {
  return {
    cboId: 'c1', canonicalSubjectId: 's1', label: 'Obligation', nature: { nature: 'unknown', stateChar: 'unknown' },
    reduced: { computedCurrentState: 'open', historicalTrajectory: [], stateBasis: [], conflicts: [], documentaryDivergences: [] },
    documentaryHighCount: 0, suppressedByNature: 0, docOpenCount: 0, membersSharedWithCompletionDoc: 0,
    targetActionId: 'a1', ...over,
  }
}
const ctx = (): Map<string, PilotageSubjectContext> =>
  new Map([['s1', { canonicalSubjectId: 's1', title: 'Sujet', displayState: 'open', lastMeaningfulChangeAt: null, pvCount: 3 }]])

const ev = (kind: CboLifecycleEvent['kind'], at: string): CboLifecycleEvent => ({ kind, attestedAt: at, eventAt: at })

describe('read-model : propagation targetActionId', () => {
  it('expose targetActionId sur le PilotageCbo', () => {
    const out = assembleActionsPilotage(ctx(), [entry({ targetActionId: 'action-42' })], 0)
    expect(out.subjects[0].cbos[0].targetActionId).toBe('action-42')
  })
  it('targetActionId null (aucun membre vivant) reste null', () => {
    const out = assembleActionsPilotage(ctx(), [entry({ targetActionId: null })], 0)
    expect(out.subjects[0].cbos[0].targetActionId).toBeNull()
  })
})

describe('geste humain via C2A (réducteur pur)', () => {
  it('close : doc_open puis native_completed → native_completed (inactif)', () => {
    const r = reduceCboLifecycle([ev('doc_open', '2025-05-01'), ev('native_completed', '2026-09-05')])
    expect(r.computedCurrentState).toBe('native_completed')
    expect(isActiveCboState(r.computedCurrentState)).toBe(false)
  })
  it('reopen : native_completed puis native_reopened → native_reopened (actif)', () => {
    const r = reduceCboLifecycle([ev('native_completed', '2026-09-05'), ev('native_reopened', '2026-09-06')])
    expect(r.computedCurrentState).toBe('native_reopened')
    expect(isActiveCboState(r.computedCurrentState)).toBe(true)
  })
  it('divergence : native_completed puis doc_open ultérieur → reste native_completed + divergence', () => {
    const r = reduceCboLifecycle([ev('native_completed', '2026-09-05'), ev('doc_open', '2026-12-01')])
    expect(r.computedCurrentState).toBe('native_completed')
    expect(r.documentaryDivergences.length).toBeGreaterThan(0)
  })
  it('provenance distincte : native_completed ≠ documentary_completed', () => {
    const native = reduceCboLifecycle([ev('native_completed', '2026-09-05')])
    const documentary = reduceCboLifecycle([ev('doc_completion', '2026-07-22')])
    expect(native.computedCurrentState).toBe('native_completed')
    expect(documentary.computedCurrentState).toBe('documentary_completed')
    expect(native.computedCurrentState).not.toBe(documentary.computedCurrentState)
  })
  it('natif > documentaire : un doc_open ne réactive jamais un native_completed', () => {
    const r = reduceCboLifecycle([ev('native_completed', '2026-09-05'), ev('doc_open', '2026-12-01')])
    expect(isActiveCboState(r.computedCurrentState)).toBe(false)
  })
})
