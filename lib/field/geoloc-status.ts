// État de géolocalisation d'une capture terrain — PUR, testable CI.
//
// `GeolocationPositionError.code` ne distingue de façon fiable que deux choses
// (Android/iOS/PWA) : PERMISSION_DENIED (1) d'un côté, POSITION_UNAVAILABLE (2)
// et TIMEOUT (3) de l'autre — impossibles à séparer entre eux d'un navigateur à
// l'autre. « GPS physiquement désactivé » n'est PAS un état prouvable côté web :
// aucun libellé ne doit jamais l'affirmer (garde testée dans geoloc-status.test.ts).

// Décrit UNIQUEMENT la dernière tentative de localisation (la capture en cours
// ou la plus récente) — jamais la couverture géographique de la visite entière.
// Une capture précédente réussie n'empêche pas ce statut de retomber en échec
// si la tentative suivante échoue (Vincent, revue du lot GPS, 2026-08-26).
export type GeoStatus =
  | 'idle'
  | 'locating'
  | 'success'
  | 'user-disabled'
  | 'permission-denied'
  | 'unavailable'

export function mapGeolocationError(code: number): 'permission-denied' | 'unavailable' {
  return code === 1 /* PERMISSION_DENIED */ ? 'permission-denied' : 'unavailable'
}

export interface GeoStatusLabel {
  text: string
  retry: boolean
}

/** Ligne d'état permanente du panier — visible avant même d'appuyer sur « Photo ». */
export const PANEL_LABEL: Record<GeoStatus, GeoStatusLabel> = {
  idle: { text: 'Observations géolocalisées', retry: false },
  locating: { text: 'Localisation en cours…', retry: false },
  success: { text: 'Observations géolocalisées', retry: false },
  'user-disabled': { text: 'Géolocalisation désactivée', retry: false },
  'permission-denied': { text: 'Localisation non autorisée', retry: false },
  unavailable: { text: 'Position indisponible', retry: true },
}

/** Bandeau des écrans caméra in-app (GhostCamera / VideoRecorder) — même wording, contexte de prise. */
export const CAMERA_BANNER_LABEL: Record<GeoStatus, GeoStatusLabel> = {
  idle: { text: 'Localisation…', retry: false },
  locating: { text: 'Localisation…', retry: false },
  success: { text: 'Position enregistrée', retry: false },
  'user-disabled': { text: 'Géolocalisation désactivée', retry: false },
  'permission-denied': { text: 'Localisation non autorisée', retry: false },
  unavailable: { text: 'Position indisponible', retry: true },
}
