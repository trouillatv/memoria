// Test UNITAIRE — Phase 2 (programme Point de suivi). Réducteur PUR (aucune DB, aucun LLM).
// Rejoue intégralement la table de vérité à 12 lignes de P0-1H-GATES-POINT-DE-SUIVI.md § Gate 4,
// plus les trois étalons (F8, RIA, CTA) qui ont validé le design.

import { describe, it, expect } from 'vitest'
import {
  reduceTrackedPointLifecycle,
  type PointLifecycleEvent,
  type PointCboMember,
} from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import type { CboReducedState, CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const ev = (kind: PointLifecycleEvent['kind'], attestedAt: string, eventAt?: string): PointLifecycleEvent => ({ kind, attestedAt, eventAt })

const cbo = (s: CboComputedCurrentState, id = 'cbo1'): PointCboMember => ({
  cboId: id,
  reduced: { computedCurrentState: s, historicalTrajectory: [], stateBasis: [], conflicts: s === 'conflict' ? ['x'] : [], documentaryDivergences: [] } satisfies CboReducedState,
})

describe('reduceTrackedPointLifecycle — table de vérité Gate 4 (12 lignes)', () => {
  it('1. kf resolved daté, aucun CBO → resolved', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('1bis. kf resolved + intent_set antérieur, aucun CBO → resolved (F8 sans CBO)', () => {
    const r = reduceTrackedPointLifecycle([ev('intent_set', '2025-03-01')], [ev('resolution_signal', '2026-07-01')], [])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('2. kf resolved + CBO native_completed → resolved (concordance)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [cbo('native_completed')])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('2bis. kf resolved + CBO documentary_completed → resolved (concordance)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [cbo('documentary_completed')])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('3. kf resolved + CBO open (vérité native vivante) → open + documentaryDivergence', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [cbo('open')])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('documentaryDivergence')
    expect(r.documentaryDivergences.length).toBeGreaterThan(0)
  })

  it('3bis. kf resolved + CBO progressing → open + documentaryDivergence', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [cbo('progressing')])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('documentaryDivergence')
  })

  it('4. kf resolved + CBO unknown → resolved (CBO muet ne bloque pas une preuve)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-07-01')], [cbo('unknown')])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('5. kf resolved + CBO native_reopened postérieur → reopened, résolution conservée en historique', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2025-05-01')], [cbo('native_reopened')])
    expect(r.computedCurrentState).toBe('reopened')
    expect(r.historicalTrajectory.some((t) => t.kind === 'resolution_signal')).toBe(true)
  })

  it('6. open_signal daté après un resolved (tout) → reopened', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2025-05-01'), ev('open_signal', '2026-01-10')], [])
    expect(r.computedCurrentState).toBe('reopened')
  })

  it('6bis. open_signal après resolved, quel que soit le CBO (resolving) → reopened (trajectoire propre prime)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2025-05-01'), ev('open_signal', '2026-01-10')], [cbo('native_completed')])
    expect(r.computedCurrentState).toBe('reopened')
  })

  it('7. déclaratif "semble réalisé" + CBO open → open + marqueur to_confirm (ne résout jamais)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_claimed', '2026-03-01')], [cbo('open')])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('to_confirm')
  })

  it('7bis. déclaratif "semble réalisé" sans CBO → open + to_confirm', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_claimed', '2026-03-01')], [])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('to_confirm')
  })

  it('8. intent_set seul, aucun CBO → open (engagement non appliqué)', () => {
    const r = reduceTrackedPointLifecycle([ev('intent_set', '2025-03-01')], [], [])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).not.toContain('awaiting_decision')
    expect(r.markers).not.toContain('closed_by_decision')
  })

  it('9. no_action_decided seul, aucun CBO → resolved (closed_by_decision)', () => {
    const r = reduceTrackedPointLifecycle([ev('no_action_decided', '2025-06-01')], [], [])
    expect(r.computedCurrentState).toBe('resolved')
    expect(r.markers).toContain('closed_by_decision')
  })

  it('10. decision_pending seul, aucun CBO → open (awaiting_decision)', () => {
    const r = reduceTrackedPointLifecycle([ev('decision_pending', '2025-06-01')], [], [])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('awaiting_decision')
  })

  it('11. résolution et ouverture à la même date métier (même Point) → conflict', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-01-10'), ev('open_signal', '2026-01-10')], [])
    expect(r.computedCurrentState).toBe('conflict')
    expect(r.conflicts.length).toBeGreaterThan(0)
  })

  it('11bis. conflit non tranché par l\'ordre d\'insertion (permutation)', () => {
    const a = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-01-10'), ev('open_signal', '2026-01-10')], [])
    const b = reduceTrackedPointLifecycle([], [ev('open_signal', '2026-01-10'), ev('resolution_signal', '2026-01-10')], [])
    expect(a.computedCurrentState).toBe('conflict')
    expect(b.computedCurrentState).toBe('conflict')
  })

  it('12. aucun signal daté exploitable, aucun CBO → unknown', () => {
    const r = reduceTrackedPointLifecycle([], [], [])
    expect(r.computedCurrentState).toBe('unknown')
  })

  it('12bis. aucun signal Point, CBO unknown → unknown', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('unknown')])
    expect(r.computedCurrentState).toBe('unknown')
  })
})

