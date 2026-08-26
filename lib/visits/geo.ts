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

export interface LocationCorrectionPatch {
  corrected_lat: number | null
  corrected_lng: number | null
}

/**
 * Charge utile d'une correction manuelle de position (Lot 3, mig 351) : PAIRE
 * atomique — les deux colonnes sont toujours écrites ensemble, jamais l'une
 * sans l'autre (contrainte DB `visit_capture_corrected_pair_check`).
 * `correction: null` retire la correction et restaure la mesure GPS comme
 * position effective (via `resolveEffectivePosition`) — `lat`/`lng` ne sont
 * JAMAIS dans cette charge utile, jamais réécrites par une correction.
 */
export function buildLocationCorrectionPatch(correction: { lat: number; lng: number } | null): LocationCorrectionPatch {
  return { corrected_lat: correction?.lat ?? null, corrected_lng: correction?.lng ?? null }
}

/**
 * Légende factuelle de la précision GPS (Lot 3) : `null` → aucune précision
 * inventée (captures antérieures à mig 351, ou navigateur n'ayant rien
 * fourni). Jamais présentée comme une zone certaine — cf. doctrine
 * « ± N m », pas « ici exactement ».
 */
export function formatGpsAccuracyCaption(gpsAccuracyM: number | null): string | null {
  if (gpsAccuracyM == null) return null
  return `Précision GPS : ± ${Math.round(gpsAccuracyM)} m`
}

/** Variante compacte de `formatGpsAccuracyCaption`, pour une puce/ligne d'état
 *  (ex. « ±11 m ») plutôt qu'une phrase complète — même arrondi, même
 *  `null` si aucune précision connue. */
export function formatCompactGpsAccuracy(gpsAccuracyM: number | null): string | null {
  if (gpsAccuracyM == null) return null
  return `±${Math.round(gpsAccuracyM)} m`
}

/**
 * Seuil « précision GPS à vérifier » (Lot 3, redirection UX 2026-08-26) :
 * au-delà, la ligne d'état GPS de l'écran de triage passe d'un ton neutre
 * (« Emplacement GPS ») à un ton d'alerte discret (« Position à vérifier »).
 * Repère terrain, pas une preuve d'erreur : 30 m correspond à une mesure GPS
 * dégradée (couvert forestier, encaissement, multi-trajet) plutôt qu'à la
 * précision courante en extérieur dégagé (~10-25 m, cf. SAME_SPOT_RADIUS_M).
 */
export const POOR_GPS_ACCURACY_M = 30

/**
 * Seuil « déplacement important » lors d'une correction manuelle (Lot 3,
 * redirection UX 2026-08-26) : au-delà, un avertissement discret et NON
 * bloquant s'affiche pendant le glisser-déposer du repère de correction
 * (ex. déplacement d'un point vers un autre chantier voisin par erreur de
 * geste). Calcul purement géométrique (distanceMeters) — jamais une
 * heuristique IA, jamais un blocage de la validation.
 */
export const LARGE_CORRECTION_MOVE_M = 300

/**
 * Légende discrète de l'altitude d'une capture (Vincent, 2026-08-26) :
 * métadonnée SECONDAIRE, jamais présentée comme une cote topographique de
 * géomètre — c'est une lecture brute du GPS téléphone, nettement moins fiable
 * que lat/lng. `altitudeM: null` → rien à afficher (navigateur n'ayant rien
 * fourni), jamais une valeur inventée. Quand la précision d'altitude est
 * connue, elle est toujours donnée entre parenthèses pour ne jamais laisser
 * lire « altitude ~24 m » comme un fait certain.
 */
