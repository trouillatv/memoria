// ── PILOTAGE DES ACTIONS — modèle PUR (Tranche 1) ────────────────────────────
// Classification des KPIs, libellés d'échéance, filtres. Aucune dépendance
// serveur → testable en vitest. Règle : on ne raconte QUE le modèle réel
// (statuts open/planned/done/cancelled) ; aucun statut inventé, aucune priorité,
// aucune relance. « À confirmer » ne vient PAS d'ici (ce sont des propositions,
// pas des actions) — il est calculé côté serveur depuis site_knowledge_proposals.

export type ActionListStatus = 'open' | 'planned' | 'done' | 'cancelled'

/** Traduction fidèle des statuts réels — jamais « En cours ». */
export const ACTION_STATUS_LABEL: Record<ActionListStatus, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée',
}

export interface ActionOrigin {
  type: 'reunion' | 'visite' | 'reserve' | 'sujet'
  /** Prose sous le titre : « Après la visite du 17 juillet » (le contexte). */
  label: string
  /** Forme courte pour la colonne alignée : « Visite · 17/07 » (d'où ça vient). */
  short: string
  href: string | null
}

// Libellé de l'ÉCHÉANCE d'une action (retard/à-venir/clôturée) — jamais la
// ponctualité d'une personne. Nommé « due » pour rester hors du champ RH (V3).
export interface DueLabel {
  text: string | null
  tone: 'neg' | 'ok' | 'done' | null
}

export interface ActionDashboardItem {
  id: string
  siteId: string
  siteName: string
  title: string
  description: string | null
  status: ActionListStatus
  statusLabel: string
  /** La personne réelle (contact du casting) ou null — jamais une entreprise. */
  responsibleName: string | null
  responsibleSub: string | null
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  dueLabel: DueLabel
  origin: ActionOrigin | null
  /** Le fait observé qui a déclenché l'action (capture.body tronqué), ou null.
   *  Donne le récit « fait observé → engagement » directement dans la ligne. */
  observed: string | null
  lastActivity: { label: string; occurredAt: string } | null
  /** Trace de clôture présente (photo ou commentaire) — pour « Terminées sans preuve ». */
  hasClosureTrace: boolean
  /** Ouvre la fiche canonique existante (Sheet ?action=). */
  href: string
}

/** L'URL qui ouvre la fiche Action EN SURIMPRESSION sur la liste Actions
 *  (coquille persistante montée sur /actions), sans changer de page vers le
 *  chantier. `action_site` accompagne l'id pour charger la fiche (fail-closed) ;
 *  `action_source=actions` garde le × « Fermer » (on n'arrive d'aucun autre objet).
 *  Le chantier ne devient le fond que sur un clic EXPLICITE (📍 / « Voir le chantier »). */
export function actionFicheHref(actionId: string, siteId: string): string {
  return `/actions?action=${actionId}&action_site=${siteId}&action_source=actions`
}

// ── Appartenance aux KPIs (actions seulement ; « à confirmer » = propositions) ──
export const isActive = (s: ActionListStatus): boolean => s === 'open' || s === 'planned'
export const isDone = (s: ActionListStatus): boolean => s === 'done'

/** En retard = engagée, échéance EXPLICITE (confirmée) dépassée. Une échéance
 *  estimée ne compte pas (cohérent avec la fiche). */
export function isOverdue(a: Pick<ActionDashboardItem, 'status' | 'dueDate' | 'dueDateStatus'>, today: string): boolean {
  return isActive(a.status) && a.dueDate !== null && a.dueDateStatus === 'explicit' && a.dueDate < today
}

/** Terminée sans preuve = clôturée SANS trace de clôture (Slice 7). Le problème
 *  n'est pas l'absence de preuve pendant l'exécution, mais l'absence de trace AU
 *  MOMENT de la clôture. */
export function isDoneWithoutProof(a: Pick<ActionDashboardItem, 'status' | 'hasClosureTrace'>): boolean {
  return a.status === 'done' && !a.hasClosureTrace
}

