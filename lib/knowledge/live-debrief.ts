import 'server-only'

// ── D2 — READ-MODEL DU DÉBRIEF VIVANT ────────────────────────────────────────
// Projection unique qui peuple les six blocs du contrat D1 (debrief-contract.ts)
// depuis les objets métier réels du chantier. Zéro logique LLM, zéro statut
// propriétaire : chaque item porte le statut de son objet source, classé par les
// classifieurs D1 (purs, déjà testés).
//
// OBJECT-FIRST (règle D2 §2) : Action/Échéance/Réserve sont lues sans filtre sur
// canonical_subject_id — un objet manuel sans sujet canonique reste visible. Le
// sujet canonique n'intervient qu'en aval, pour (a) dédupliquer un signal
// informationnel déjà porté par un objet ouvert, (b) alimenter à_surveiller —
// jamais pour décider si un objet est à traiter (garde-feu D2 §3).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  classifyActionForDebrief,
  classifyDeadlineForDebrief,
  classifyReserveForDebrief,
  classifyInformationalSignalForDebrief,
  debriefBlockForDisposition,
  type DebriefDisposition,
  type DebriefSignalAck,
} from '@/lib/knowledge/debrief-contract'
import { getSiteOverview } from '@/lib/knowledge/site-overview'
import { buildSinceLastVisitDelta, getSiteRecentActivity, type SinceLastVisitDelta, type SiteActivityItem } from '@/lib/db/visits'
import { deriveCanonicalAttentionItems, type CanonicalAttentionItem, type CanonicalSignal } from '@/lib/knowledge/canonical-attention'
import { markAttentionSignalSeen, getAttentionSignalAcks } from '@/lib/db/attention-signal-acknowledgements'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

const RECENT_ACTIVITY_LIMIT = 6

// ── Items ─────────────────────────────────────────────────────────────────────

export type LiveDebriefObjectKind = 'action' | 'deadline' | 'reserve'

/** Un item adossé à un objet métier réel — jamais de statut Débrief propriétaire :
 *  `status` est le vocabulaire natif de l'objet (site_actions/site_deadlines/site_reserve). */
export interface LiveDebriefObjectItem {
  kind: LiveDebriefObjectKind
  id: string
  title: string
  status: string
  disposition: DebriefDisposition
  /** Date pertinente pour la disposition actuelle : échéance/prévu si actif, date de
   *  transition terminale fiable si `recently_handled`. Jamais `updated_at`. */
  date: string | null
  canonicalSubjectId: string | null
  reportId: string | null
  href: string
}

/** Un signal informationnel canonical (trajectoire PV) sans objet métier ouvert
 *  qui le représente déjà — cf. dédup §5/§3. */
export interface LiveDebriefInformationalItem {
  kind: 'informational_signal'
  canonicalSubjectId: string
  /** Identité stable (D3 §2) — cf. `buildDebriefSignalKey`. Seule clé valide pour `markLiveDebriefSignalSeen`. */
  signalKey: string
  title: string
  disposition: DebriefDisposition
  ack: DebriefSignalAck
  reasons: string[]
  href: string
}

export type LiveDebriefItem = LiveDebriefObjectItem | LiveDebriefInformationalItem

// ── Blocs ─────────────────────────────────────────────────────────────────────

export interface LiveDebriefConfirmedToday {
  actionsActive: number
  actionsOverdue: number
  deadlinesToPlan: number
  deadlinesPlanned: number
  reservesOpen: number
  nextEvent: { title: string; startsAt: string; href: string | null } | null
}

export interface LiveDebriefFirstVisit {
  kind: 'first_visit'
}

export interface LiveDebriefSinceLastVisitDelta extends SinceLastVisitDelta {
  kind: 'delta'
}

/** Aucune visite terrain terminée n'existe encore sur ce chantier : `first_visit`
 *  explicite (D2 §7) plutôt qu'un diff vide qui laisserait croire que rien ne
 *  s'est passé. Distinct de `personal=false` (l'utilisateur n'a pas de visite
 *  personnelle, mais le CHANTIER en a une — le delta du site reste alors montré). */
export type LiveDebriefSinceLastVisit = LiveDebriefFirstVisit | LiveDebriefSinceLastVisitDelta

