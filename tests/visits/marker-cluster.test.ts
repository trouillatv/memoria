// Regroupement déterministe de marqueurs proches (Lot 4, 2026-08-25) — partagé
// entre le schéma live (ObservationMap) et l'instantané baké (cr-map-snapshot.ts).
// Ces tests couvrent l'algorithme PUR, indépendamment de toute projection
// géographique ou du renderer PDF.

import { describe, expect, it } from 'vitest'
import { clusterMarkersByPixel, MARKER_CLUSTER_RADIUS_PX } from '@/lib/visits/marker-cluster'

describe('clusterMarkersByPixel — regroupement déterministe de marqueurs proches (Lot 4, 2026-08-25)', () => {
  it('aucun point → aucun groupe', () => {
    expect(clusterMarkersByPixel([], 16)).toEqual([])
  })

  it('un seul point → un seul groupe centré dessus', () => {
    const p = { id: 'a', x: 10, y: 20 }
    const clusters = clusterMarkersByPixel([p], 16)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ x: 10, y: 20, points: [p] })
  })

  it('deux points à distance inférieure au rayon → un seul groupe, centre = moyenne', () => {
    const a = { id: 'a', x: 0, y: 0 }
    const b = { id: 'b', x: 6, y: 0 }
    const clusters = clusterMarkersByPixel([a, b], 16)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].points.map((p) => p.id)).toEqual(['a', 'b'])
    expect(clusters[0].x).toBe(3)
    expect(clusters[0].y).toBe(0)
  })

  it('deux points au-delà du rayon → deux groupes distincts', () => {
    const a = { id: 'a', x: 0, y: 0 }
    const b = { id: 'b', x: 100, y: 0 }
    const clusters = clusterMarkersByPixel([a, b], 16)
    expect(clusters).toHaveLength(2)
  })

  it('distance exactement égale au rayon → fusionnés (bord inclusif, <=)', () => {
    const a = { id: 'a', x: 0, y: 0 }
    const b = { id: 'b', x: 16, y: 0 }
    const clusters = clusterMarkersByPixel([a, b], 16)
    expect(clusters).toHaveLength(1)
  })

  it('distance juste au-delà du rayon → non fusionnés', () => {
    const a = { id: 'a', x: 0, y: 0 }
    const b = { id: 'b', x: 16.01, y: 0 }
    const clusters = clusterMarkersByPixel([a, b], 16)
    expect(clusters).toHaveLength(2)
  })

  it('groupe de 5 points rapprochés → un seul marqueur regroupant les 5', () => {
    const points = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }))
    const clusters = clusterMarkersByPixel(points, 16)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].points).toHaveLength(5)
  })

  it('recalcul du centre au fil des ajouts : le groupe suit son centre réel, pas la première entrée', () => {
    // A=(0,0), B=(10,0) fusionnent (dist 10 ≤ 12) → centre recalculé (5,0).
    // C=(20,0) : distance au centre RECALCULÉ (5,0) = 15, toujours hors rayon
    // (12) → C reste isolé. Verrouille le comportement glouton documenté.
    const a = { id: 'a', x: 0, y: 0 }
    const b = { id: 'b', x: 10, y: 0 }
    const c = { id: 'c', x: 20, y: 0 }
    const clusters = clusterMarkersByPixel([a, b, c], 12)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].points.map((p) => p.id)).toEqual(['a', 'b'])
    expect(clusters[0].x).toBe(5)
    expect(clusters[1].points.map((p) => p.id)).toEqual(['c'])
  })

  it('déterministe : même entrée → même regroupement à chaque exécution', () => {
    const points = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
      { id: 'c', x: 50, y: 50 },
    ]
    const run1 = clusterMarkersByPixel(points, 16)
    const run2 = clusterMarkersByPixel(points, 16)
    expect(run1.map((c) => c.points.map((p) => p.id))).toEqual(run2.map((c) => c.points.map((p) => p.id)))
  })

  it('rayon 0 : seuls des points strictement superposés fusionnent', () => {
    const a = { id: 'a', x: 5, y: 5 }
    const b = { id: 'b', x: 5, y: 5 }
    const c = { id: 'c', x: 5.5, y: 5 }
    const clusters = clusterMarkersByPixel([a, b, c], 0)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].points.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('MARKER_CLUSTER_RADIUS_PX est la constante partagée par les deux renderers (16 px)', () => {
    expect(MARKER_CLUSTER_RADIUS_PX).toBe(16)
  })
})
