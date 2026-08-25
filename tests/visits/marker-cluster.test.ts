// Regroupement PIXEL, dépendant du zoom — carte interactive uniquement
// (Correction 3, Vincent, Lot Cartographie CR, 2026-08-26). Contrairement à
// `groupByProximity` (mètres réels, stable), ce regroupement doit se
// redéfinir quand la distance EN PIXELS entre deux points fixes change avec
// le zoom : c'est exactement ce que `CaptureMap.tsx` recalcule à chaque
// `zoomend`, en reprojetant lat/lng → pixels via `map.latLngToLayerPoint()`.

import { describe, expect, it } from 'vitest'
import { clusterMarkersByPixel, MARKER_CLUSTER_RADIUS_PX } from '@/lib/visits/marker-cluster'

describe('clusterMarkersByPixel — regroupement dépendant du zoom (Vincent, correction Lot Cartographie CR, 2026-08-26)', () => {
  it('deux preuves exactement superposées (0 px d’écart) → un seul groupe, à n’importe quel rayon', () => {
    const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 100 }]
    expect(clusterMarkersByPixel(points, MARKER_CLUSTER_RADIUS_PX)).toHaveLength(1)
    expect(clusterMarkersByPixel(points, 0)).toHaveLength(1)
  })

  it('deux preuves à ~20-30 m : groupées à faible zoom (peu de px/m → écart < rayon), séparées à fort zoom (beaucoup de px/m → écart > rayon)', () => {
    // Même paire de points réels, seule la projection pixel change avec le zoom
    // (exactement ce que fait Leaflet : latLngToLayerPoint dépend du zoom courant).
    const lowZoomPx = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 108, y: 100 }] // 8 px d'écart, sous le rayon
    const highZoomPx = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 148, y: 100 }] // 48 px d'écart, au-dessus

    const lowZoomClusters = clusterMarkersByPixel(lowZoomPx, MARKER_CLUSTER_RADIUS_PX)
    expect(lowZoomClusters).toHaveLength(1)
    expect(lowZoomClusters[0].points.map((p) => p.id).sort()).toEqual(['a', 'b'])

    const highZoomClusters = clusterMarkersByPixel(highZoomPx, MARKER_CLUSTER_RADIUS_PX)
    expect(highZoomClusters).toHaveLength(2)
  })

  it('point isolé → son propre groupe à un seul élément', () => {
    const clusters = clusterMarkersByPixel([{ id: 'a', x: 0, y: 0 }], MARKER_CLUSTER_RADIUS_PX)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].points).toHaveLength(1)
  })

  it('ensemble vide → aucun groupe', () => {
    expect(clusterMarkersByPixel([], MARKER_CLUSTER_RADIUS_PX)).toHaveLength(0)
  })

  it('centre du groupe = moyenne des points regroupés', () => {
    const clusters = clusterMarkersByPixel([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }], MARKER_CLUSTER_RADIUS_PX)
    expect(clusters[0].x).toBeCloseTo(5, 6)
    expect(clusters[0].y).toBeCloseTo(0, 6)
  })
})
