'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  upsertSiteDayLog,
  getSiteCoordinates,
  setSiteCoordinates,
  getSiteDayLog,
  enrichSiteDayLogWeather,
} from '@/lib/db/site-day-log'
import {
  geocodePlace,
  fetchDailyWeather,
  mapWmoToWeatherCode,
  suggestIntemperie,
} from '@/services/weather/open-meteo'

const WEATHER = [
  'clear', 'cloudy', 'rain', 'heavy_rain', 'wind', 'storm', 'heat', 'other',
] as const

const schema = z.object({
  siteId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  weather: z.enum(WEATHER).nullable(),
  intemperie: z.boolean(),
  note: z.string().trim().max(280).nullable(),
})

export async function recordDayWeatherAction(input: {
  siteId: string
  logDate: string
  weather: (typeof WEATHER)[number] | null
  intemperie: boolean
  note: string | null
}): Promise<{ ok: true } | { error: string }> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  // Le journal de chantier est piloté côté superviseur, pas par le terrain.
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  await upsertSiteDayLog({
    siteId: parsed.data.siteId,
    logDate: parsed.data.logDate,
    weather: parsed.data.weather,
    intemperie: parsed.data.intemperie,
    note: parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null,
    userId: user.id,
  })

  revalidatePath(`/sites/${parsed.data.siteId}/journal`)
  return { ok: true }
}

// ── Météo Open-Meteo (commit 2, mig 161) ─────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/admin'
import type { WeatherCode } from '@/lib/db/site-day-log-meta'

const uuid = z.string().uuid()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Aujourd'hui en date civile Pacific/Noumea (en-CA → yyyy-mm-dd). */
function todayNoumeaCivil(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Noumea' })
}

async function requireSupervisor() {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role === 'chef_equipe') return null
  return user
}

export async function setSiteCoordinatesAction(
  siteId: string,
  latitude: number,
  longitude: number,
): Promise<{ ok: true } | { error: string }> {
  if (!uuid.safeParse(siteId).success) return { error: 'Site invalide' }
  if (
    typeof latitude !== 'number' || typeof longitude !== 'number' ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180
  ) {
    return { error: 'Coordonnées invalides' }
  }
  const user = await requireSupervisor()
  if (!user) return { error: 'Non autorisé' }
  await setSiteCoordinates(siteId, latitude, longitude)
  revalidatePath(`/sites/${siteId}/journal`)
  return { ok: true }
}

/** Géocode best-effort le site (nom + adresse) via Open-Meteo. Propose, ne sauve pas. */
export async function geocodeSiteAction(
  siteId: string,
): Promise<{ ok: true; latitude: number; longitude: number; label: string } | { error: string }> {
  if (!uuid.safeParse(siteId).success) return { error: 'Site invalide' }
  const user = await requireSupervisor()
  if (!user) return { error: 'Non autorisé' }
  const { data } = await createAdminClient().from('sites').select('name, address').eq('id', siteId).maybeSingle()
  const name = ((data as { name?: string } | null)?.name ?? '').trim()
  const address = ((data as { address?: string } | null)?.address ?? '').trim()
  const query = [name, address].filter(Boolean).join(', ') || name
  const r = await geocodePlace(query)
  if (!r) return { error: 'Lieu introuvable — saisissez les coordonnées à la main.' }
  const label = [r.name, r.admin, r.country].filter(Boolean).join(', ')
  return { ok: true, latitude: r.latitude, longitude: r.longitude, label }
}

export interface FetchWeatherResult {
  ok: true
  cached: boolean
  weather: WeatherCode | null
  precipitationMm: number | null
  windMaxKmh: number | null
  tempMax: number | null
  intemperieSuggeree: boolean
}

/** Récupère la météo du jour depuis Open-Meteo et enrichit site_day_log (cache). */
export async function fetchSiteWeatherAction(
  siteId: string,
  logDate: string,
  opts?: { force?: boolean },
): Promise<FetchWeatherResult | { error: string; needCoords?: boolean }> {
  if (!uuid.safeParse(siteId).success) return { error: 'Site invalide' }
  if (!dateStr.safeParse(logDate).success) return { error: 'Date invalide' }
  const user = await requireSupervisor()
  if (!user) return { error: 'Non autorisé' }

  const coords = await getSiteCoordinates(siteId)
  if (coords.latitude == null || coords.longitude == null) {
    return { error: 'Coordonnées du chantier manquantes.', needCoords: true }
  }

  // Cache : déjà récupéré pour ce jour → on ne rappelle pas l'API (sauf force).
  if (!opts?.force) {
    const existing = await getSiteDayLog(siteId, logDate)
    if (existing?.weatherSource === 'open-meteo') {
      return {
        ok: true, cached: true, weather: existing.weather,
        precipitationMm: existing.precipitationMm, windMaxKmh: existing.windMaxKmh,
        tempMax: existing.tempMax, intemperieSuggeree: false,
      }
    }
  }

  const daily = await fetchDailyWeather({
    latitude: coords.latitude,
    longitude: coords.longitude,
    date: logDate,
    todayCivil: todayNoumeaCivil(),
  })
  if (!daily) return { error: 'Météo indisponible pour cette date (Open-Meteo).' }

  const weather = mapWmoToWeatherCode(daily.wmoCode, daily.precipitationMm, daily.windMaxKmh, daily.tempMax)
  await enrichSiteDayLogWeather({
    siteId, logDate, weather,
    precipitationMm: daily.precipitationMm, windMaxKmh: daily.windMaxKmh,
    tempMin: daily.tempMin, tempMax: daily.tempMax,
    source: 'open-meteo', userId: user.id,
  })
  revalidatePath(`/sites/${siteId}/journal`)
  revalidatePath(`/sites/${siteId}`)
  return {
    ok: true, cached: false, weather,
    precipitationMm: daily.precipitationMm, windMaxKmh: daily.windMaxKmh,
    tempMax: daily.tempMax, intemperieSuggeree: suggestIntemperie(daily),
  }
}
