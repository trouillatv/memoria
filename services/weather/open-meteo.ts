// Service météo Open-Meteo (V1, commit 2) — sans clé API, sans scraping.
//
// Deux usages :
//   1. Géocoder un site (nom/adresse → lat/lon) — AIDE à la saisie, best-effort.
//   2. Récupérer la météo journalière d'un site à une date → enrichit site_day_log.
//
// Doctrine : la météo DOCUMENTE un blocage déclaré, elle ne le crée jamais
// (cf. [[litige-no-automatic-reading]]). Le mapping WMO → enum + la suggestion
// d'intempérie sont des fonctions PURES (testables), jamais appliquées d'office.
//
// Open-Meteo : forecast (api.open-meteo.com) pour les dates récentes/futures,
// archive (archive-api.open-meteo.com) au-delà de ~5 jours dans le passé.

import type { WeatherCode } from '@/lib/db/site-day-log-meta'

export interface DailyWeather {
  date: string // yyyy-mm-dd
  precipitationMm: number | null
  rainMm: number | null
  windMaxKmh: number | null
  tempMin: number | null
  tempMax: number | null
  wmoCode: number | null
}

export interface GeocodeResult {
  latitude: number
  longitude: number
  name: string
  admin: string | null
  country: string | null
}

// ── Fonctions PURES (testables) ──────────────────────────────────────────────

/**
 * Mappe un code WMO Open-Meteo (+ précipitations/vent/chaleur) vers l'enum météo
 * déjà utilisé par le journal. Déterministe. Les seuils « forte pluie / vent /
 * chaleur » sont volontairement explicites (pas d'IA).
 */
export function mapWmoToWeatherCode(
  wmo: number | null,
  precipMm: number | null,
  windKmh: number | null,
  tempMax: number | null,
): WeatherCode {
  // Surcharges « conditions marquantes » d'abord (priment sur le ciel).
  if (wmo !== null && wmo >= 95) return 'storm' // 95/96/99 = orage
  if ((precipMm ?? 0) >= 20) return 'heavy_rain'
  if ((windKmh ?? 0) >= 50) return 'wind'
  if ((tempMax ?? 0) >= 33) return 'heat'

  if (wmo === null) return 'other'
  if (wmo === 0) return 'clear'
  if (wmo <= 3) return 'cloudy' // 1 peu nuageux · 2 partiellement · 3 couvert
  if (wmo === 45 || wmo === 48) return 'cloudy' // brouillard
  if (wmo >= 51 && wmo <= 67) return 'rain' // bruine + pluie
  if (wmo >= 80 && wmo <= 82) return (precipMm ?? 0) >= 20 ? 'heavy_rain' : 'rain' // averses
  if (wmo >= 71 && wmo <= 86) return 'other' // neige / grésil : hors enum chantier NC
  return 'other'
}

/**
 * Suggestion d'intempérie (jamais appliquée d'office) : conditions qui empêchent
 * typiquement de travailler. L'humain garde la main sur le drapeau.
 */
export function suggestIntemperie(daily: Pick<DailyWeather, 'precipitationMm' | 'windMaxKmh' | 'wmoCode'>): boolean {
  if ((daily.precipitationMm ?? 0) >= 20) return true
  if ((daily.windMaxKmh ?? 0) >= 60) return true
  if (daily.wmoCode !== null && daily.wmoCode >= 95) return true
  return false
}

/** Phrase courte « pluie 42 mm · vent 55 km/h » pour la timeline / le journal. PUR. */
export function weatherMetricsSummary(d: {
  precipitationMm?: number | null
  windMaxKmh?: number | null
  tempMax?: number | null
}): string | null {
  const parts: string[] = []
  if (d.precipitationMm != null && d.precipitationMm > 0) parts.push(`pluie ${Math.round(d.precipitationMm)} mm`)
  if (d.windMaxKmh != null && d.windMaxKmh >= 30) parts.push(`vent ${Math.round(d.windMaxKmh)} km/h`)
  if (d.tempMax != null && d.tempMax >= 33) parts.push(`${Math.round(d.tempMax)} °C`)
  return parts.length ? parts.join(' · ') : null
}

/** Choisit l'endpoint : archive si la date est à plus de 5 j dans le passé. PUR. */
export function endpointForDate(date: string, todayCivil: string): 'archive' | 'forecast' {
  const d = Date.parse(`${date}T00:00:00Z`)
  const t = Date.parse(`${todayCivil}T00:00:00Z`)
  if (Number.isNaN(d) || Number.isNaN(t)) return 'forecast'
  const diffDays = (t - d) / 86_400_000
  return diffDays > 5 ? 'archive' : 'forecast'
}

// ── Appels réseau ────────────────────────────────────────────────────────────

const DAILY_VARS = [
  'precipitation_sum',
  'rain_sum',
  'wind_speed_10m_max',
  'temperature_2m_max',
  'temperature_2m_min',
  'weather_code',
].join(',')

function firstNum(arr: unknown, i = 0): number | null {
  if (!Array.isArray(arr)) return null
  const v = arr[i]
  return typeof v === 'number' ? v : null
}

/** Géocode best-effort (place-name). Renvoie null si rien trouvé / erreur réseau. */
export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const q = query.trim()
  if (!q) return null
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=fr&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> }
    const r = json.results?.[0]
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null
    return {
      latitude: r.latitude,
      longitude: r.longitude,
      name: String(r.name ?? q),
      admin: (r.admin1 as string | undefined) ?? null,
      country: (r.country as string | undefined) ?? null,
    }
  } catch {
    return null
  }
}

/** Météo journalière d'une coordonnée à une date. null si indisponible. */
export async function fetchDailyWeather(args: {
  latitude: number
  longitude: number
  date: string // yyyy-mm-dd
  todayCivil: string
}): Promise<DailyWeather | null> {
  const { latitude, longitude, date, todayCivil } = args
  const host =
    endpointForDate(date, todayCivil) === 'archive'
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast'
  const url =
    `${host}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=${DAILY_VARS}&timezone=auto&start_date=${date}&end_date=${date}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const json = (await res.json()) as { daily?: Record<string, unknown> }
    const d = json.daily
    if (!d) return null
    return {
      date,
      precipitationMm: firstNum(d.precipitation_sum),
      rainMm: firstNum(d.rain_sum),
      windMaxKmh: firstNum(d.wind_speed_10m_max),
      tempMax: firstNum(d.temperature_2m_max),
      tempMin: firstNum(d.temperature_2m_min),
      wmoCode: firstNum(d.weather_code),
    }
  } catch {
    return null
  }
}
