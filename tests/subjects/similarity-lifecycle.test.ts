import { describe, expect, it } from 'vitest'
import { filterActiveSuggestions } from '@/lib/subjects/similarity-analyze'
import type { PersistedSuggestion } from '@/lib/subjects/similarity-analyze'

// ── Helpers ───────────────────────────────────────────────────────────────────

function s(id: string, aId: string, bId: string, overrides: Partial<PersistedSuggestion> = {}): PersistedSuggestion {
  return {
    id,
    site_id: 'site1',
    subject_a_id: aId,
    subject_b_id: bId,
    score: 90,
    verdict: 'same_subject',
    recommendation: 'merge',
    suggested_link_type: null,
    suggested_direction: null,
    suggested_label: null,
    reason: 'test',
    model: 'gemini',
    analyzed_at: '2026-01-01T00:00:00Z',
    status: 'pending',
    reviewed_at: null,
    reviewed_by: null,
    same_object_hypothesis: false,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('filterActiveSuggestions — invariants du cycle de vie', () => {
  it('retourne toutes les suggestions quand les deux sujets sont actifs', () => {
    const sug = [s('s1', 'A', 'B'), s('s2', 'B', 'C')]
    const { active, staleIds } = filterActiveSuggestions(sug, new Set(['A', 'B', 'C']))
    expect(active).toHaveLength(2)
    expect(staleIds).toHaveLength(0)
  })

  it('écarte une suggestion dont subject_a n\'est plus actif (sujet absorbé)', () => {
    const sug = [s('s1', 'A', 'B'), s('s2', 'B', 'C')]
    const { active, staleIds } = filterActiveSuggestions(sug, new Set(['B', 'C']))
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('s2')
    expect(staleIds).toEqual(['s1'])
  })

  it('écarte une suggestion dont subject_b n\'est plus actif', () => {
    const sug = [s('s1', 'A', 'B')]
    const { active, staleIds } = filterActiveSuggestions(sug, new Set(['A']))
    expect(active).toHaveLength(0)
    expect(staleIds).toEqual(['s1'])
  })

  it('cas transitif A↔B, A↔C, B↔C — après fusion A+B (A loser), toutes les suggestions impliquant A sont stales', () => {
    const suggestions = [s('s1', 'A', 'B'), s('s2', 'A', 'C'), s('s3', 'B', 'C')]
    // A n'est plus actif après fusion A+B
    const activeSet = new Set(['B', 'C'])
    const { active, staleIds } = filterActiveSuggestions(suggestions, activeSet)
    expect(staleIds).toContain('s1') // A↔B : A absorbé
    expect(staleIds).toContain('s2') // A↔C : A absorbé
    expect(active.map((x) => x.id)).toEqual(['s3']) // B↔C : les deux actifs
  })

  it('écarte une suggestion dont les deux extrémités sont identiques', () => {
    const sug = [s('s1', 'A', 'A')]
    const { active, staleIds } = filterActiveSuggestions(sug, new Set(['A']))
    expect(active).toHaveLength(0)
    expect(staleIds).toEqual(['s1'])
  })

  it('retourne [] et staleIds=[] sur une liste vide', () => {
    const { active, staleIds } = filterActiveSuggestions([], new Set(['A', 'B']))
    expect(active).toHaveLength(0)
    expect(staleIds).toHaveLength(0)
  })

  it('écarte toutes les suggestions quand aucun sujet n\'est actif', () => {
    const sug = [s('s1', 'A', 'B'), s('s2', 'C', 'D')]
    const { active, staleIds } = filterActiveSuggestions(sug, new Set())
    expect(active).toHaveLength(0)
    expect(staleIds).toHaveLength(2)
  })

  it('ne confond pas active ≠ stale dans les IDs retournés', () => {
    const sug = [s('s1', 'A', 'B'), s('s2', 'A', 'C'), s('s3', 'D', 'E')]
    const activeSet = new Set(['A', 'B', 'D', 'E']) // C manquant
    const { active, staleIds } = filterActiveSuggestions(sug, activeSet)
    expect(active.map((x) => x.id)).toEqual(['s1', 's3'])
    expect(staleIds).toEqual(['s2'])
  })
})
