// Distance entre deux points GPS (haversine, mètres) — PUR, testable CI.
// Sert « Pris au même endroit » : rapprocher les captures d'une même visite
// par la géographie, sans nouvelle donnée.

const EARTH_RADIUS_M = 6_371_000

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/** Rayon « même endroit » sur un chantier : la précision GPS d'un téléphone
 *  en extérieur (~10-25 m) + le geste de quelques pas. */
export const SAME_SPOT_RADIUS_M = 40

export interface EffectivePositionInput {
  lat: number | null
  lng: number | null
  correctedLat: number | null
  correctedLng: number | null
}

export interface EffectivePosition {
  lat: number
  lng: number
  source: 'gps' | 'manual'
}

/** Position effective d'une capture : correction humaine si elle existe,
 *  sinon mesure GPS brute. Primitive unique — carte web, snapshot PDF et
 *  schéma métrique de repli la réutilisent, jamais réimplémentée. */
export function resolveEffectivePosition(c: EffectivePositionInput): EffectivePosition | null {
  if (c.correctedLat != null && c.correctedLng != null) {
    return { lat: c.correctedLat, lng: c.correctedLng, source: 'manual' }
  }
  if (c.lat != null && c.lng != null) {
    return { lat: c.lat, lng: c.lng, source: 'gps' }
  }
  return null
}

/** Une capture n'a sa place sur la carte que si elle est une preuve visuelle
 *  vérifiable sur place (photo/vidéo) : un point de carte sur un vocal ou une
 *  note n'a rien à montrer une fois cliqué — seuls photo/vidéo qualifient. */
export function isMappableVisualCapture(kind: string): boolean {
  return kind === 'photo' || kind === 'video'
}

export interface CrVisualEvidenceLike {
  id: string
  kind: string
  status: string
  included_in_cr: boolean
}

/**
 * Ensemble canonique des preuves visuelles retenues au CR (Lot 4, 2026-08-25) —
 * partagé entre `buildVisitCrDoc` (lib/db/visits.ts) et `ensureCrMapSnapshot`
 * (lib/pdf/cr-map-snapshot.ts) pour que carte et reportage filtrent EXACTEMENT
 * le même ensemble. L'ordre d'entrée est préservé (déjà trié par l'appelant).
 */
export function selectCrVisualEvidence<T extends CrVisualEvidenceLike>(captures: T[]): T[] {
  return captures.filter((c) => c.status !== 'discarded' && isMappableVisualCapture(c.kind) && c.included_in_cr)
}

/**
 * Numéro de preuve unique (Vincent) : séquence 1-based selon l'ordre d'entrée.
 * Fonction PARTAGÉE — jamais recalculée localement (pas de `i + 1` de secours)
 * pour garantir qu'une même capture porte toujours le même numéro, quelle que
 * soit la surface (carte, Photos clés, Reportage).
 */
export function buildEvidenceNumberMap<T extends { id: string }>(orderedCaptures: T[]): Map<string, number> {
  return new Map(orderedCaptures.map((c, i) => [c.id, i + 1]))
}
