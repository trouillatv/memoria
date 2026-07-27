/**
 * Poids du score de priorisation métier — source unique, ajustable sans
 * réécrire l'algorithme. Trois dimensions + bonus contextuel.
 *
 * Max théorique : 40 + 30 + 20 + 15 = 105.
 * Le score est interne ; l'utilisateur voit uniquement l'ordre résultant.
 */
export const PRIORITY_WEIGHTS = {
  /** Impact par type : risque terrain si la situation reste non traitée. */
  /**
   * Doctrine temporelle (avec la dimension urgence) :
   * dépassé > dû aujourd'hui > dû demain > ancien sans échéance > surveillance.
   * upcoming_promise dû aujourd'hui : 20+30=50 — sous expired_promise (30+25=55) ;
   * upcoming_action demain : 25+15=40 ; upcoming_promise demain : 20+15=35 —
   * au-dessus d'unconfirmed_promise (20+0) et stale_action (10).
   */
  impact: {
    overdue_action:        40,
    planning_conflict:     40,
    overdue_planned_visit: 35,
    expired_promise:       30,
    pending_debrief:       30,
    open_reserve:          30,
    upcoming_action:       25,
    unconfirmed_promise:   20,
    upcoming_promise:      20,
    stale_site_visit:      15,
    stale_action:          10,
  },

  /**
   * Urgence calendaire — basée sur dueAt vs aujourd'hui.
   * « Aujourd'hui » vaut plus qu'« en retard » : ne pas rater l'échéance
   * du jour est prioritaire sur rattraper une échéance déjà manquée.
   */
  urgency: {
    today:    30,
    overdue:  25,
    tomorrow: 15,
    thisWeek: 10,
    none:      0,
  },

  /**
   * Ancienneté du signal (jours depuis detectedAt) — plafonné à 20 pour
   * éviter qu'un sujet très vieux domine indéfiniment.
   */
  staleness: {
    days0to7:    0,
    days8to14:   5,
    days15to21: 10,
    days22to30: 15,
    daysOver30: 20,
  },

  /** Bonus contextuel : le conducteur a une activité sur ce chantier aujourd'hui. */
  context: {
    siteScheduledToday: 15,
  },
} as const

/** Contexte de la journée transmis au calcul de priorité. */
export interface PriorityContext {
  /** Sites avec une activité programmée aujourd'hui (visite, réunion, etc.). */
  siteIdsToday: ReadonlySet<string>
}

export const DEFAULT_PRIORITY_CONTEXT: PriorityContext = {
  siteIdsToday: new Set(),
}
