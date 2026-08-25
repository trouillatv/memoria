// Regroupement déterministe de marqueurs PROCHES EN PIXELS sur une carte
// imprimée (Lot 4, 2026-08-25). Deux preuves visuelles dont les points se
// chevauchent visuellement doivent former UN SEUL marqueur — sinon les cercles
// se recouvrent et deviennent illisibles au format papier. Partagé entre le
// schéma live (ObservationMap) et l'instantané baké côté serveur
// (cr-map-snapshot.ts) : même algorithme, même rayon → même regroupement,
// quelle que soit la projection utilisée par chaque renderer.

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

/** Rayon de regroupement partagé (px) — les deux renderers DOIVENT utiliser la
 *  même valeur pour que « snapshot + repli » ne divergent jamais. */
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
