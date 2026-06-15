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
import { getOrgId } from '@/lib/db/users'
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
    .select('log_date, weather, intemperie, note')
    .eq('site_id', siteId)
    .order('log_date', { ascending: false })
  if (options?.dateFrom) q = q.gte('log_date', options.dateFrom)

  const { data, error } = await q
  if (error) {
    // Dégradation gracieuse si la migration 108 n'est pas encore appliquée.
    const code = (error as { code?: string }).code ?? ''
    const msg = error.message ?? ''
    if (code === '42P01' || msg.includes('does not exist') || msg.includes('site_day_log')) {
      return []
    }
    throw error
  }
  return (data ?? []).map((r) => ({
    logDate: r.log_date as string,
    weather: (r.weather as WeatherCode | null) ?? null,
    intemperie: Boolean(r.intemperie),
    note: (r.note as string | null) ?? null,
  }))
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
  const orgId = await getOrgId()
  const { error } = await sb
    .from('site_day_log')
    .upsert(
      {
        site_id: input.siteId,
        organization_id: orgId,
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
