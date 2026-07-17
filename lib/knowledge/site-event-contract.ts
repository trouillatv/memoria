// ── LE CONTRAT CANONIQUE DE LECTURE ──────────────────────────────────────────
// Un chantier a une histoire, et cette histoire est faite d'ÉVÉNEMENTS. La Frise,
// le Dashboard, l'Accueil, le Planning et le PDF n'en sont que des points de vue.
// Ce contrat est ce qu'ils lisent tous — pour qu'un nouveau type d'événement
// apparaisse partout sans retoucher un écran, et qu'aucun écran ne contredise
// l'autre.
//
// Il est orienté LECTURE. Il ne remplace AUCUN modèle métier : une intervention
// garde son cycle (équipe, horaires, preuves, facturation) et se PROJETTE ici.
// Voir la frontière de site_scheduled_events (mig 216) : ce contrat lit tout,
// cette table ne porte que le futur sans objet spécialisé.
//
// Pas de `server-only` : le contrat et ses helpers sont PURS et doivent pouvoir
// être testés, et calculés côté client.

export type SiteEventType =
  | 'visit' | 'meeting' | 'inspection' | 'delivery'
  | 'intervention' | 'deadline' | 'action' | 'decision'
  | 'knowledge' | 'closure' | 'blockage' | 'rotation'

export type SiteEventCategory = 'operational' | 'calendar' | 'decision' | 'knowledge'

/** Ce qui FAIT FOI vs ce que MemorIA propose. La frontière que le produit défend. */
export type SiteEventCertainty = 'confirmed' | 'proposed'

export type SiteEventStatus =
  | 'planned' | 'postponed' | 'in_progress' | 'completed' | 'cancelled'
  | 'open' | 'done' | 'unknown'

export interface SiteEventActor {
  id: string
  name: string
}

export interface SiteEventSource {
  type:
    | 'scheduled_event' | 'site_report' | 'intervention' | 'site_deadline'
    | 'site_action' | 'site_decision' | 'knowledge_proposal'
    | 'site_closure' | 'site_blockage' | 'planning_cycle'
  id: string
}

/**
 * Un fait du chantier, quelle que soit sa table d'origine.
 *
 * `phase` N'EST PAS UN CHAMP — et ne doit jamais le devenir. C'est le seul
 * attribut qui dépend de l'heure de LECTURE : une échéance « future » devient
 * « passée » sans que rien ne change dans le système. Stockée, mise en cache, ou
 * figée dans un PDF, elle mentirait quelques heures plus tard — silencieusement,
 * exactement comme les points de vigilance perdus par un mot mal orthographié.
 * Elle se calcule à la volée : `phaseOfSiteEvent(event)`.
 */
export interface SiteEvent {
  id: string
  siteId: string
  type: SiteEventType
  category: SiteEventCategory

  title: string
  summary: string | null

  /** Quand c'est ARRIVÉ. Null tant que ce n'est pas arrivé. */
  occurredAt: string | null
  /** Quand c'est PRÉVU. Null si ce n'est pas un rendez-vous. */
  scheduledStart: string | null
  scheduledEnd: string | null

  status: SiteEventStatus
  certainty: SiteEventCertainty

  /** QUI a posé un acte engageant. Null pour tout le reste — nommer qui est
   *  passé et combien de temps serait du pointage, pas de la traçabilité.
   *  (Cf. refus-erp-rh-pointage-gps.) */
  actor: SiteEventActor | null
  source: SiteEventSource

  href: string | null
  metadata: Record<string, unknown>
}

export type SiteEventPhase = 'past' | 'current' | 'future' | 'undated'

/**
 * Où en est un événement PAR RAPPORT À MAINTENANT — calculé, jamais stocké.
 *
 * `undated` n'est pas un échec : une échéance « avant le démarrage » n'a pas de
 * date, et lui en inventer une serait décider à la place du conducteur. Elle
 * attend une date, elle n'est ni passée ni future.
 *
 * `now` est un paramètre pour que la règle soit testable sans dépendre de
 * l'horloge — et pour que l'appelant puisse raisonner sur la journée du
 * conducteur (Nouméa), jamais sur celle du serveur (Vercel tourne en UTC).
 */
export function phaseOfSiteEvent(event: SiteEvent, now: Date = new Date()): SiteEventPhase {
  const startIso = event.scheduledStart ?? event.occurredAt
  if (!startIso) return 'undated'

  const start = Date.parse(startIso)
  if (!Number.isFinite(start)) return 'undated'

  // Sans fin connue, l'événement est ponctuel : il finit quand il commence. On
  // n'invente pas une durée. (Cf. deduire-avant-de-demander.)
  const endIso = event.scheduledEnd
  const parsedEnd = endIso ? Date.parse(endIso) : start
  const end = Number.isFinite(parsedEnd) ? parsedEnd : start
  const current = now.getTime()

  if (current < start) return 'future'
  if (current > end) return 'past'
  return 'current'
}

/**
 * L'ÂGE d'une proposition dit qu'il faut la RÉEXAMINER — jamais qu'elle est morte.
 *
 * « Transmettre le plan avant démarrage » reste pertinente trois mois si le
 * démarrage n'a pas eu lieu. Une péremption automatique effacerait la seule
 * chose qui comptait. Le temps SIGNALE, il n'annule pas : c'est la différence
 * entre attirer l'attention et décider à la place de l'humain.
 *
 * `stale` ne veut donc pas dire « obsolète » : `superseded` (une relecture ne le
 * dit plus) est le SEUL verdict d'obsolescence, et il est porté par le statut.
 */
export type ProposalFreshness = 'new' | 'pending' | 'stale'

const NEW_DAYS = 7
const STALE_DAYS = 30

export function freshnessOf(createdAt: string, now: Date = new Date()): ProposalFreshness {
  const at = Date.parse(createdAt)
  if (!Number.isFinite(at)) return 'pending'
  const days = (now.getTime() - at) / 86_400_000
  if (days < NEW_DAYS) return 'new'
  if (days < STALE_DAYS) return 'pending'
  return 'stale'
}