export interface LiveDebrief {
  siteId: string
  confirmedToday: LiveDebriefConfirmedToday
  sinceLastVisit: LiveDebriefSinceLastVisit
  toHandle: LiveDebriefItem[]
  toWatch: LiveDebriefItem[]
  recentlyHandled: LiveDebriefItem[]
  /** Pass-through de `getSiteRecentActivity` (lib/db/visits.ts) — non
   *  dédupliqué en amont (D3 §10, tracé pour D6) : cette fonction fusionne
   *  `site_reports` et `interventions` par de simples `push` sans détection
   *  de même événement réel (lib/db/visits.ts:1057-1068). Un report et une
   *  intervention datés du même jour pour le même passage terrain peuvent
   *  donc apparaître deux fois. Ne pas corriger ici : source hors périmètre
   *  D3, correction à faire dans `getSiteRecentActivity` lui-même. */
  recentActivity: SiteActivityItem[]
}

// ── Lecture brute des objets métier ──────────────────────────────────────────
// Sélection directe (convention repo, cf. canonical-business-object-attach.ts) :
// les helpers typés existants (listSiteActionsBySite/listSiteDeadlines/
// getSiteReserves) n'exposent pas tous `canonical_subject_id` dans leur type,
// ou filtrent par statut — D2 a besoin de TOUS les statuts + cette colonne en un
// seul aller-retour par table.

export interface RawActionRow {
  id: string
  title: string
  status: 'open' | 'planned' | 'done' | 'cancelled'
  due_date: string | null
  done_at: string | null
  canonical_subject_id: string | null
  report_id: string | null
}

export interface RawDeadlineRow {
  id: string
  title: string
  status: 'to_plan' | 'planned' | 'done' | 'cancelled' | 'superseded'
  due_date: string | null
  completed_at: string | null
  cancelled_at: string | null
  canonical_subject_id: string | null
  report_id: string | null
}

export interface RawReserveRow {
  id: string
  label: string
  status: 'open' | 'lifted'
  issued_on: string | null
  lifted_at: string | null
  canonical_subject_id: string | null
  report_id: string | null
}

async function fetchLiveObjects(siteId: string): Promise<{
  actions: RawActionRow[]
  deadlines: RawDeadlineRow[]
  reserves: RawReserveRow[]
}> {
  const sb = createAdminClient()
  const [actionsRes, deadlinesRes, reservesRes] = await Promise.all([
    sb.from('site_actions')
      .select('id, title, status, due_date, done_at, canonical_subject_id, report_id')
      .eq('site_id', siteId),
    sb.from('site_deadlines')
      .select('id, title, status, due_date, completed_at, cancelled_at, canonical_subject_id, report_id')
      .eq('site_id', siteId)
      .is('deleted_at', null),
    sb.from('site_reserve')
      .select('id, label, status, issued_on, lifted_at, canonical_subject_id, report_id')
      .eq('site_id', siteId),
  ])
  return {
    actions: (actionsRes.data ?? []) as RawActionRow[],
    deadlines: (deadlinesRes.data ?? []) as RawDeadlineRow[],
    reserves: (reservesRes.data ?? []) as RawReserveRow[],
  }
}

// ── Classification objet → item ──────────────────────────────────────────────

export function actionToItem(row: RawActionRow, today: string, siteId: string): LiveDebriefObjectItem {
  const c = classifyActionForDebrief({ status: row.status, doneAt: row.done_at }, today)
  return {
    kind: 'action',
    id: row.id,
    title: row.title,
    status: row.status,
    disposition: c.disposition,
    date: c.disposition === 'recently_handled' ? row.done_at : row.due_date,
    canonicalSubjectId: row.canonical_subject_id,
    reportId: row.report_id,
    href: `/sites/${siteId}/action/${row.id}`,
  }
}

export function deadlineToItem(row: RawDeadlineRow, today: string, siteId: string): LiveDebriefObjectItem {
  const resolvedAt = row.completed_at ?? row.cancelled_at
  const c = classifyDeadlineForDebrief({ status: row.status, resolvedAt }, today)
  return {
    kind: 'deadline',
    id: row.id,
    title: row.title,
    status: row.status,
    disposition: c.disposition,
    date: c.disposition === 'recently_handled' ? resolvedAt : row.due_date,
    canonicalSubjectId: row.canonical_subject_id,
    reportId: row.report_id,
    // Pas de route par item pour une échéance (contrairement à Action/Réserve) :
    // même destination que DeadlineHistoryItem.tsx (onglet Planning → sous-onglet Échéances).
    href: `/sites/${siteId}?tab=planning&plantab=echeances`,
  }
}

