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
