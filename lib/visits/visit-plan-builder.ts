// Plan de visite — transformation des signaux d'attention en CONTRÔLES TERRAIN.
//
// Doctrine (Vincent, 2026-08-15) : seuil d'attention ≠ critère de contrôle terrain.
//   — le moteur d'attention répond « qu'est-ce qui mérite mon attention ? » ;
//   — le plan de visite répond « qu'est-ce qu'il est utile de CONSTATER
//     physiquement lors de mon prochain passage ? ».
//
// Ce module ne recalcule rien et n'interroge pas la base : il PROJETTE des items
// déjà calculés par `deriveSiteAttentionItems` dans une hiérarchie propre à la
// visite. C'est volontairement un module pur — pas un second moteur.
//
// Il existe parce que la recette PETRO a montré la limite du passage direct :
// cinq recommandations plates, toutes `low`, toutes portant la même raison
// « Évolution depuis votre dernière visite ». Le LLM ne peut pas inventer une
// hiérarchie métier qu'on ne lui fournit pas — le gain doit venir du contexte
// structuré, pas du prompt.
//
// Invariant : chaque contrôle doit pouvoir répondre « pourquoi celui-là est dans
// ma visite ? » avec une raison qui lui est propre.

import type { SiteAttentionItem, AttentionSignal, AttentionUrgency } from '@/lib/knowledge/site-attention-items'
import { frDayMonthYearLocal, localDateOf } from '@/lib/time/local-date'

/** Même journée civile en zone chantier — pas le même instant. */
function sameLocalDay(a: string, b: string): boolean {
  try {
    return localDateOf(new Date(a)) === localDateOf(new Date(b))
  } catch {
    return false
  }
}

/**
 * Hiérarchie de visite, dans l'ordre de parcours d'un conducteur de travaux.
 * L'ordre des membres EST l'ordre de tri — ne pas réordonner sans intention.
 */
export type VisitControlTier =
  | 'safety_open'        // 1. sécurité / anomalie physique ouverte
  | 'changed_since'      // 2. sujet modifié depuis la dernière visite
  | 'recurring_unsolved' // 3. problème récurrent non résolu
  | 'commitment_check'   // 4. action ou engagement vérifiable physiquement
  | 'other'              // 5. autres sujets pertinents

const TIER_ORDER: VisitControlTier[] = [
  'safety_open', 'changed_since', 'recurring_unsolved', 'commitment_check', 'other',
]

/** Libellé de la famille, transmis au LLM pour qu'il annonce la hiérarchie. */
const TIER_LABEL: Record<VisitControlTier, string> = {
  safety_open:        'Sécurité / anomalie ouverte',
  changed_since:      'Modifié depuis votre dernière visite',
  recurring_unsolved: 'Problème récurrent non résolu',
  commitment_check:   'Engagement à vérifier sur place',
  other:              'Autre point pertinent',
}

/** Un contrôle terrain : quoi vérifier, pourquoi, dernier état connu, changement. */
export interface VisitControl {
  /** Le sujet ou l'objet concerné. Jamais une phrase. */
  label: string
  /** Ce qu'il faut CONSTATER sur place. Impératif, une phrase. */
  check: string
  /** Pourquoi ce point figure dans cette visite — propre à l'item, jamais générique. */
  why: string
  /** Dernier état connu par MemorIA, `null` si le moteur ne le sait pas. */
  lastKnown: string | null
  /** Ce qui a changé (ou non) depuis la dernière visite terrain. */
  changeSinceLastVisit: string | null
  tier: VisitControlTier
  /** Libellé lisible de la famille — évite au LLM de traduire un enum. */
  tierLabel: string
  priority: AttentionUrgency | string
  signals: string[]
}

// ── Classement par famille ────────────────────────────────────────────────────

