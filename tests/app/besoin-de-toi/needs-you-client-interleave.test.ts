// Retour Vincent (6E.4A) : à priorité égale, "Tous" ne doit plus reproduire l'ordre groupé par
// catégorie de la file serveur (sinon la première page ressemble au filtre "Identité" seul).
// interleaveByCategory départage en round-robin déterministe par catégorie.

import { describe, it, expect } from 'vitest'
import { interleaveByCategory } from '@/app/(dashboard)/sites/[id]/besoin-de-toi/NeedsYouClient'
import type { MemoriaNeedsYouQuestion } from '@/lib/knowledge/tracked-point-needs-you-summary'

function q(category: MemoriaNeedsYouQuestion['category'], id: string): MemoriaNeedsYouQuestion {
  return { category, id, entry: {} } as MemoriaNeedsYouQuestion
}

describe('interleaveByCategory', () => {
  it('répartit les catégories en round-robin au lieu de les laisser groupées', () => {
    const list = [
      q('duplicate_points', 'd1'),
      q('duplicate_points', 'd2'),
      q('duplicate_points', 'd3'),
      q('attach_information', 'a1'),
      q('confirm_trackability', 'c1'),
    ]

    const result = interleaveByCategory(list)

    expect(result.map((r) => r.id)).toEqual(['d1', 'a1', 'c1', 'd2', 'd3'])
  })

  it('conserve l ordre relatif au sein de chaque catégorie', () => {
    const list = [q('duplicate_points', 'd1'), q('duplicate_points', 'd2'), q('attach_information', 'a1')]

    const result = interleaveByCategory(list)

    const duplicateIds = result.filter((r) => r.category === 'duplicate_points').map((r) => r.id)
    expect(duplicateIds).toEqual(['d1', 'd2'])
  })

  it('une seule catégorie présente -> ordre inchangé (filtre précis actif)', () => {
    const list = [q('duplicate_points', 'd1'), q('duplicate_points', 'd2'), q('duplicate_points', 'd3')]

    expect(interleaveByCategory(list)).toEqual(list)
  })

  it('liste vide -> liste vide', () => {
    expect(interleaveByCategory([])).toEqual([])
  })

  it('ne perd et ne duplique aucune question', () => {
    const list = [
      q('duplicate_points', 'd1'),
      q('attach_information', 'a1'),
      q('attach_information', 'a2'),
      q('clarify_evidence', 'e1'),
      q('assign_resolution', 'r1'),
      q('confirm_trackability', 'c1'),
    ]

    const result = interleaveByCategory(list)

    expect(result).toHaveLength(list.length)
    expect(new Set(result.map((r) => r.id))).toEqual(new Set(list.map((r) => r.id)))
  })
})
