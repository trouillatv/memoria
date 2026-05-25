// Helpers fuseau-aware pour calculer la date civile (yyyy-mm-dd) selon le
// fuseau de l'organisation (Pacific/Noumea, UTC+11). À utiliser PARTOUT où on
// veut "aujourd'hui local" ou "demain local" pour filtrer une date civile
// (scheduled_for, due_at, etc.).
//
// Pourquoi ? `new Date().toISOString().slice(0, 10)` retourne la date UTC.
// En Nouméa (UTC+11), entre 00:00 et 11:00 locale, la date UTC est la veille
// → on filtre les interventions d'hier au lieu d'aujourd'hui. Bug invisible
// en plein jour, visible le matin.

const NOUMEA_TIMEZONE = 'Pacific/Noumea'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NOUMEA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Aujourd'hui en zone Nouméa, yyyy-mm-dd. */
export function todayLocalIso(): string {
  return dateFormatter.format(new Date())
}

/** Date civile (yyyy-mm-dd) d'un instant en zone Nouméa. Utile pour comparer
 *  un `scheduled_at` (timestamp UTC) avec `aujourd'hui local`. */
export function localDateOf(date: Date): string {
  return dateFormatter.format(date)
}

/** Demain en zone Nouméa, yyyy-mm-dd. */
export function tomorrowLocalIso(): string {
  return addDaysLocal(todayLocalIso(), 1)
}

/** Hier en zone Nouméa, yyyy-mm-dd. */
export function yesterdayLocalIso(): string {
  return addDaysLocal(todayLocalIso(), -1)
}

/** Ajoute N jours à une date yyyy-mm-dd (raisonne en date civile UTC pour
 *  rester stable indépendamment du fuseau du serveur). */
export function addDaysLocal(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Format français court « 20 mai » EN ZONE NOUMÉA. Pour tout affichage
// utilisateur d'une date civile (fragments lecture site, audit log UI,
// etc.). Évite l'écueil silencieux : un événement créé à 09h Nouméa =
// 22h UTC la veille → la locale serveur en UTC affiche un jour trop tôt.
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: NOUMEA_TIMEZONE,
  day: 'numeric',
  month: 'long',
})

/** Date au format français court « 20 mai » en zone Nouméa.
 *  Accepte un ISO string ou un Date. Stable indépendamment du fuseau serveur. */
export function frDayMonthLocal(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso
    return dayMonthFormatter.format(d)
  } catch {
    return typeof iso === 'string' ? iso.slice(0, 10) : ''
  }
}
