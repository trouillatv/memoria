// ── LE CONTRAT DE LA TIMELINE ────────────────────────────────────────────────
// Les objets restent SPÉCIALISÉS en écriture — une visite, une réunion, une
// intervention et une échéance n'ont pas le même cycle de vie, et une table
// universelle `events` gommerait leurs règles métier. Mais ils produisent tous le
// MÊME contrat de LECTURE : c'est là qu'ils se rejoignent.
//
// Cinq types d'événement concurrents cohabitaient dans le dépôt (PlanningEvent,
// WeekOperationalSignal, NextStep, TimelineEvent, OverviewEventInput). Chaque
// écran en lisait un, aucun ne lisait les mêmes faits. Ce contrat est celui vers
// lequel ils convergent.
//
// Module PUR : aucune base, aucun serveur. Le composer (lib/db/planning-timeline)
// remplit ce contrat ; le Jour, la Semaine et le Mois n'affichent que lui.

/** Ce qu'un événement EST. Le type porte le sens métier, jamais la couleur. */
export type PlanningEventType =
  | 'intervention'
  | 'visite'
  /** Une réunion RÉELLEMENT tenue (elle a un compte-rendu). */
  | 'reunion'
  /** Une INTENTION de réunion : une date portée par un CR précédent. Ce n'est pas
   *  une réunion — elle n'a ni heure, ni participants, ni déroulé. On ne lui en
   *  invente pas : l'interface donnerait une certitude que le modèle n'a pas. */
  | 'reunion_a_organiser'
  | 'action'
  | 'echeance'
  | 'roulement'
  | 'fermeture'
  | 'blocage'

/**
 * Ce qu'on SAIT de l'événement.
 *   confirmed — un humain l'a décidé, ou le fait a eu lieu.
 *   proposed  — MemorIA l'a détecté, personne ne l'a encore validé.
 * Mélanger les deux, c'est faire passer une déduction pour un engagement. Le jour
 * où une date proposée est fausse, c'est tout le planning qu'on cesse de croire.
 */
export type PlanningCertainty = 'confirmed' | 'proposed'

/** Où en est l'événement. `done` et `in_progress` regardent le passé ; `upcoming`
 *  le futur ; `overdue` dit qu'une date est passée sans que rien n'arrive. */
export type PlanningEventStatus = 'done' | 'in_progress' | 'upcoming' | 'overdue' | 'cancelled'

export interface PlanningTimelineEvent {
  id: string
  type: PlanningEventType
  siteId: string
  siteName: string
  title: string
  /** Instant ISO, ou date civile yyyy-mm-dd quand l'heure n'est PAS connue.
   *  On ne fabrique jamais un « 08:00 » pour faire joli : une date sans heure
   *  reste une date sans heure. */
  start: string
  /** Fin si elle est connue (visite terminée, fermeture, blocage). Sinon null. */
  end: string | null
  status: PlanningEventStatus
  certainty: PlanningCertainty
  /** D'où vient le fait — pour qu'on puisse toujours remonter à la source. */
  source: string
  href: string | null
  /** Le « pourquoi » en une ligne : contrainte dite, équipe, motif. */
  detail: string | null
}

export interface PlanningRange {
  /** Date civile incluse, yyyy-mm-dd. */
  from: string
  /** Date civile incluse, yyyy-mm-dd. */
  to: string
}

export interface PlanningFilters {
  siteIds?: string[]
  teamId?: string
  types?: PlanningEventType[]
}

/** Le jour civil (Nouméa) d'un événement — la clé de regroupement des vues. */
export function eventDay(e: PlanningTimelineEvent): string {
  return e.start.slice(0, 10)
}

/** Ordre du récit : par jour, puis les événements horodatés avant ceux qui n'ont
 *  qu'une date (on ne peut pas les placer dans l'heure — on ne l'invente pas). */
export function sortTimeline(events: PlanningTimelineEvent[]): PlanningTimelineEvent[] {
  return [...events].sort((a, b) => {
    const dayDiff = eventDay(a).localeCompare(eventDay(b))
    if (dayDiff !== 0) return dayDiff
    const aTimed = a.start.length > 10
    const bTimed = b.start.length > 10
    if (aTimed !== bTimed) return aTimed ? -1 : 1
    return a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  })
}
