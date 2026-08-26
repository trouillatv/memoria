// Résolution de collision des pastilles carte PDF (Vincent, recette
// DIMENC-Sireis, 2026-08-27) : sur le snapshot, deux groupes géographiquement
// proches produisaient deux rectangles qui pouvaient se chevaucher (ex. la
// pastille groupée « 10 · 11 · 12 · 13 +3 » cachait un voisin). Le
// regroupement géographique (`groupByProximity`, lib/visits/geo.ts), les
// numéros et le centre de chaque groupe restent STRICTEMENT ceux calculés en
// amont — cette fonction ne fait que déplacer, si nécessaire, le RENDU
// visuel de l'étiquette APRÈS projection écran, jamais la donnée métier.

export interface CrMapLabelMarker {
  cx: number
  cy: number
  color: string
  label: string
}

export interface CrMapPlacedLabelMarker extends CrMapLabelMarker {
  /** Point projeté d'origine, avant toute résolution de collision. */
  ox: number
  oy: number
  /** true si la pastille a dû être déplacée pour éviter une collision. */
  moved: boolean
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Même règle de dimensionnement que le rendu des pastilles (buildSvg,
// cr-map-snapshot.ts) : un marqueur simple (cercle r=19, diamètre 38) et une
// pastille groupée partagent la même boîte englobante — dupliquer cette
// formule romprait la détection de collision dès que l'une des deux dérive
// de l'autre.
export function labelBoxSize(label: string): { width: number; height: number } {
  return { width: Math.max(38, label.length * 10 + 16), height: 38 }
}

function rectAt(cx: number, cy: number, size: { width: number; height: number }): Rect {
  return { x: cx - size.width / 2, y: cy - size.height / 2, width: size.width, height: size.height }
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  )
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return Math.max(0, w) * Math.max(0, h)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// Reste strictement dans le cadre de carte (exigence Vincent #4) : si le
// centre demandé placerait la pastille hors cadre, on la ramène juste assez
// pour qu'elle tienne entièrement dedans.
function clampCenterIntoBounds(
  cx: number,
  cy: number,
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  margin: number,
): { cx: number; cy: number } {
  const halfW = size.width / 2
  const halfH = size.height / 2
  const minX = margin + halfW
  const maxX = bounds.width - margin - halfW
  const minY = margin + halfH
  const maxY = bounds.height - margin - halfH
  return {
    cx: maxX >= minX ? clamp(cx, minX, maxX) : bounds.width / 2,
    cy: maxY >= minY ? clamp(cy, minY, maxY) : bounds.height / 2,
  }
}

// Ordre de recherche déterministe (Vincent) : au-dessus, en dessous, gauche,
// droite, puis les 4 diagonales — répété à des distances croissantes.
// Jamais aléatoire : mêmes données d'entrée (même ordre de groupes) = même
// PDF en sortie.
const DIRECTIONS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
]
const STEPS = [22, 38, 56, 76, 98, 122, 148, 176, 210, 250]

/**
 * Place chaque pastille à sa position naturelle si elle ne chevauche
 * personne ; sinon, cherche un décalage déterministe (direction × distance
 * croissantes) qui l'en libère, tout en restant dans le cadre de carte.
 * Traite les marqueurs dans leur ordre d'entrée (celui de `groupByProximity`)
 * — un marqueur déjà placé n'est jamais reconsidéré par les suivants.
 */
export function resolveLabelCollisions(
  markers: CrMapLabelMarker[],
  bounds: { width: number; height: number },
  opts?: { margin?: number; gap?: number },
): CrMapPlacedLabelMarker[] {
  const margin = opts?.margin ?? 8
  const gap = opts?.gap ?? 4
  const placedRects: Rect[] = []
  const result: CrMapPlacedLabelMarker[] = []

  for (const marker of markers) {
    const size = labelBoxSize(marker.label)
    const natural = clampCenterIntoBounds(marker.cx, marker.cy, size, bounds, margin)
    const naturalRect = rectAt(natural.cx, natural.cy, size)
    const collidesNaturally = placedRects.some((r) => overlaps(naturalRect, r, gap))

    if (!collidesNaturally) {
      placedRects.push(naturalRect)
      result.push({ ...marker, cx: natural.cx, cy: natural.cy, ox: marker.cx, oy: marker.cy, moved: false })
      continue
    }

    let best: { cx: number; cy: number; rect: Rect; overlap: number } | null = null
    outer: for (const step of STEPS) {
      for (const dir of DIRECTIONS) {
        const candidate = clampCenterIntoBounds(marker.cx + dir.dx * step, marker.cy + dir.dy * step, size, bounds, margin)
        const rect = rectAt(candidate.cx, candidate.cy, size)
        const overlap = placedRects.reduce((sum, r) => sum + (overlaps(rect, r, gap) ? overlapArea(rect, r) : 0), 0)
        if (overlap === 0) {
          best = { cx: candidate.cx, cy: candidate.cy, rect, overlap: 0 }
          break outer
        }
        if (!best || overlap < best.overlap) {
          best = { cx: candidate.cx, cy: candidate.cy, rect, overlap }
        }
      }
    }

    const chosen = best ?? { cx: natural.cx, cy: natural.cy, rect: naturalRect, overlap: 0 }
    placedRects.push(chosen.rect)
    result.push({ ...marker, cx: chosen.cx, cy: chosen.cy, ox: marker.cx, oy: marker.cy, moved: true })
  }

  return result
}