export function reserveToItem(row: RawReserveRow, today: string, siteId: string): LiveDebriefObjectItem {
  const c = classifyReserveForDebrief({ status: row.status, liftedAt: row.lifted_at }, today)
  return {
    kind: 'reserve',
    id: row.id,
    title: row.label,
    status: row.status,
    disposition: c.disposition,
    date: c.disposition === 'recently_handled' ? row.lifted_at : row.issued_on,
    canonicalSubjectId: row.canonical_subject_id,
    reportId: row.report_id,
    href: `/sites/${siteId}/reserve/${row.id}`,
  }
}

// ── Signaux informationnels (canonical, sans objet métier propre) ───────────
// `action_overdue`/`deadline_near` sont des signaux PUREMENT opérationnels déjà
// représentés 1:1 par un item Action/Échéance ci-dessus — les remonter aussi ici
// dupliquerait l'attention (D2 §5). Un item n'est exclu que si TOUS ses signaux
// sont de cette famille ; un signal de trajectoire PV (stagnation, aggravation…)
// reste admissible même combiné à un signal opérationnel.
const PURELY_OPERATIONAL_SIGNALS = new Set<CanonicalSignal>(['action_overdue', 'deadline_near'])

function isPurelyOperational(item: CanonicalAttentionItem): boolean {
  return item.signals.length > 0 && item.signals.every((s) => PURELY_OPERATIONAL_SIGNALS.has(s))
}

/**
 * Identité stable d'un signal informationnel (D3 §2). `canonicalSubjectId` seul
 * ne suffit pas : un sujet déjà vu peut recevoir un développement matériellement
 * nouveau (ex. `stagnant` devient `stagnant` + `pv_aggrave`) — ce cas doit
 * ressurgir comme non-vu plutôt que rester silencieusement acquitté. La clé
 * combine donc le sujet et l'ensemble trié de ses signaux ; jamais le texte
 * généré (`title`/`reasons`), qui peut varier sans changement de fond.
 */
export function buildDebriefSignalKey(item: Pick<CanonicalAttentionItem, 'canonicalSubjectId' | 'signals'>): string {
  const sortedSignals = [...item.signals].sort()
  return `${item.canonicalSubjectId}:${sortedSignals.join(',')}`
}

/**
 * `seenSignalKeys` : clés déjà acquittées par CET utilisateur sur CE chantier
 * (D3 §1/§3, `getAttentionSignalAcks`). Un signal dont l'ensemble de signaux
 * change matériellement produit une nouvelle clé (D3 §2) et redevient donc
 * `unseen` même si l'ancienne version avait été vue.
 */
export function informationalItems(
  canonicalItems: CanonicalAttentionItem[],
  openCanonicalSubjectIds: Set<string>,
  seenSignalKeys: Set<string> = new Set(),
): LiveDebriefInformationalItem[] {
  const items: LiveDebriefInformationalItem[] = []
  for (const item of canonicalItems) {
    if (isPurelyOperational(item)) continue
    const hasOpenLinkedObject = openCanonicalSubjectIds.has(item.canonicalSubjectId)
    const signalKey = buildDebriefSignalKey(item)
    const ack: DebriefSignalAck = seenSignalKeys.has(signalKey) ? 'seen' : 'unseen'
    const c = classifyInformationalSignalForDebrief({ hasOpenLinkedObject, ack })
    if (c.disposition === 'not_relevant') continue
    items.push({
      kind: 'informational_signal',
      canonicalSubjectId: item.canonicalSubjectId,
      signalKey,
      title: item.title,
      disposition: c.disposition,
      ack: c.ack,
      reasons: item.reasons,
      href: item.href,
    })
  }
  return items
}

/**
 * Le SEUL point d'entrée pour persister « Vu » sur un signal informationnel du
 * Débrief vivant (D3 §3). Type-locked comme `markSeen` (D1, debrief-contract.ts) :
 * le paramètre est typé exclusivement en `LiveDebriefInformationalItem` — passer
 * un item Action/Échéance/Réserve/Planning est un échec de compilation, pas une
 * règle conventionnelle. Idempotent (upsert), scoped site+user (org dérivé du
 * site, mig 373). Ne modifie jamais canonical_subject ni un objet métier —
 * invalide seulement la projection pour que `buildLiveDebrief` relise l'état à
 * jour au prochain rendu (doctrine « c'est la mutation qui invalide »).
 */
