// Classification d'appareil à partir du user-agent — pour le graphe d'usage
// « terrain (mobile) vs bureau » de l'admin. On ne stocke QUE la catégorie
// (ios / android / desktop / other), jamais le user-agent brut : c'est un
// signal d'usage produit, pas de l'empreinte d'appareil.
//
// Pur (aucune dépendance next/headers) → importable côté client comme serveur.

export type DeviceKind = 'ios' | 'android' | 'desktop' | 'other'

export function classifyDevice(ua: string | null | undefined): DeviceKind {
  if (!ua) return 'other'
  const s = ua.toLowerCase()
  if (/iphone|ipad|ipod/.test(s)) return 'ios'
  if (/android/.test(s)) return 'android'
  // Mobile générique non iOS/Android (Windows Phone, etc.).
  if (/mobile|blackberry|windows phone/.test(s)) return 'other'
  if (/windows|macintosh|mac os x|linux|cros/.test(s)) return 'desktop'
  return 'other'
}

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  ios: 'iPhone / iPad',
  android: 'Android',
  desktop: 'Ordinateur',
  other: 'Autre',
}

/** Mobile = terrain (téléphone/tablette) ; desktop = bureau. */
export function isMobileDevice(kind: DeviceKind): boolean {
  return kind === 'ios' || kind === 'android' || kind === 'other'
}
