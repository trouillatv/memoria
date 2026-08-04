import { describe, it, expect } from 'vitest'
import { mergeProposals, prepItemToProposal } from '@/lib/visits/watchlist-merge'
import type { PrepItem } from '@/lib/db/visit-preparation'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'

function makePrep(overrides: Partial<PrepItem> & { id: string; stableKey: string; label: string }): PrepItem {
  return {
    siteId: 'site-1',
    organizationId: 'org-1',
    sourceKind: 'auto_attention',
    sourceRef: null,
    canonicalSubjectId: null,
    priority: 'normal',
    reason: null,
    preparedBy: 'user-1',
    createdAt: '2026-08-04T10:00:00Z',
    ...overrides,
  }
}

function makeAuto(overrides: Partial<WatchlistProposal> & { label: string }): WatchlistProposal {
  return {
    source_kind: 'reserve_open',
    source_ref: null,
    priority: 'normal',
    reason: null,
    ...overrides,
  }
}

describe('prepItemToProposal', () => {
  it('source_kind = human_prep', () => {
    const item = makePrep({ id: 'p1', stableKey: 'attention:cs-1', label: 'Regard R4', canonicalSubjectId: 'cs-1' })
    const proposal = prepItemToProposal(item)
    expect(proposal.source_kind).toBe('human_prep')
    expect(proposal.label).toBe('Regard R4')
    expect(proposal.source_ref).toBe('cs-1')
  })
})

describe('mergeProposals', () => {
  it('sans sélection humaine : propositions auto inchangées', () => {
    const auto = [makeAuto({ label: 'Constater : Réserve R4' }), makeAuto({ label: 'Où en est : Action X ?' })]
    const merged = mergeProposals([], auto)
    expect(merged).toHaveLength(2)
    expect(merged.every((p) => p.source_kind !== 'human_prep')).toBe(true)
  })

  it('sans proposition auto : items humains seuls conservés', () => {
    const human = [makePrep({ id: 'p1', stableKey: 'attention:cs-1', label: 'Regard R4' })]
    const merged = mergeProposals(human, [])
    expect(merged).toHaveLength(1)
    expect(merged[0].source_kind).toBe('human_prep')
  })

  it('items humains apparaissent en premier', () => {
    const human = [makePrep({ id: 'p1', stableKey: 'attention:cs-1', label: 'Regard R4' })]
    const auto  = [makeAuto({ label: 'Constater : Réserve distincte' })]
    const merged = mergeProposals(human, auto)
    expect(merged[0].source_kind).toBe('human_prep')
    expect(merged[1].source_kind).not.toBe('human_prep')
  })

  it('déduplication par source_ref : human éclipse auto avec même source_ref', () => {
    const csId = 'cs-r4'
    const human = [makePrep({ id: 'p1', stableKey: `attention:${csId}`, label: 'Regard R4', canonicalSubjectId: csId })]
    const auto  = [makeAuto({ label: 'Constater : Réserve R4', source_ref: csId })]
    const merged = mergeProposals(human, auto)
    expect(merged).toHaveLength(1)
    expect(merged[0].source_kind).toBe('human_prep')
  })

  it('déduplication par label normalisé', () => {
    const human = [makePrep({ id: 'p1', stableKey: 'attention:cs-1', label: 'Regard R4' })]
    const auto  = [makeAuto({ label: 'regard r4' })] // même label normalisé
    const merged = mergeProposals(human, auto)
    expect(merged).toHaveLength(1)
  })

  it('un item humain manuel reste même si aucune auto ne correspond', () => {
    const human = [makePrep({ id: 'p1', stableKey: 'manual:uuid-xyz', label: 'Vérifier la signalisation', sourceKind: 'manual' })]
    const auto  = [makeAuto({ label: 'Constater : Réserve unrelated', source_ref: 'res-999' })]
    const merged = mergeProposals(human, auto)
    expect(merged).toHaveLength(2)
    expect(merged[0].label).toBe('Vérifier la signalisation')
  })

  it('respecte la limite max', () => {
    const human = Array.from({ length: 3 }, (_, i) =>
      makePrep({ id: `p${i}`, stableKey: `attention:cs-${i}`, label: `Sujet ${i}` }),
    )
    const auto = Array.from({ length: 10 }, (_, i) =>
      makeAuto({ label: `Auto ${i}`, source_ref: `auto-ref-${i}` }),
    )
    const merged = mergeProposals(human, auto, 7)
    expect(merged).toHaveLength(7)
    // Les 3 premiers sont humains
    expect(merged.slice(0, 3).every((p) => p.source_kind === 'human_prep')).toBe(true)
  })

  it('démarrer sans sélection reste possible (liste vide)', () => {
    const merged = mergeProposals([], [])
    expect(merged).toHaveLength(0)
  })

  it('invariant provenance : un item humain porte toujours source_kind=human_prep', () => {
    const human = [makePrep({ id: 'p1', stableKey: 'attention:cs-1', label: 'R4', sourceKind: 'auto_attention' })]
    const merged = mergeProposals(human, [])
    expect(merged[0].source_kind).toBe('human_prep')
  })
})
