// V5.1 Slice 3 — Fading temporel : opacity en fonction de l'âge.
//
// Décroissance exponentielle douce. Half-life ~180 jours.
// Plancher à 0.2 : un event d'il y a 5 ans reste lisible (mémoire qui se fane,
// jamais s'efface). Plafond à 1.0 : un event récent + saillant est plein.

/**
 * Calcule l'opacity de rendu à partir de la saillance et de l'âge.
 *
 * Formule : max(0.2, salience * exp(-ageDays / 180))
 *
 * Quelques valeurs de référence (salience=1.0 anomalie active) :
 *   ageDays=0    → 1.00
 *   ageDays=30   → 0.85
 *   ageDays=90   → 0.61
 *   ageDays=180  → 0.37
 *   ageDays=365  → 0.24
 *   ageDays=730  → 0.20 (plancher)
 *
 * Pour salience=0.2 (passage banal) :
 *   ageDays=0    → 0.20 (plancher direct)
 *   ageDays=30   → 0.20
 *
 * → un passage banal du jour est déjà discret ; une anomalie de 6 mois reste
 * lisible mais ne saute plus aux yeux. Cohérent avec la doctrine.
 */
export function opacityOf(salience: number, ageDays: number): number {
  const decayed = salience * Math.exp(-Math.max(0, ageDays) / 180)
  return Math.max(0.2, Math.min(1.0, decayed))
}

/**
 * Calcule l'âge en jours d'un timestamp ISO.
 * Référence : `now()` au moment du rendu serveur.
 */
export function ageDaysSince(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}
