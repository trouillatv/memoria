// Présentation météo du journal de chantier — CLIENT-SAFE.
//
// Volontairement séparé de site-day-log.ts : ce dernier importe le client
// admin Supabase (server-only), donc un composant client qui a juste besoin
// des libellés/icônes tirerait tout le code serveur dans son bundle (et casse
// le build : « 'server-only' cannot be imported from a Client Component »).
// Aucun import serveur ici → importable depuis du code client comme serveur.

export type WeatherCode =
  | 'clear' | 'cloudy' | 'rain' | 'heavy_rain' | 'wind' | 'storm' | 'heat' | 'other'

export const WEATHER_META: Record<WeatherCode, { label: string; icon: string }> = {
  clear:      { label: 'Dégagé',        icon: '☀️' },
  cloudy:     { label: 'Couvert',       icon: '☁️' },
  rain:       { label: 'Pluie',         icon: '🌧️' },
  heavy_rain: { label: 'Forte pluie',   icon: '🌧️' },
  wind:       { label: 'Vent fort',     icon: '💨' },
  storm:      { label: 'Orage',         icon: '⛈️' },
  heat:       { label: 'Forte chaleur', icon: '🔥' },
  other:      { label: 'Autre',         icon: '•' },
}

export function weatherLabel(code: WeatherCode | null | undefined): string | null {
  if (!code) return null
  return WEATHER_META[code]?.label ?? null
}