export function formatAltitudeCaption(altitudeM: number | null, altitudeAccuracyM: number | null): string | null {
  if (altitudeM == null) return null
  const value = `altitude ~${Math.round(altitudeM)} m`
  if (altitudeAccuracyM == null) return value
  return `${value} (±${Math.round(altitudeAccuracyM)} m)`
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

/**
 * Étiquette compacte pour un repère regroupant plusieurs preuves (Lot 4.1,
 * 2026-08-25) — plages contiguës en « a–b », numéros isolés listés à la
 * virgule. Ex. [1,2,3] → « 1–3 » ; [1,3,5,6] → « 1, 3, 5–6 ». Remplace un
 * simple compte de points (« 5 ») : Vincent, en recette, ne pouvait pas relier
 * une photo précise à un repère qui n'affichait que le NOMBRE de preuves
 * groupées, jamais LESQUELLES. Partagée par les trois rendus de carte (schéma
 * PDF, instantané baké, carte live) — jamais reformulée localement.
 */
export interface ProximityPoint {
  id: string
  lat: number
  lng: number
}

export interface ProximityGroup<T extends ProximityPoint> {
  lat: number
  lng: number
  points: T[]
}

/**
 * Regroupement spatial STABLE, indépendant du zoom (Vincent, Lot Cartographie
 * CR, 2026-08-26) : la décision « ces preuves sont au même endroit » se prend
 * UNE SEULE FOIS en coordonnées réelles (mètres, haversine), jamais en pixels
 * projetés. Contrairement à `clusterMarkersByPixel` (regroupement en pixels,
 * qui se redéfinit à chaque zoom — « plus on zoome, plus on éclate », rejeté
 * en recette), le résultat de cette fonction ne dépend d'aucune projection :
 * chaque renderer (carte live à n'importe quel zoom, instantané PDF baké,
 * schéma PDF de repli) place ensuite le centroïde déjà décidé dans son propre
 * espace pixel, sans jamais reconsidérer qui appartient à quel groupe.
 * Glouton, ordre stable (ordre d'entrée) : un point rejoint le premier groupe
 * dont le centroïde courant est à portée de `radiusMeters`, sinon il ouvre un
 * nouveau groupe. Rayon par défaut = `SAME_SPOT_RADIUS_M`, la même doctrine
 * « même endroit sur un chantier » déjà utilisée par la fiche observation
 * isolée (« captures près d'ici ») — pas une seconde définition concurrente.
 */
export function groupByProximity<T extends ProximityPoint>(
  points: T[],
  radiusMeters: number = SAME_SPOT_RADIUS_M,
): Array<ProximityGroup<T>> {
  const groups: Array<ProximityGroup<T>> = []
  for (const p of points) {
    const existing = groups.find((g) => distanceMeters(g.lat, g.lng, p.lat, p.lng) <= radiusMeters)
    if (existing) {
      existing.points.push(p)
      existing.lat = existing.points.reduce((s, q) => s + q.lat, 0) / existing.points.length
      existing.lng = existing.points.reduce((s, q) => s + q.lng, 0) / existing.points.length
    } else {
      groups.push({ lat: p.lat, lng: p.lng, points: [p] })
    }
  }
  return groups
}

export interface EvidenceCoverageLike {
  id: string
  lat: number | null
  lng: number | null
  corrected_lat: number | null
  corrected_lng: number | null
}

export interface EvidenceCoverage {
  total: number
  positioned: number
  /** Numéros (identité de preuve partagée) des preuves retenues au CR mais
   *  sans position — jamais une position inventée, jamais silencieux. */
  missingNumbers: number[]
}

/**
 * Couverture GPS des preuves visuelles retenues au CR (Vincent, correction
 * Lot 4 : « la carte devrait dire 4/8 preuves localisées, puis Sans
 * position : ① ② ⑤ ⑥ »). PARTAGÉE entre carte web et PDF — jamais un compte
 * recalculé localement à partir des seules positions présentes, qui ne dit
 * rien du nombre de preuves absentes de la carte.
 */
export function buildEvidenceCoverage<T extends EvidenceCoverageLike>(
  orderedEvidence: T[],
  evidenceNumberById: Map<string, number>,
): EvidenceCoverage {
  let positioned = 0
  const missingNumbers: number[] = []
  for (const c of orderedEvidence) {
    const pos = resolveEffectivePosition({ lat: c.lat, lng: c.lng, correctedLat: c.corrected_lat, correctedLng: c.corrected_lng })
    if (pos) positioned++
    else missingNumbers.push(evidenceNumberById.get(c.id) ?? 0)
  }
  return { total: orderedEvidence.length, positioned, missingNumbers }
}

export function formatEvidenceNumberLabel(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) {
      prev = n
      continue
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`)
    if (i < sorted.length) {
      start = n
      prev = n
    }
  }
  return parts.join(', ')
}

/**
 * Étiquette d'un REPÈRE GROUPÉ sur la carte (Vincent, retouche présentation
 * Lot Cartographie CR, 2026-08-26) : chaque preuve listée individuellement,
 * séparée par « · », jamais une plage « a–b » — un tiret entre deux numéros
 * de preuves distinctes se lit comme un intervalle (« de 3 à 4 »), pas comme
 * deux preuves. `formatEvidenceNumberLabel` (ranges compressées) reste
 * réservé aux listes textuelles (ex. « Sans position : 2, 4, 6, 8 »), jamais
 * à un repère cliquable. Au-delà de `maxVisible`, le reste est résumé par un
 * compte plutôt que d'allonger indéfiniment la capsule. PARTAGÉE par les
 * trois rendus (carte live, instantané PDF baké, schéma PDF de repli) — la
 * même paire de preuves porte toujours le même texte, où qu'elle apparaisse.
 * Ex. [3,4,7,8] → « 3 · 4 · 7 · 8 » ; [3,4,7,8,9,10] (maxVisible=4)
 * → « 3 · 4 · 7 · 8 +2 ».
 */
export function formatClusterMarkerLabel(numbers: number[], maxVisible = 4): string {
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length <= maxVisible) return sorted.join(' · ')
  const shown = sorted.slice(0, maxVisible)
  const hidden = sorted.length - maxVisible
  return `${shown.join(' · ')} +${hidden}`
}