describe('reduceTrackedPointLifecycle — Point à CBO seul (pas de signal Point), consommé tel quel', () => {
  it('CBO resolving seul → resolved (étalon RIA "listing/plan")', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('documentary_completed')])
    expect(r.computedCurrentState).toBe('resolved')
  })
  it('CBO blocking seul → open', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('open')])
    expect(r.computedCurrentState).toBe('open')
  })
  it('CBO reopening seul → reopened', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('native_reopened')])
    expect(r.computedCurrentState).toBe('reopened')
  })
  it('CBO conflict seul → conflict', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('conflict')])
    expect(r.computedCurrentState).toBe('conflict')
  })
})

describe('reduceTrackedPointLifecycle — CBO membres multiples (désaccord)', () => {
  it('un CBO resolving + un CBO blocking, aucun signal Point → conflict (à re-juger, jamais silencieux)', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('documentary_completed', 'a'), cbo('open', 'b')])
    expect(r.computedCurrentState).toBe('conflict')
  })
  it('deux CBO resolving → resolved', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('native_completed', 'a'), cbo('conforme_at', 'b')])
    expect(r.computedCurrentState).toBe('resolved')
  })
})

describe('étalons P0-1H', () => {
  it('F8 — kf "compartimentage réalisé" (07/2026) + CBO 9fbc1eae encore open (membres 2025) → open + documentaryDivergence, jamais fermeture silencieuse', () => {
    const r = reduceTrackedPointLifecycle(
      [ev('intent_set', '2025-03-01')],
      [ev('resolution_signal', '2026-07-01')],
      [cbo('open')],
    )
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('documentaryDivergence')
  })

  it('F8 — une fois P1-4B juge la preuve comme complétion du CBO (documentary_completed) → resolved proprement', () => {
    const r = reduceTrackedPointLifecycle(
      [ev('intent_set', '2025-03-01')],
      [ev('resolution_signal', '2026-07-01')],
      [cbo('documentary_completed')],
    )
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('RIA — Point "réserves" : kf daté, pas de CBO concurrent → resolved (ligne 1)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2026-02-01')], [])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('RIA — Point "bureaux R+1" : decision_pending seul → open (awaiting_decision, ligne 10)', () => {
    const r = reduceTrackedPointLifecycle([ev('decision_pending', '2026-02-01')], [], [])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('awaiting_decision')
  })

  it('RIA — Point "listing/plan" : aucun signal Point, seulement son CBO → consommé tel quel', () => {
    const r = reduceTrackedPointLifecycle([], [], [cbo('open')])
    expect(r.computedCurrentState).toBe('open')
  })

  it('CTA — "raccordement CTA au SSI" : kf daté 02/2025, aucun CBO concurrent → resolved (ligne 1)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_signal', '2025-02-01')], [])
    expect(r.computedCurrentState).toBe('resolved')
  })

  it('CTA — "programmation d\'arrêt CTA" : déclaratif "semble réalisé" → open + to_confirm (ligne 7)', () => {
    const r = reduceTrackedPointLifecycle([], [ev('resolution_claimed', '2025-06-01')], [])
    expect(r.computedCurrentState).toBe('open')
    expect(r.markers).toContain('to_confirm')
  })
})

describe('reduceTrackedPointLifecycle — invariance à la permutation d\'ordre', () => {
  it('même résultat quel que soit l\'ordre d\'entrée des événements', () => {
    const decisions = [ev('intent_set', '2025-03-01')]
    const docs = [ev('resolution_signal', '2025-05-01'), ev('open_signal', '2026-01-10')]
    const a = reduceTrackedPointLifecycle(decisions, docs, [])
    const b = reduceTrackedPointLifecycle(decisions, [...docs].reverse(), [])
    expect(a.computedCurrentState).toBe(b.computedCurrentState)
    expect(a.computedCurrentState).toBe('reopened')
  })
})