function tierOf(signal: AttentionSignal): VisitControlTier {
  switch (signal) {
    // Une réserve non levée, une non-conformité PV, un blocage déclaré sont des
    // anomalies PHYSIQUES : elles se constatent au sol, pas dans l'application.
    case 'blocage_active':
    case 'reserve_open':
    case 'pv_status':
      return 'safety_open'
    case 'subject_changed':
      return 'changed_since'
    // Récurrence = le sujet revient sans que rien ne bouge. `relation_blocking`
    // en fait partie : c'est un sujet stagnant qui, en plus, en bloque un autre.
    case 'subject_stagnant':
    case 'pv_stagnant':
    case 'relation_blocking':
      return 'recurring_unsolved'
    case 'action_overdue':
    case 'action_to_verify':
    case 'deadline_near':
    case 'deadline_overdue':
      return 'commitment_check'
    default:
      return 'other'
  }
}

/** Base du « quoi constater », dérivée de la nature du signal. */
function baseCheckOf(signal: AttentionSignal): string {
  switch (signal) {
    case 'blocage_active':
      return 'Constater sur place si le blocage est levé ; sinon relever ce qui l’entretient.'
    case 'reserve_open':
      return 'Constater si la réserve est levée ; photographier l’état si ce n’est pas le cas.'
    case 'pv_status':
      return 'Constater si l’anomalie relevée au dernier PV est corrigée sur le terrain.'
    case 'subject_changed':
      return 'Constater l’état réel après l’évolution enregistrée, et confirmer qu’elle est conforme.'
    case 'subject_stagnant':
    case 'pv_stagnant':
      return 'Constater si quelque chose a physiquement bougé, et identifier ce qui bloque.'
    case 'relation_blocking':
      return 'Constater l’avancement : tant qu’il n’avance pas, il en bloque un autre.'
    case 'action_overdue':
      return 'Vérifier sur place si l’action a réellement été réalisée.'
    case 'action_to_verify':
      return 'Vérifier où en est réellement l’action : son échéance n’est pas confirmée.'
    case 'deadline_near':
    case 'deadline_overdue':
      return 'Vérifier au vu de l’avancement constaté si l’échéance reste tenable.'
    default:
      return 'Faire un point d’état sur place.'
  }
}

/**
 * Quoi constater sur place, complété par ce que MemorIA sait de CE sujet.
 *
 * Le signal seul ne suffit pas : sur un chantier suivi en visites terrain, tous
 * les points peuvent porter le même signal (`subject_changed` sur PETRO), et la
 * check-list redevient cinq fois la même phrase. Les objets encore ouverts et la
 * répétition sans changement sont les seuls discriminants disponibles sans
 * nouvelle requête — ce sont aussi ceux qui disent réellement quoi regarder.
 */
function checkOf(item: SiteAttentionItem): string {
  const parts = [baseCheckOf(item.signal)]
  const active = readActiveObjects(item.metadata)

  if (active && active.actionsOpen > 0) {
    parts.push(`Point de contrôle : ${plural(active.actionsOpen, 'action encore ouverte', 'actions encore ouvertes')} sur ce sujet — dire lesquelles sont réellement faites.`)
  }
  if (active && active.reservesOpen > 0) {
    parts.push(`${plural(active.reservesOpen, 'réserve non levée', 'réserves non levées')} : constater l’état et photographier.`)
  }
  if (active && active.deadlinesActive > 0) {
    parts.push(`${plural(active.deadlinesActive, 'échéance active', 'échéances actives')} : confirmer la tenue au vu de l’avancement.`)
  }

  const mentions = item.metadata?.consecutiveMentionsWithoutChange
  if (typeof mentions === 'number' && mentions >= 2 && item.signal !== 'subject_stagnant') {
    parts.push('Le sujet revient sans que son état change : chercher ce qui l’empêche d’avancer.')
  }
  return parts.join(' ')
}

// ── Dernier état connu ────────────────────────────────────────────────────────

