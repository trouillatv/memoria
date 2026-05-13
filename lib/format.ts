/**
 * Formatters partagés (dates, durées).
 * Extrait de /preuves/[id] et /p/[token] pour DRY.
 */

export function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/**
 * Format de date relative court, factuel, descriptif passif.
 * Utilisé pour la mémoire des lieux (Sprint 2) — pas de wording de contrôle,
 * juste de la temporalité observée.
 *
 * Exemples :
 *   - moins de 24h → "aujourd'hui"
 *   - 1 jour → "hier"
 *   - 2-6 jours → "il y a N jours"
 *   - 7-13 jours → "il y a 1 semaine"
 *   - 14-29 jours → "il y a N semaines"
 *   - 30+ jours → date courte ("12 avr.")
 */
export function formatRelativeShort(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const diffMs = now.getTime() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return "aujourd'hui"
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays} jours`
  if (diffDays < 14) return 'il y a 1 semaine'
  if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} semaines`
  // Au-delà : date courte ISO française (« 12 avr. »).
  return then.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
