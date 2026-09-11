import { describe, expect, it } from 'vitest'
import { filterPointList, DEFAULT_POINT_LIST_FILTERS } from '@/lib/knowledge/tracked-point-list-filter'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'

function entry(overrides: Partial<PointListEntry>): PointListEntry {
  return {
    id: 'p1',
    siteId: 's1',
    label: 'Extincteurs hall A',
    derivedState: 'open',
    latestMeaningfulEventAt: '2026-01-01',
    ownerCanonicalSubjectId: 'subj-1',
    subjectLabel: 'Extincteurs',
    actorNames: [],
    needsYouCount: 0,
    needsYouQuestionId: null,
    ...overrides,
  }
}

describe('tracked-point-list — filterPointList (filtrage pur, ET combiné)', () => {
  const points: PointListEntry[] = [
    entry({ id: 'p1', label: 'Extincteurs hall A', derivedState: 'open', ownerCanonicalSubjectId: 'subj-1', actorNames: ['ARES'] }),
    entry({ id: 'p2', label: 'Sprinkler réserve', derivedState: 'reopened', ownerCanonicalSubjectId: 'subj-2', actorNames: ['MIES'] }),
    entry({ id: 'p3', label: 'BAES couloir', derivedState: 'resolved', ownerCanonicalSubjectId: 'subj-1', actorNames: [] }),
  ]

  it('sans filtre → retourne tous les Points, dans l’ordre reçu', () => {
    expect(filterPointList(points, DEFAULT_POINT_LIST_FILTERS)).toEqual(points)
  })

  it('filtre par état', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, state: 'reopened' })
    expect(result.map((p) => p.id)).toEqual(['p2'])
  })

  it('filtre par sujet', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, subjectId: 'subj-1' })
    expect(result.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('filtre par acteur', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, actor: 'MIES' })
    expect(result.map((p) => p.id)).toEqual(['p2'])
  })

  it('recherche texte, insensible à la casse, sur le libellé', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, query: 'sprinkler' })
    expect(result.map((p) => p.id)).toEqual(['p2'])
  })

  it('combine les filtres en ET, jamais en OU', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, subjectId: 'subj-1', state: 'resolved' })
    expect(result.map((p) => p.id)).toEqual(['p3'])
  })

  it('aucune correspondance → liste vide, jamais une erreur', () => {
    const result = filterPointList(points, { ...DEFAULT_POINT_LIST_FILTERS, actor: 'Inconnu' })
    expect(result).toEqual([])
  })

  it('filtre « Besoin de moi » : ne garde que les Points référencés par NeedsYou', () => {
    const withNeedsYou: PointListEntry[] = [
      entry({ id: 'p1', needsYouCount: 0, needsYouQuestionId: null }),
      entry({ id: 'p2', needsYouCount: 2, needsYouQuestionId: null }),
      entry({ id: 'p3', needsYouCount: 1, needsYouQuestionId: 'q-1' }),
    ]
    const result = filterPointList(withNeedsYou, { ...DEFAULT_POINT_LIST_FILTERS, needsYouOnly: true })
    expect(result.map((p) => p.id)).toEqual(['p2', 'p3'])
  })
})