const STATUS_FR: Record<string, string> = {
  open: 'ouvert',
  in_progress: 'en cours',
  still_open: 'toujours ouvert',
  non_compliant: 'non conforme',
  planned: 'planifié',
  awaiting_validation: 'en attente de validation',
  field_checked: 'vérifié sur le terrain',
  done: 'clôturé',
  cancelled: 'annulé',
  not_applicable: 'sans objet',
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}

interface ActiveObjects {
  actionsOpen: number
  reservesOpen: number
  deadlinesActive: number
  decisionsOpen: number
  total: number
}

function readActiveObjects(meta: Record<string, unknown> | undefined): ActiveObjects | null {
  const raw = meta?.activeObjects
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<ActiveObjects>
  if (typeof o.total !== 'number') return null
  return {
    actionsOpen: o.actionsOpen ?? 0,
    reservesOpen: o.reservesOpen ?? 0,
    deadlinesActive: o.deadlinesActive ?? 0,
    decisionsOpen: o.decisionsOpen ?? 0,
    total: o.total,
  }
}

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Dernier état connu : statut canonique + objets encore ouverts + dernière trace.
 * Retourne `null` plutôt qu'une phrase vide : le LLM ne doit jamais présenter
 * une absence de données comme un état.
 */
function lastKnownOf(item: SiteAttentionItem): string | null {
  const parts: string[] = []
  const status = str(item.metadata, 'currentStatus')
  if (status) parts.push(STATUS_FR[status] ?? status)

  const active = readActiveObjects(item.metadata)
  if (active) {
    if (active.actionsOpen > 0) parts.push(plural(active.actionsOpen, 'action ouverte', 'actions ouvertes'))
    if (active.reservesOpen > 0) parts.push(plural(active.reservesOpen, 'réserve ouverte', 'réserves ouvertes'))
    if (active.deadlinesActive > 0) parts.push(plural(active.deadlinesActive, 'échéance active', 'échéances actives'))
  }

  const lastSeen = str(item.metadata, 'lastSeenAt')
  if (lastSeen) parts.push(`dernière trace le ${frDayMonthYearLocal(lastSeen)}`)

  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Changement depuis la dernière visite terrain.
 *
 * L'ABSENCE de changement est une information de visite au moins aussi utile que
 * sa présence : c'est elle qui justifie d'aller voir. On la formule donc, au lieu
 * de renvoyer `null` comme si le moteur ne savait pas.
 */
function changeSinceOf(item: SiteAttentionItem): string | null {
  const lastVisitAt = str(item.metadata, 'lastVisitAt')
  if (!lastVisitAt) return null
  const changedAt = str(item.metadata, 'lastMeaningfulChangeAt')
  if (item.metadata?.changedSinceLastVisit === true && changedAt) {
    // Le moteur compare des instants ; l'utilisateur lit des jours. Une évolution
    // saisie deux heures après la visite est « postérieure » pour la machine et
    // donne « le 11 août, après votre visite du 11 août » à l'écran — absurde.
    return sameLocalDay(changedAt, lastVisitAt)
      ? `Évolution enregistrée le jour même de votre visite du ${frDayMonthYearLocal(lastVisitAt)}, probablement issue de ce passage.`
      : `Évolution enregistrée le ${frDayMonthYearLocal(changedAt)}, après votre visite du ${frDayMonthYearLocal(lastVisitAt)}.`
  }
  return `Aucune évolution enregistrée depuis votre visite du ${frDayMonthYearLocal(lastVisitAt)}.`
}

/**
 * Pourquoi ce point est dans la visite.
 *
 * Part de la raison calculée par le moteur d'attention — déjà différenciée pour
 * la plupart des règles (« Ouverte depuis 62 j », « Non-conformité signalée dans
 * le dernier PV »…) — et complète le seul cas plat : `subject_changed`, dont la
 * raison unique était le défaut constaté en recette.
 */
function whyOf(item: SiteAttentionItem): string {
  const base = item.reason?.trim() || TIER_LABEL[tierOf(item.signal)]
  if (item.signal !== 'subject_changed') return base

  const parts: string[] = []
  const changedAt = str(item.metadata, 'lastMeaningfulChangeAt')
  const lastVisitAt = str(item.metadata, 'lastVisitAt')
  if (!changedAt) {
    parts.push(base)
  } else if (lastVisitAt && sameLocalDay(changedAt, lastVisitAt)) {
    parts.push(`Modifié le jour de votre dernier passage (${frDayMonthYearLocal(changedAt)})`)
  } else {
    parts.push(`Modifié le ${frDayMonthYearLocal(changedAt)}, après votre dernier passage`)
  }

  const active = readActiveObjects(item.metadata)
  if (active && active.total > 0) {
    const open: string[] = []
    if (active.actionsOpen > 0) open.push(plural(active.actionsOpen, 'action ouverte', 'actions ouvertes'))
    if (active.reservesOpen > 0) open.push(plural(active.reservesOpen, 'réserve ouverte', 'réserves ouvertes'))
    if (open.length > 0) parts.push(`${open.join(' et ')} restante${open.length > 1 || active.total > 1 ? 's' : ''}`)
  }

  const mentions = item.metadata?.consecutiveMentionsWithoutChange
  if (typeof mentions === 'number' && mentions >= 2) {
    parts.push(`mentionné ${mentions} fois de suite sans changement d'état`)
  }
  return parts.join(' · ')
}

// ── Tri ───────────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

// ── Entrée ────────────────────────────────────────────────────────────────────

/** Sujet à vérifier issu du moteur PV (`overview.pvToVerify`). */
export interface PvToVerifyInput {
  canonicalSubjectId: string
  label: string
  signals: string[]
}

/**
 * Construit le plan de visite : hiérarchie terrain, dédupliquée par sujet canonique.
 *
 * @param attentionItems items du moteur d'attention (déjà filtrés `next_visit`)
 * @param pvToVerify     sujets à vérifier issus du moteur PV
 * @param max            nombre maximal de contrôles transmis
 */
export function buildVisitPlan(
  attentionItems: SiteAttentionItem[],
  pvToVerify: PvToVerifyInput[],
  max: number,
): VisitControl[] {
  const controls: VisitControl[] = []
  const seen = new Set<string>()

  const push = (key: string | null, control: VisitControl) => {
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    controls.push(control)
  }

  for (const item of attentionItems) {
    const csId = typeof item.metadata?.canonicalSubjectId === 'string'
      ? item.metadata.canonicalSubjectId
      : null
    const tier = tierOf(item.signal)
    push(csId, {
      label: item.title,
      check: checkOf(item),
      why: whyOf(item),
      lastKnown: lastKnownOf(item),
      changeSinceLastVisit: changeSinceOf(item),
      tier,
      tierLabel: TIER_LABEL[tier],
      priority: item.urgency,
      signals: [item.signal],
    })
  }

  // Le moteur PV ne porte ni statut ni date : ses points ferment la liste sans
  // prétendre à un dernier état connu qu'on n'a pas.
  for (const v of pvToVerify) {
    push(v.canonicalSubjectId, {
      label: v.label,
      check: baseCheckOf('pv_status'),
      why: v.signals.length > 0 ? v.signals.join(' · ') : TIER_LABEL.other,
      lastKnown: null,
      changeSinceLastVisit: null,
      tier: 'other',
      tierLabel: TIER_LABEL.other,
      priority: 'normal',
      signals: v.signals,
    })
  }

  // Tri : la hiérarchie de visite d'abord, l'urgence d'attention ensuite. C'est
  // exactement l'inversion demandée — une réserve ouverte `medium` passe devant
  // un sujet modifié `low`, parce que la question posée n'est plus « qu'est-ce
  // qui est urgent ? » mais « qu'est-ce que je vais constater sur place ? ».
  controls.sort((a, b) => {
    const t = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    if (t !== 0) return t
    return (URGENCY_RANK[a.priority] ?? 9) - (URGENCY_RANK[b.priority] ?? 9)
  })

  return controls.slice(0, max)
}
