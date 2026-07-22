// Journal de chantier — météo / intempéries du jour (Tier 1 BTP).
//
// Une entrée par site et par jour. Sert deux buts :
//   1. Tracer la météo du chantier (contexte du journal).
//   2. Marquer un JOUR D'INTEMPÉRIE — preuve datée et opposable face aux
//      pénalités de retard, y compris les jours où personne n'a travaillé.
//
// Doctrine : descriptif, niveau SITE, jamais une mesure d'humain. Sécurité :
// admin client + scoping `organization_id` (comme les autres helpers).

import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import type { JournalEntry } from '@/lib/db/site-journal'
import { WEATHER_META, weatherLabel, type WeatherCode } from '@/lib/db/site-day-log-meta'

// Présentation météo : définie dans site-day-log-meta.ts (client-safe).
// Re-exportée ici pour la rétro-compat des importateurs serveur existants.
export { WEATHER_META, weatherLabel }
export type { WeatherCode }

export interface SiteDayWeather {
  logDate: string // yyyy-mm-dd
  weather: WeatherCode | null
  intemperie: boolean
  note: string | null
  // Métriques Open-Meteo (mig 161) — null si météo saisie à la main.
  precipitationMm: number | null
  windMaxKmh: number | null
  tempMin: number | null
  tempMax: number | null
  weatherSource: string | null
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getSiteDayLogs(
  siteId: string,
  options?: { dateFrom?: string },
): Promise<SiteDayWeather[]> {
  const sb = createAdminClient()
  let q = sb
    .from('site_day_log')
    .select('log_date, weather, intemperie, note, precipitation_mm, wind_max_kmh, temp_min, temp_max, weather_source')
    .eq('site_id', siteId)
    .order('log_date', { ascending: false })
  if (options?.dateFrom) q = q.gte('log_date', options.dateFrom)

  const { data, error } = await q
  if (error) {
    // Dégradation gracieuse si la migration 108/161 n'est pas encore appliquée.
    const code = (error as { code?: string }).code ?? ''
    const msg = error.message ?? ''
    if (code === '42P01' || msg.includes('does not exist') || msg.includes('site_day_log') || msg.includes('column')) {
      return []
    }
    throw error
  }
  return (data ?? []).map(rowToDayWeather)
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null
}

function rowToDayWeather(r: Record<string, unknown>): SiteDayWeather {
  return {
    logDate: r.log_date as string,
    weather: (r.weather as WeatherCode | null) ?? null,
    intemperie: Boolean(r.intemperie),
    note: (r.note as string | null) ?? null,
    precipitationMm: num(r.precipitation_mm),
    windMaxKmh: num(r.wind_max_kmh),
    tempMin: num(r.temp_min),
    tempMax: num(r.temp_max),
    weatherSource: (r.weather_source as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Coordonnées du site (mig 161) — pour interroger Open-Meteo.
// ---------------------------------------------------------------------------

export interface SiteCoordinates {
  latitude: number | null
  longitude: number | null
}

export async function getSiteCoordinates(siteId: string): Promise<SiteCoordinates> {
  const { data } = await createAdminClient()
    .from('sites')
    .select('latitude, longitude')
    .eq('id', siteId)
    .maybeSingle()
  return {
    latitude: num((data as Record<string, unknown> | null)?.latitude),
    longitude: num((data as Record<string, unknown> | null)?.longitude),
  }
}

export async function setSiteCoordinates(siteId: string, latitude: number, longitude: number): Promise<void> {
  const { error } = await createAdminClient()
    .from('sites')
    .update({ latitude, longitude })
    .eq('id', siteId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Lecture d'UN jour précis (cache) + d'un lot d'ids (timeline blocage météo).
// ---------------------------------------------------------------------------

/** Id du jour de météo (pour lier un blocage météo), ou null s'il n'existe pas. */
export async function getSiteDayLogId(siteId: string, logDate: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('site_day_log')
    .select('id')
    .eq('site_id', siteId)
    .eq('log_date', logDate)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function getSiteDayLog(siteId: string, logDate: string): Promise<SiteDayWeather | null> {
  const { data } = await createAdminClient()
    .from('site_day_log')
    .select('id, log_date, weather, intemperie, note, precipitation_mm, wind_max_kmh, temp_min, temp_max, weather_source')
    .eq('site_id', siteId)
    .eq('log_date', logDate)
    .maybeSingle()
  return data ? rowToDayWeather(data as Record<string, unknown>) : null
}

export async function getDayLogsByIds(ids: string[]): Promise<Map<string, SiteDayWeather>> {
  const out = new Map<string, SiteDayWeather>()
  if (ids.length === 0) return out
  const { data, error } = await createAdminClient()
    .from('site_day_log')
    .select('id, log_date, weather, intemperie, note, precipitation_mm, wind_max_kmh, temp_min, temp_max, weather_source')
    .in('id', ids)
  if (error) return out
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(r.id as string, rowToDayWeather(r))
  }
  return out
}

// ---------------------------------------------------------------------------
// Enrichissement météo depuis l'API (mig 161). PRÉSERVE le drapeau intemperie
// et la note saisis par l'humain : la météo documente, elle ne décide pas.
// Renvoie l'id du jour (pour pouvoir lier un blocage météo).
// ---------------------------------------------------------------------------

export async function enrichSiteDayLogWeather(input: {
  siteId: string
  logDate: string
  weather: WeatherCode | null
  precipitationMm: number | null
  windMaxKmh: number | null
  tempMin: number | null
  tempMax: number | null
  source: string
  userId?: string | null
}): Promise<string> {
  const sb = createAdminClient()
  const { data: siteRow } = await sb.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!siteRow) throw new Error('Chantier introuvable')
  const membership = await requireOrganizationMembership((siteRow as { organization_id: string }).organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const weatherFields = {
    weather: input.weather,
    precipitation_mm: input.precipitationMm,
    wind_max_kmh: input.windMaxKmh,
    temp_min: input.tempMin,
    temp_max: input.tempMax,
    weather_source: input.source,
    weather_fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { data: existing } = await sb
    .from('site_day_log')
    .select('id')
    .eq('site_id', input.siteId)
    .eq('log_date', input.logDate)
    .maybeSingle()

  if (existing) {
    // Mise à jour CIBLÉE : on ne touche ni intemperie ni note (décision humaine).
    const { data, error } = await sb
      .from('site_day_log')
      .update(weatherFields)
      .eq('id', (existing as { id: string }).id)
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  }

  const { data, error } = await sb
    .from('site_day_log')
    .insert({
      site_id: input.siteId,
      organization_id: (siteRow as { organization_id: string }).organization_id,
      log_date: input.logDate,
      intemperie: false, // suggestion seulement — jamais auto-cochée ici
      created_by: input.userId ?? null,
      ...weatherFields,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ---------------------------------------------------------------------------
// Écriture (upsert : une entrée par site et par jour)
// ---------------------------------------------------------------------------

export async function upsertSiteDayLog(input: {
  siteId: string
  logDate: string
  weather: WeatherCode | null
  intemperie: boolean
  note: string | null
  userId: string | null
}): Promise<void> {
  const sb = createAdminClient()
  const { data: siteRow } = await sb.from('sites').select('organization_id').eq('id', input.siteId).maybeSingle()
  if (!siteRow) throw new Error('Chantier introuvable')
  const membership = await requireOrganizationMembership((siteRow as { organization_id: string }).organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const { error } = await sb
    .from('site_day_log')
    .upsert(
      {
        site_id: input.siteId,
        organization_id: (siteRow as { organization_id: string }).organization_id,
        log_date: input.logDate,
        weather: input.weather,
        intemperie: input.intemperie,
        note: input.note,
        created_by: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'site_id,log_date' },
    )
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Fusion pure (testable) — attache la météo aux jours du journal ET injecte
// les jours d'intempérie sans intervention (sinon ils n'apparaîtraient pas).
// ---------------------------------------------------------------------------

export function mergeWeatherIntoJournal(
  entries: JournalEntry[],
  logs: SiteDayWeather[],
): JournalEntry[] {
  const byDate = new Map<string, JournalEntry>()
  for (const e of entries) byDate.set(e.date, { ...e })

  for (const log of logs) {
    const existing = byDate.get(log.logDate)
    if (existing) {
      existing.weather = log.weather
      existing.intemperie = log.intemperie
      existing.weatherNote = log.note
    } else {
      // Jour sans intervention mais avec une entrée météo (typiquement
      // intempérie) : on l'injecte pour qu'il apparaisse au journal.
      byDate.set(log.logDate, {
        date: log.logDate,
        interventions: [],
        weather: log.weather,
        intemperie: log.intemperie,
        weatherNote: log.note,
      })
    }
  }

  return [...byDate.values()].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
}