function toUtcDay(d: string): number {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
/** Jours civils entre aujourd'hui et l'échéance (positif = à venir). */
export function daysUntil(today: string, due: string): number {
  return Math.round((toUtcDay(due) - toUtcDay(today)) / 86_400_000)
}

/** Libellé d'échéance : « J-3 » à venir, « +12 jours » en retard, « clôturée » si
 *  terminée. Ne dépend jamais de l'état courant reconstruit. */
export function describeDue(
  a: Pick<ActionDashboardItem, 'status' | 'dueDate'>, today: string,
): DueLabel {
  if (a.status === 'done') return { text: 'clôturée', tone: 'done' }
  if (a.status === 'cancelled' || !a.dueDate) return { text: null, tone: null }
  const d = daysUntil(today, a.dueDate)
  if (d < 0) return { text: `+${-d} jour${-d > 1 ? 's' : ''}`, tone: 'neg' }
  if (d === 0) return { text: 'aujourd’hui', tone: 'neg' }
  return { text: `J-${d}`, tone: d <= 3 ? 'neg' : 'ok' }
}

// ── Onglets + filtres (logique CENTRALISÉE, jamais dispersée dans les composants) ──
export type ActionTab = 'all' | 'active' | 'overdue' | 'done_no_proof' | 'done'

export function inTab(item: ActionDashboardItem, today: string, tab: ActionTab): boolean {
  switch (tab) {
    case 'active': return isActive(item.status)
    case 'overdue': return isOverdue(item, today)
    case 'done_no_proof': return isDoneWithoutProof(item)
    case 'done': return isDone(item.status)
    default: return item.status !== 'cancelled' // « Toutes » masque les annulées
  }
}

export interface ActionFilterState {
  search: string
  responsibleName: string | null
  originType: ActionOrigin['type'] | null
  status: ActionListStatus | null
  /** Filtre Chantier (optionnel) : lire les actions d'un seul chantier sans perdre
   *  la vue globale. La recherche trouve aussi le nom du chantier (cf. haystack). */
  siteId?: string | null
}

export function applyActionFilters(items: ActionDashboardItem[], f: ActionFilterState): ActionDashboardItem[] {
  const q = f.search.trim().toLowerCase()
  return items.filter((it) => {
    if (f.status && it.status !== f.status) return false
    if (f.siteId && it.siteId !== f.siteId) return false
    if (f.responsibleName && it.responsibleName !== f.responsibleName) return false
    if (f.originType && it.origin?.type !== f.originType) return false
    if (q) {
      const hay = `${it.title} ${it.description ?? ''} ${it.siteName} ${it.responsibleName ?? ''} ${it.origin?.label ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export interface ActionsDashboardSummary {
  /** Propositions kind='action' encore à valider (site_knowledge_proposals). */
  aConfirmer: number
  /** Contexte transverse SECONDAIRE (autres propositions à examiner). */
  proposalBreakdown: { deadline: number; decision: number; knowledge: number; stakeholder: number; vigilance: number }
  actives: number
  activesBreakdown: { open: number; planned: number }
  enRetard: number
  termineesSansPreuve: number
  terminees: number
  /** Total affiché dans la liste (hors annulées). */
  total: number
}

/** Résumé calculé PUREMENT depuis la liste (les propositions sont injectées à part). */
export function summarizeActions(
  items: ActionDashboardItem[], today: string,
  proposals: { aConfirmer: number; breakdown: ActionsDashboardSummary['proposalBreakdown'] },
): ActionsDashboardSummary {
  let open = 0, planned = 0, enRetard = 0, terminees = 0, sansPreuve = 0, total = 0
  for (const it of items) {
    if (it.status === 'cancelled') continue
    total++
    if (it.status === 'open') open++
    if (it.status === 'planned') planned++
    if (isOverdue(it, today)) enRetard++
    if (it.status === 'done') { terminees++; if (!it.hasClosureTrace) sansPreuve++ }
  }
  return {
    aConfirmer: proposals.aConfirmer,
    proposalBreakdown: proposals.breakdown,
    actives: open + planned,
    activesBreakdown: { open, planned },
    enRetard,
    termineesSansPreuve: sansPreuve,
    terminees,
    total,
  }
}
