// L'ÉCHELLE DU PLANNING — jour, semaine, mois.
//
// Guillaume ne dit jamais « je vais dans la vue Mois ». Il dit « montre-moi mon
// planning », puis il zoome. Le planning n'est donc pas trois écrans : c'est UN
// espace qu'on regarde de plus ou moins loin.
//
// Ce module ne contient que ce qui distingue une échelle d'une autre : le nombre
// de jours, et la densité d'affichage. Tout le reste — les données, les conflits,
// les fermetures, le tiroir, les gestes — est le MÊME. Un second moteur serait un
// second produit.
//
// Rien ici ne touche à la doctrine : la ligne du planning reste une ÉQUIPE (ou un
// chantier), jamais une personne. Une équipe d'une seule personne s'affiche par le
// nom de cette personne — c'est déjà le modèle, ce n'est pas un planning nominatif.

export type PlanningScale = 'day' | 'week' | 'month'

/** Une plage de jours, bornes incluses. La semaine en compte 7, le mois 28 à 31. */
export interface PlanningRange {
  /** yyyy-mm-dd UTC, inclus. */
  start: string
  /** yyyy-mm-dd UTC, inclus. */
  end: string
}

/**
 * Les jours de la plage, bornes incluses.
 *
 * L'ancien `enumerateWeekDays` partait du lundi et comptait sept jours en
 * ignorant `weekEnd` : c'est LE verrou qui clouait la grille à la semaine.
 * Ici, la plage décide — sept jours ou trente-et-un, c'est le même code.
 */
export function enumerateRangeDays(range: PlanningRange): string[] {
  const out: string[] = []
  const start = new Date(range.start + 'T00:00:00Z').getTime()
  const end = new Date(range.end + 'T00:00:00Z').getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

const WEEKDAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] as const

/**
 * Le jour de la semaine, DÉDUIT DE LA DATE.
 *
 * La grille indexait ses libellés par position (`DAY_LABELS_SHORT[i]`), ce qui ne
 * marche que si la première colonne est un lundi et qu'il y en a exactement sept.
 * À trente-et-une colonnes, le 8 du mois se serait appelé « Lun ».
 */
export function weekdayShortFr(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return WEEKDAYS_FR[d.getUTCDay()] ?? ''
}

/** Le quantième (le « 14 » de « 14 juillet »). */
export function dayNumber(iso: string): number {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(iso)
  return m ? Number(m[1]) : 0
}

/** Samedi ou dimanche — le mois en compte huit ou neuf, il faut les distinguer. */
export function isWeekend(iso: string): boolean {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay()
  return day === 0 || day === 6
}

/**
 * La DENSITÉ d'une colonne. C'est tout ce que l'échelle change à l'écran.
 *
 * Semaine : la case respire, elle porte l'heure et l'équipe.
 * Mois : la case se resserre, elle porte le nombre et les signaux.
 * Le clic, lui, ouvre le même tiroir. Toujours.
 */
export function columnWidthClass(scale: PlanningScale): string {
  switch (scale) {
    case 'month':
      return 'min-w-[2.25rem]'
    case 'day':
      return 'min-w-[16rem]'
    case 'week':
    default:
      return 'min-w-[7rem]'
  }
}
