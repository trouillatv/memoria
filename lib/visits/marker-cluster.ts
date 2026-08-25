// Regroupement déterministe de marqueurs PROCHES EN PIXELS sur une carte
// interactive (Lot 4, 2026-08-25 ; restauré Lot Cartographie CR, 2026-08-26
// pour la carte LIVE uniquement — Correction 3, Vincent). Contrairement à
// `groupByProximity` (lib/visits/geo.ts, mètres réels, STABLE quel que soit le
// zoom, utilisé par le PDF statique), ce regroupement se redéfinit à chaque
// zoom : deux points séparés de 20-30 m restent un seul marqueur à faible
// zoom, puis se distinguent en zoomant. Nécessaire uniquement sur la carte
// interactive, jamais sur un rendu papier fixe.

export interface ClusterInputPoint {
  id: string
  x: number
  y: number
}

export interface MarkerCluster<T extends ClusterInputPoint> {
  x: number
  y: number
  points: T[]
}

/** Rayon de regroupement (px) — deux points projetés à moins de cette
 *  distance à l'écran, au zoom courant, forment un seul marqueur. */
export const MARKER_CLUSTER_RADIUS_PX = 16

/**
 * Glouton, ordre stable (ordre d'entrée de `points`) : un point rejoint le
 * premier groupe dont le centre courant est à portée, sinon il ouvre un
 * nouveau groupe. Le centre d'un groupe est recalculé à chaque ajout (moyenne)
 * pour rester au centre visuel réel. Déterministe : même entrée → même sortie.
 */
export function clusterMarkersByPixel<T extends ClusterInputPoint>(
  points: T[],
  radiusPx: number,
): Array<MarkerCluster<T>> {
  const clusters: Array<MarkerCluster<T>> = []
  for (const p of points) {
    const existing = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) <= radiusPx)
    if (existing) {
      existing.points.push(p)
      existing.x = existing.points.reduce((s, q) => s + q.x, 0) / existing.points.length
      existing.y = existing.points.reduce((s, q) => s + q.y, 0) / existing.points.length
    } else {
      clusters.push({ x: p.x, y: p.y, points: [p] })
    }
  }
  return clusters
}