export async function markLiveDebriefSignalSeen(
  item: LiveDebriefInformationalItem,
  siteId: string,
  userId: string,
): Promise<void> {
  await markAttentionSignalSeen({ siteId, userId, signalKey: item.signalKey })
  invalidateSiteProjection(siteId)
}

function place(item: LiveDebriefItem, toHandle: LiveDebriefItem[], toWatch: LiveDebriefItem[], recentlyHandled: LiveDebriefItem[]): void {
  const block = debriefBlockForDisposition(item.disposition)
  if (block === 'to_handle') toHandle.push(item)
  else if (block === 'to_watch') toWatch.push(item)
  else if (block === 'recently_handled') recentlyHandled.push(item)
}

// ── Primitive publique ────────────────────────────────────────────────────────

/**
 * Projection live du Débrief (D2). Compose des read-models existants — aucun accès
 * DB nouveau hors `fetchLiveObjects` (Action/Échéance/Réserve, nécessaire pour avoir
 * TOUS les statuts + `canonical_subject_id` en un aller-retour, cf. commentaire
 * `fetchLiveObjects`). Ne mute jamais rien, ne throw jamais (chaque source a son repli).
 */
export async function buildLiveDebrief(siteId: string, userId: string | null = null): Promise<LiveDebrief> {
  const today = new Date().toISOString().slice(0, 10)

  const [{ actions, deadlines, reserves }, overview, sinceDelta, recentActivity, canonicalItems, seenSignalKeys] = await Promise.all([
    fetchLiveObjects(siteId).catch(() => ({ actions: [] as RawActionRow[], deadlines: [] as RawDeadlineRow[], reserves: [] as RawReserveRow[] })),
    getSiteOverview(siteId),
    buildSinceLastVisitDelta(siteId, userId).catch(() => null),
    getSiteRecentActivity(siteId, RECENT_ACTIVITY_LIMIT).catch(() => [] as SiteActivityItem[]),
    deriveCanonicalAttentionItems(siteId).catch(() => [] as CanonicalAttentionItem[]),
    userId ? getAttentionSignalAcks(siteId, userId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ])

  // confirmed_today : mêmes compteurs que l'Aperçu (getSiteOverview), jamais une
  // deuxième définition (D2 §8).
  const confirmedToday: LiveDebriefConfirmedToday = {
    actionsActive: overview.actions.summary.active,
    actionsOverdue: overview.actions.summary.overdue,
    deadlinesToPlan: overview.deadlineCounts.toPlan,
    deadlinesPlanned: overview.deadlineCounts.planned,
    reservesOpen: overview.reserves.open,
    nextEvent: overview.nextEvent
      ? { title: overview.nextEvent.title, startsAt: overview.nextEvent.startsAt, href: overview.nextEvent.href }
      : null,
  }

  const sinceLastVisit: LiveDebriefSinceLastVisit = sinceDelta
    ? { kind: 'delta', ...sinceDelta }
    : { kind: 'first_visit' }

  const openCanonicalSubjectIds = new Set<string>()
  for (const a of actions) {
    if ((a.status === 'open' || a.status === 'planned') && a.canonical_subject_id) openCanonicalSubjectIds.add(a.canonical_subject_id)
  }
  for (const d of deadlines) {
    if ((d.status === 'to_plan' || d.status === 'planned') && d.canonical_subject_id) openCanonicalSubjectIds.add(d.canonical_subject_id)
  }
  for (const r of reserves) {
    if (r.status === 'open' && r.canonical_subject_id) openCanonicalSubjectIds.add(r.canonical_subject_id)
  }

  const toHandle: LiveDebriefItem[] = []
  const toWatch: LiveDebriefItem[] = []
  const recentlyHandled: LiveDebriefItem[] = []

  for (const row of actions) place(actionToItem(row, today, siteId), toHandle, toWatch, recentlyHandled)
  for (const row of deadlines) place(deadlineToItem(row, today, siteId), toHandle, toWatch, recentlyHandled)
  for (const row of reserves) place(reserveToItem(row, today, siteId), toHandle, toWatch, recentlyHandled)
  for (const item of informationalItems(canonicalItems, openCanonicalSubjectIds, seenSignalKeys)) place(item, toHandle, toWatch, recentlyHandled)

  return {
    siteId,
    confirmedToday,
    sinceLastVisit,
    toHandle,
    toWatch,
    recentlyHandled,
    recentActivity,
  }
}
