// V5.1 Slice 6 — Silence du dimanche.
//
// Doctrine Vincent 2026-05-14 : MemorIA se tait par discipline le dimanche.
// Position de marque indélébile. Cohérent avec la grammaire de rareté (V5.1).
//
// Portée :
//   - ✅ Bloque les envois proactifs (email, SMS, push, crons, rapports auto).
//   - ❌ N'interfère JAMAIS avec l'accès lecture. L'app reste ouverte 24/7.
//        Guillaume peut consulter, télécharger un dossier de preuves, ouvrir un
//        site le dimanche à 22h sans aucune friction.
//
// Exception system-critical : alertes de panne système au tenant admin
// passent même dimanche (hardcoded, jamais configurable, cf. doc plan V5.1.2).
//
// Mono-tenant pilote AGP : timezone par défaut = 'Pacific/Noumea'. Quand le
// produit deviendra multi-tenant, le timezone viendra du record tenant.

export const DEFAULT_TENANT_TIMEZONE = 'Pacific/Noumea' as const

/**
 * Channels exemptés du silence dimanche. À étendre avec parcimonie.
 * Toute nouvelle valeur doit être hardcodée (pas configurable runtime).
 */
const SYSTEM_CRITICAL_CHANNELS = ['system-critical'] as const
export type SystemCriticalChannel = (typeof SYSTEM_CRITICAL_CHANNELS)[number]

/**
 * Vrai si `date` (UTC) tombe un dimanche dans la timezone tenant.
 *
 * Implémentation : Intl.DateTimeFormat natif, pas de dépendance externe.
 * Renvoie le weekday en anglais ('Sunday') que l'on compare directement.
 */
export function isQuietDay(
  date: Date = new Date(),
  tenantTimezone: string = DEFAULT_TENANT_TIMEZONE,
): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: tenantTimezone,
    weekday: 'long',
  }).format(date)
  return weekday === 'Sunday'
}

/**
 * Décide si une sortie async proactive doit être différée.
 *
 * Règle :
 *   - Channel system-critical → JAMAIS différé (return false).
 *   - Sinon dimanche local tenant → différé (return true).
 *   - Sinon → not deferred (return false).
 *
 * Pattern d'usage côté caller (email/SMS/cron) :
 *
 *   if (shouldDeferAsyncOutput(now, tenantTz)) {
 *     await enqueueForLater(payload, nextActiveTimestamp(now, tenantTz))
 *     return { deferred: true }
 *   }
 *   // Sinon : envoi normal
 */
export function shouldDeferAsyncOutput(
  now: Date = new Date(),
  tenantTimezone: string = DEFAULT_TENANT_TIMEZONE,
  channel?: string,
): boolean {
  if (channel && (SYSTEM_CRITICAL_CHANNELS as readonly string[]).includes(channel)) {
    return false
  }
  return isQuietDay(now, tenantTimezone)
}

/**
 * Calcule le prochain timestamp UTC correspondant au lundi 7h locale tenant.
 * Utilisé par les emails programmés / crons pour savoir quand reprendre.
 *
 * Algorithme :
 *   1. Convertit `now` en composants Y-M-D-H-m dans la timezone tenant.
 *   2. Trouve le prochain lundi (peut être 1-7 jours dans le futur).
 *   3. Compose lundi 07:00 dans la tz tenant.
 *   4. Reconvertit en UTC.
 */
export function nextActiveTimestamp(
  now: Date = new Date(),
  tenantTimezone: string = DEFAULT_TENANT_TIMEZONE,
): Date {
  // Extraire les composants dans la tz tenant
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tenantTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  const hour = Number(get('hour'))
  const weekday = get('weekday')

  // Mapping weekday → days to add to reach Monday 07:00 local
  const WEEKDAY_TO_DAYS_TO_MONDAY: Record<string, number> = {
    Monday: hour < 7 ? 0 : 7,
    Tuesday: 6,
    Wednesday: 5,
    Thursday: 4,
    Friday: 3,
    Saturday: 2,
    Sunday: 1,
  }
  const daysToAdd = WEEKDAY_TO_DAYS_TO_MONDAY[weekday] ?? 1

  // Compose le lundi cible (local tenant) en string ISO, puis interprète
  // dans la tz tenant via une astuce : on construit une date UTC fictive,
  // on calcule l'offset tenant à cette date, on corrige.
  // Note : approximation suffisante pour le silence dimanche (pas critique
  // à la milliseconde près). En cas de DST tenant (peu probable Pacific/Noumea),
  // une dérive de 1h max est acceptable.
  const targetLocalMs =
    Date.UTC(year, month - 1, day + daysToAdd, 7, 0, 0, 0)

  // Offset entre UTC et tz tenant à cette date (approx via now)
  const offsetMs = getTimezoneOffsetMs(now, tenantTimezone)
  return new Date(targetLocalMs - offsetMs)
}

/**
 * Calcule l'offset en ms entre UTC et la timezone tenant à l'instant `date`.
 * Positif si la tz est en avance sur UTC (ex. Pacific/Noumea = UTC+11 → +11h).
 */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (parts: Intl.DateTimeFormatPart[], type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const utcMs = Date.UTC(
    get(utcParts, 'year'),
    get(utcParts, 'month') - 1,
    get(utcParts, 'day'),
    get(utcParts, 'hour'),
    get(utcParts, 'minute'),
    get(utcParts, 'second'),
  )
  const tzMs = Date.UTC(
    get(tzParts, 'year'),
    get(tzParts, 'month') - 1,
    get(tzParts, 'day'),
    get(tzParts, 'hour'),
    get(tzParts, 'minute'),
    get(tzParts, 'second'),
  )
  return tzMs - utcMs
}
