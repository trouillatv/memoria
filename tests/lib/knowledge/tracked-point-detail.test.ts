import { describe, expect, it } from 'vitest'
import {
  toTrajectoryEntry,
  proposalIdFromSource,
  buildHeadline,
  POINT_STATE_LABEL,
} from '@/lib/knowledge/tracked-point-detail'

describe('tracked-point-detail — toTrajectoryEntry', () => {
  it('mappe un événement de trajectoire vers son libellé fixe, sans recalcul d’état', () => {
    const entry = toTrajectoryEntry({ effectiveAt: '2026-01-10', kind: 'resolution_signal', source: 'proposal:abc' })
    expect(entry.kind).toBe('resolution_signal')
    expect(entry.kindLabel).toBe('Preuve documentaire de résolution')
    expect(entry.isResolving).toBe(true)
    expect(entry.source).toBe('proposal:abc')
    expect(entry.dateLabel).toContain('2026')
  })

  it('isResolving couvre resolution_signal ET no_action_decided, jamais les autres', () => {
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'no_action_decided' }).isResolving).toBe(true)
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'open_signal' }).isResolving).toBe(false)
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'resolution_claimed' }).isResolving).toBe(false)
  })

  it('source absent → null (jamais undefined dans le read-model exposé)', () => {
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'intent_set' }).source).toBeNull()
  })
})

describe('tracked-point-detail — proposalIdFromSource', () => {
  it('extrait l’id après le préfixe proposal:', () => {
    expect(proposalIdFromSource('proposal:9f1c')).toBe('9f1c')
  })

  it('retourne null pour une origine non documentaire (décision native, etc.)', () => {
    expect(proposalIdFromSource('native:decision-1')).toBeNull()
    expect(proposalIdFromSource(null)).toBeNull()
  })
})

describe('tracked-point-detail — buildHeadline (mise en mots, aucun recalcul d’état)', () => {
  it('reopened avec divergence documentaire connue → cite la divergence en priorité', () => {
    const headline = buildHeadline(
      { derivedState: 'reopened', documentaryDivergences: ['PV du 2026-02-01 signale une réapparition'], conflicts: [], latestMeaningfulEventAt: '2026-02-01' },
      '1 février 2026',
    )
    expect(headline).toContain('Réouvert')
    expect(headline).toContain('réapparition')
  })

  it('reopened sans divergence détaillée → phrase générique datée', () => {
    const headline = buildHeadline(
      { derivedState: 'reopened', documentaryDivergences: [], conflicts: [], latestMeaningfulEventAt: '2026-02-01' },
      '1 février 2026',
    )
    expect(headline).toBe('Réouvert depuis le 1 février 2026 — une preuve plus récente contredit une résolution antérieure.')
  })

  it('conflict cite le premier conflit connu', () => {
    const headline = buildHeadline(
      { derivedState: 'conflict', documentaryDivergences: [], conflicts: ['deux preuves incompatibles'], latestMeaningfulEventAt: null },
      null,
    )
    expect(headline).toBe('En conflit — deux preuves incompatibles')
  })

  it('resolved sans date → phrase sans "depuis le"', () => {
    expect(buildHeadline({ derivedState: 'resolved', documentaryDivergences: [], conflicts: [], latestMeaningfulEventAt: null }, null))
      .toBe('Résolu.')
  })

  it('open avec date → phrase datée', () => {
    expect(buildHeadline({ derivedState: 'open', documentaryDivergences: [], conflicts: [], latestMeaningfulEventAt: '2026-01-01' }, '1 janvier 2026'))
      .toBe('Ouvert depuis le 1 janvier 2026 — aucune résolution constatée à ce jour.')
  })

  it('unknown → phrase neutre fixe', () => {
    expect(buildHeadline({ derivedState: 'unknown', documentaryDivergences: [], conflicts: [], latestMeaningfulEventAt: null }, null))
      .toBe('État non déterminé — pas assez d’éléments pour se prononcer.')
  })
})

describe('tracked-point-detail — POINT_STATE_LABEL', () => {
  it('couvre les 5 états dérivés du reducer (contrat gelé)', () => {
    expect(Object.keys(POINT_STATE_LABEL).sort()).toEqual(['conflict', 'open', 'reopened', 'resolved', 'unknown'].sort())
  })
})
