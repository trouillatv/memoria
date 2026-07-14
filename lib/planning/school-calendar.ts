// Le calendrier scolaire → des fermetures de chantier.
//
// Une école fermée pendant les vacances, ce n'est pas une notion nouvelle : c'est
// une FERMETURE, exactement comme un jour férié ou un inventaire. Le calendrier
// ne fait que les produire en série, sur les chantiers qui le suivent.
//
// Toute la chaîne existante (vue Semaine, aperçu du roulement, conflits,
// tableau de bord) les voit alors sans une ligne de code de plus.
//
// Pur : aucune base, aucun réseau. Ce sont les règles, pas la plomberie.

export interface CalendarPeriod {
  id: string
  label: string
  /** yyyy-mm-dd */
  startsOn: string
  endsOn: string
}

/** La fermeture qu'une période produit sur UN chantier. */
export interface DerivedClosure {
  siteId: string
  calendarPeriodId: string
  /** Une période de vacances est un « congé » : le lieu est fermé, personne n'a
   *  décidé de le fermer exceptionnellement. */
  reasonKind: 'holiday'
  reason: string
  startsOn: string
  endsOn: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Une période dont les dates ne tiennent pas debout ne produit rien. Silencieux
 *  serait pire : c'est à l'écriture qu'on refuse, pas ici. */
export function isValidPeriod(p: CalendarPeriod): boolean {
  return (
    ISO.test(p.startsOn) &&
    ISO.test(p.endsOn) &&
    p.endsOn >= p.startsOn &&
    p.label.trim().length > 0
  )
}

/**
 * Les fermetures qu'un calendrier produit sur un chantier.
 *
 * Le libellé de la période DEVIENT le motif de la fermeture : « Vacances de
 * juillet » se lit tel quel dans la semaine, dans l'aperçu, dans le tableau de
 * bord. On ne réécrit pas les mots de l'utilisateur.
 */
export function derivedClosuresFor(
  siteId: string,
  periods: CalendarPeriod[],
): DerivedClosure[] {
  return periods.filter(isValidPeriod).map((p) => ({
    siteId,
    calendarPeriodId: p.id,
    reasonKind: 'holiday' as const,
    reason: p.label.trim(),
    startsOn: p.startsOn,
    endsOn: p.endsOn,
  }))
}

/**
 * Les périodes qui restent devant nous (ou en cours).
 *
 * On ne régénère jamais le passé : une fermeture déjà vécue a peut-être servi de
 * base à une décision. La réécrire changerait l'histoire.
 */
export function upcomingPeriods(periods: CalendarPeriod[], todayIso: string): CalendarPeriod[] {
  return periods.filter((p) => isValidPeriod(p) && p.endsOn >= todayIso)
}

/** « du 12 décembre au 15 février » — jamais deux dates ISO collées. */
const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

export function periodRangeFr(p: { startsOn: string; endsOn: string }): string {
  const fr = (iso: string) => {
    const d = new Date(`${iso}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`
  }
  if (p.startsOn === p.endsOn) return `le ${fr(p.startsOn)}`
  return `du ${fr(p.startsOn)} au ${fr(p.endsOn)}`
}

/** Combien de jours une période couvre — bornes comprises. */
export function periodDays(p: { startsOn: string; endsOn: string }): number {
  const a = new Date(`${p.startsOn}T00:00:00.000Z`).getTime()
  const b = new Date(`${p.endsOn}T00:00:00.000Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}


// ── L'EFFET — le calendrier dit QUAND, le chantier dit QUOI ─────────────────
//
// Les vacances scolaires sont un fait de calendrier. Leur effet est une règle
// de chantier : une école ferme, une autre fait justement son grand nettoyage
// pendant les vacances, un magasin n'est pas concerné.
//
//   'none'    non concerné      → aucune conséquence ;
//   'closed'  fermé             → SEUL ce mode produit des fermetures ;
//   'works'   travail prévu     → aucune fermeture, aucun conflit.

export type CalendarEffect = 'none' | 'closed' | 'works'

export interface SiteCalendarEffects {
  scolaire: CalendarEffect
  feries: CalendarEffect
}

export interface KindedPeriod extends CalendarPeriod {
  kind: 'scolaire' | 'ferie'
}

/**
 * LES PÉRIODES QUI FERMENT ce chantier — et rien d'autre.
 *
 * « works » et « none » ne produisent RIEN ici : le travail pendant les
 * vacances est normal, voire voulu. Transformer une période scolaire en
 * fermeture par défaut fabriquait de FAUX conflits — le pire poison pour la
 * crédibilité du rouge.
 */
export function closingPeriods(
  periods: KindedPeriod[],
  effects: SiteCalendarEffects,
): KindedPeriod[] {
  return periods.filter((p) =>
    p.kind === 'ferie' ? effects.feries === 'closed' : effects.scolaire === 'closed',
  )
}

/** Comment la règle se DIT — sur la fiche, dans la liste des chantiers concernés. */
export const CALENDAR_EFFECT_FR: Record<CalendarEffect, string> = {
  none: 'Non concerné',
  closed: 'Fermé pendant la période',
  works: 'Travail prévu pendant la période',
}
