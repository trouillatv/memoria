// Mig 195 — chaînage des points de repère photographiques. Une série = une
// ancre (is_viewpoint) + ses reprises (viewpoint_of). Le fantôme proposé est
// TOUJOURS la photo la plus récente de la série (pas l'ancre d'origine).

import { describe, it, expect } from 'vitest'
import { groupViewpointChains, sampleSerie, type ViewpointCaptureLite } from '@/lib/visits/viewpoints'

function cap(over: Partial<ViewpointCaptureLite> & { id: string; created_at: string }): ViewpointCaptureLite {
  return {
    is_viewpoint: false,
    viewpoint_of: null,
    body: null,
    captured_at: null,
    ...over,
  }
}

describe('groupViewpointChains', () => {
  const anchor = cap({ id: 'a1', is_viewpoint: true, body: 'Porte d’entrée', created_at: '2026-07-01T08:00:00Z' })
  const reprise1 = cap({ id: 'r1', viewpoint_of: 'a1', created_at: '2026-07-08T08:00:00Z' })
  const reprise2 = cap({ id: 'r2', viewpoint_of: 'a1', created_at: '2026-07-15T08:00:00Z' })

  it('le fantôme est la photo la plus récente de la série, pas l’ancre', () => {
    const chains = groupViewpointChains([anchor, reprise2, reprise1])
    expect(chains).toHaveLength(1)
    expect(chains[0].anchorId).toBe('a1')
    expect(chains[0].last.id).toBe('r2')
    expect(chains[0].shots).toBe(3)
  })

  it('le nom de la série vient du commentaire de l’ancre', () => {
    const chains = groupViewpointChains([anchor, reprise1])
    expect(chains[0].label).toBe('Porte d’entrée')
  })

  it('captured_at (instant réel) prime sur created_at pour désigner le fantôme', () => {
    const importee = cap({ id: 'r3', viewpoint_of: 'a1', created_at: '2026-07-02T08:00:00Z', captured_at: '2026-07-20T08:00:00Z' })
    const chains = groupViewpointChains([anchor, reprise2, importee])
    expect(chains[0].last.id).toBe('r3')
  })

  it('une reprise orpheline (ancre absente) ne fabrique pas de série', () => {
    const chains = groupViewpointChains([reprise1, reprise2])
    expect(chains).toHaveLength(0)
  })

  it('deux ancres = deux séries, la plus récemment reprise d’abord', () => {
    const anchor2 = cap({ id: 'a2', is_viewpoint: true, body: 'Zone cuisson', created_at: '2026-07-03T08:00:00Z' })
    const reprise2b = cap({ id: 'r9', viewpoint_of: 'a2', created_at: '2026-07-16T08:00:00Z' })
    const chains = groupViewpointChains([anchor, reprise2, anchor2, reprise2b])
    expect(chains.map((c) => c.anchorId)).toEqual(['a2', 'a1'])
  })

  it('une ancre seule (jamais reprise) est proposée avec elle-même comme fantôme', () => {
    const chains = groupViewpointChains([anchor])
    expect(chains[0].last.id).toBe('a1')
    expect(chains[0].shots).toBe(1)
  })
})

describe('sampleSerie — jalons de l’export CR', () => {
  it('série courte : renvoyée telle quelle', () => {
    expect(sampleSerie([1, 2, 3], 4)).toEqual([1, 2, 3])
  })
  it('série longue : premier + dernier TOUJOURS, max jalons, ordre croissant', () => {
    const serie = Array.from({ length: 15 }, (_, i) => i)
    const out = sampleSerie(serie, 4)
    expect(out).toHaveLength(4)
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(14)
    expect([...out]).toEqual([...out].sort((a, b) => a - b))
  })
  it('deux photos suffisent à raconter (max=4, série de 2)', () => {
    expect(sampleSerie(['avant', 'après'], 4)).toEqual(['avant', 'après'])
  })
})
