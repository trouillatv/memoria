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

/**
 * Format de date relative étendu pour les artefacts pouvant être anciens
 * (sprint D — mémoire qui sait vieillir, Vincent 2026-05-22).
 *
 * Couvre l'horizon de plusieurs années, ce que ne fait pas formatRelativeShort.
 * Utilisé dans les briefs de passage de témoin pour distinguer une anomalie
 * récente d'une anomalie d'il y a 2 ans.
 *
 * Exemples :
 *   - moins de 24h → "aujourd'hui"
 *   - 1-6 jours → "il y a N jours"
 *   - 1-3 semaines → "il y a N semaines"
 *   - 1-23 mois → "il y a N mois"
 *   - 24+ mois → "il y a N ans"
 */
export function formatRelativeLong(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const diffMs = now.getTime() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return "aujourd'hui"
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays} jours`
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return weeks === 1 ? 'il y a 1 semaine' : `il y a ${weeks} semaines`
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30)
    return months === 1 ? 'il y a 1 mois' : `il y a ${months} mois`
  }
  const years = Math.floor(diffDays / 365)
  return years === 1 ? 'il y a 1 an' : `il y a ${years} ans`
}

/**
 * Test rapide pour savoir si un artefact mérite la "mémoire vive" (par défaut)
 * ou bascule en mémoire atténuée. Sprint D — Vincent 2026-05-22.
 *
 * Seuils par défaut (philosophie-de-loubli) :
 *   - anomalie : 90 jours
 *   - intervention : 90 jours
 *   - photo : 180 jours
 *   - à savoir : pas de cutoff temporel (active_until le gère côté DB)
 *   - document : 730 jours (2 ans)
 */
export function isFresh(iso: string | null, cutoffDays: number, now: Date = new Date()): boolean {
  if (!iso) return false
  const then = new Date(iso)
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
  return diffDays <= cutoffDays
}
