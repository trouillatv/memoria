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
import { deriveCanonicalAttentionItems, type CanonicalAttentionItem, type CanonicalSignal, type AttentionCategory } from '@/lib/knowledge/canonical-attention'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { loadCboReducedStates } from '@/lib/knowledge/canonical-business-object-evolution'
import { isActiveCboState } from '@/lib/knowledge/cbo-lifecycle-reducer'
import { markAttentionSignalSeen, getAttentionSignalAcks } from '@/lib/db/attention-signal-acknowledgements'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import type { ToHandleRank } from './to-handle-ranking'

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
  /** Date d'ouverture de l'objet (14A) — `created_at` pour une action, `issued_on`
   *  pour une réserve, `null` pour une échéance. Sert au classement « ancienneté »
   *  quand aucune échéance n'existe. Jamais une date métier de PV. */
  openedAt?: string | null
  canonicalSubjectId: string | null
  reportId: string | null
  href: string
  /** Description longue — projetée uniquement pour kind==='action' (formulaire Modifier). */
  body?: string | null
  /** Classement déterministe « À traiter » (14A). Présent UNIQUEMENT sur les items
   *  passés par `rankLiveDebriefToHandle` (desktop). Absent côté mobile. */
  rank?: ToHandleRank
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
  /** Classement déterministe « À traiter » (14A). Cf. `LiveDebriefObjectItem.rank`. */
  rank?: ToHandleRank
}

export type LiveDebriefItem = LiveDebriefObjectItem | LiveDebriefInformationalItem

// Classement déterministe « À traiter » (14A) — moteur pur extrait dans
// `to-handle-ranking.ts` (importable hors server-only). Ré-exporté ici pour
// conserver l'API historique de ce module.
export { rankLiveDebriefToHandle } from './to-handle-ranking'
export type { ToHandlePriority, ToHandleRank } from './to-handle-ranking'

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
  /** Sujets canoniques portant un signal `pv_reopened` (14A) — dérivé des items
   *  d'attention déjà calculés, sans requête neuve. Sert au classement desktop
   *  « À traiter » (`rankLiveDebriefToHandle`). Le mobile l'ignore. */
  reopenedSubjectIds: string[]
  /** WOW-1 — registres de pilotage au niveau SUJET, projetés depuis P2-2 `category` + P0-2
   *  `displayState`. Vérité de composition du Débrief reconnecté ; les blocs objets ci-dessus
   *  deviennent le détail/preuve. ADDITIF (les blocs objets restent peuplés pour compat). */
  registers: DebriefRegisterItem[]
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
  created_at?: string | null
  canonical_subject_id: string | null
  report_id: string | null
  body?: string | null
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
      .select('id, title, status, due_date, done_at, created_at, canonical_subject_id, report_id, body')
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
    openedAt: row.created_at ?? null,
    canonicalSubjectId: row.canonical_subject_id,
    reportId: row.report_id,
    href: `/sites/${siteId}/action/${row.id}`,
    body: row.body ?? null,
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
    // Une échéance n'a pas de date d'ouverture distincte de son échéance — le
    // classement « ancienneté » ne s'applique donc pas à elle (elle est datée).
    openedAt: null,
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
    openedAt: row.issued_on,
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
export function buildDebriefSignalKey(
  item: Pick<CanonicalAttentionItem, 'canonicalSubjectId' | 'signals'>,
  episodeAnchor?: string | null,
): string {
  const sortedSignals = [...item.signals].sort()
  const base = `${item.canonicalSubjectId}:${sortedSignals.join(',')}`
  // WOW-1 D2 — le silence documentaire est un ÉPISODE : deux silences séparés par une réapparition
  // sont deux informations distinctes, même si l'ensemble de signaux redevient identique. On ancre donc
  // la clé sur la dernière mention business (`lastSeenAt`) — déterministe, chronologie métier, jamais
  // created_at. Silence prolongé (pvSinceLastMention 2→3→4) = même ancre = même clé = reste acquitté.
  // Réapparition → `lastSeenAt` avance → nouvelle ancre → nouvel épisode → ré-émerge non-vu.
  return episodeAnchor ? `${base}:${episodeAnchor}` : base
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

// ── WOW-1 — Registres de pilotage (projection, JAMAIS un 4e moteur) ─────────────
// Le Débrief compose des vérités DÉJÀ calculées : P2-2 `category` = pourquoi le sujet mérite
// l'attention ; P0-2 `displayState` = état courant (dont `reopened`) ; C2A/C2D alimentent déjà ces
// projections en amont. Un item = un SUJET (l'inflation de formulations documentaires — RUS Sprinkler
// 35 site_actions — est déjà repliée par `deriveCanonicalAttentionItems`, qui itère les sujets). Les
// objets bruts restent le détail/preuve (blocs objets existants), jamais le compteur principal.

export type DebriefRegister = AttentionCategory // act_now | watch | dormant | documentary_silence

export interface DebriefRegisterItem {
  canonicalSubjectId: string
  title: string
  register: DebriefRegister
  category: AttentionCategory
  /** P0-2 displayState surfacé tel quel (annotation narrative « Réouvert »), jamais recalculé. */
  reopened: boolean
  /** Clé ACK — épisode pour le silence (`csId:signals:lastSeenAt`), sinon `csId:signals`. */
  signalKey: string
  ack: DebriefSignalAck
  pvSinceLastMention: number
  lastSeenAt: string | null
  reasons: string[]
  href: string
  /** WOW-1 — « À piloter » : objets DURABLES (CBO C2A) du sujet, PAS les formulations documentaires
   *  (arbitrage : Sprinkler 36 formulations → CBO durables). État = `computedCurrentState` C2A pris tel
   *  quel (jamais recalculé) ; seuls les CBO ACTIFS (isActiveCboState) sont « à piloter » — unknown /
   *  terminal ne sont pas transformés en actif. Le geste vit sur la fiche (aucun geste CBO inline). */
  durableObjects: DebriefDurableObject[]
  /** WOW-1 — objets 1:1 réellement actionnables INLINE (réserves/échéances ouvertes, non inflatées) :
   *  ils conservent leurs gestes existants (lever / dater). Les actions ne sont JAMAIS ici (→ CBO). */
  inlineObjects: LiveDebriefObjectItem[]
}

/** Un CBO durable « à piloter » projeté depuis C2A (lecture seule dans le Débrief ; agir = fiche). */
export interface DebriefDurableObject {
  cboId: string
  title: string
  /** `computedCurrentState` C2A, affiché tel quel (open/progressing/reopened/conflict…). */
  state: string
  conflict: boolean
  divergence: boolean
  href: string
}

/** Résumé minimal d'un sujet consommé par la projection (P0-2 + chronologie business). */
export interface DebriefSubjectTruth {
  displayState: string
  lastSeenAt: string | null
  pvSinceLastMention: number
}

/**
 * WOW-1 — projette les items d'attention canonical (qui portent déjà `category`) en registres de
 * pilotage, au niveau SUJET. ACK : identité `csId:signals` pour tous, PLUS l'ancre d'épisode
 * `lastSeenAt` pour `documentary_silence` uniquement (cf. buildDebriefSignalKey). Un item acquitté
 * disparaît (comme le « Vu » informationnel actuel). Aucune règle d'état recalculée ici.
 */
export function registerItems(
  canonicalItems: CanonicalAttentionItem[],
  truthByCs: Map<string, DebriefSubjectTruth>,
  seenSignalKeys: Set<string> = new Set(),
  durableByCs: Map<string, DebriefDurableObject[]> = new Map(),
  inlineByCs: Map<string, LiveDebriefObjectItem[]> = new Map(),
): DebriefRegisterItem[] {
  const out: DebriefRegisterItem[] = []
  for (const item of canonicalItems) {
    if (isPurelyOperational(item)) continue
    const truth = truthByCs.get(item.canonicalSubjectId)
    const episodeAnchor = item.category === 'documentary_silence' ? (truth?.lastSeenAt ?? null) : null
    const signalKey = buildDebriefSignalKey(item, episodeAnchor)
    const ack: DebriefSignalAck = seenSignalKeys.has(signalKey) ? 'seen' : 'unseen'
    if (ack === 'seen') continue // acquitté (épisode-aware pour le silence) → disparaît du Débrief
    out.push({
      canonicalSubjectId: item.canonicalSubjectId,
      title: item.title,
      register: item.category,
      category: item.category,
      reopened: truth?.displayState === 'reopened',
      signalKey,
      ack,
      pvSinceLastMention: truth?.pvSinceLastMention ?? 0,
      lastSeenAt: truth?.lastSeenAt ?? null,
      reasons: item.reasons,
      href: item.href,
      durableObjects: durableByCs.get(item.canonicalSubjectId) ?? [],
      inlineObjects: inlineByCs.get(item.canonicalSubjectId) ?? [],
    })
  }
  return out
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

  const [{ actions, deadlines, reserves }, overview, sinceDelta, recentActivity, canonicalItems, seenSignalKeys, navSubjects, cboMap] = await Promise.all([
    fetchLiveObjects(siteId).catch(() => ({ actions: [] as RawActionRow[], deadlines: [] as RawDeadlineRow[], reserves: [] as RawReserveRow[] })),
    getSiteOverview(siteId),
    buildSinceLastVisitDelta(siteId, userId).catch(() => null),
    getSiteRecentActivity(siteId, RECENT_ACTIVITY_LIMIT).catch(() => [] as SiteActivityItem[]),
    deriveCanonicalAttentionItems(siteId).catch(() => [] as CanonicalAttentionItem[]),
    userId ? getAttentionSignalAcks(siteId, userId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    getNavigableSubjectsForSite(siteId).catch(() => []),
    loadCboReducedStates(siteId).catch(() => new Map()),
  ])

  // WOW-1 — vérité de sujet (P0-2 displayState + chronologie business) pour la projection en registres.
  const truthByCs = new Map<string, DebriefSubjectTruth>(
    navSubjects.map((s) => [s.canonicalSubjectId, {
      displayState: s.displayState, lastSeenAt: s.lastSeenAt, pvSinceLastMention: s.pvSinceLastMention,
    }]),
  )

  // WOW-1 « À piloter » — objets DURABLES par sujet = CBO ACTIFS (C2A), JAMAIS les formulations brutes.
  // État pris tel quel (computedCurrentState) ; unknown/terminal exclus (isActiveCboState) — jamais
  // transformés en actif. Aucun recalcul local, aucune requête status='open' : lecture C2A pure.
  const durableByCs = new Map<string, DebriefDurableObject[]>()
  for (const [, e] of cboMap as Map<string, { cboId: string; canonicalSubjectId: string | null; label: string; reduced: { computedCurrentState: string; conflicts: string[]; documentaryDivergences: string[] } }>) {
    if (!e.canonicalSubjectId || !isActiveCboState(e.reduced.computedCurrentState as never)) continue
    const list = durableByCs.get(e.canonicalSubjectId) ?? []
    list.push({
      cboId: e.cboId,
      title: e.label,
      state: e.reduced.computedCurrentState,
      conflict: e.reduced.conflicts.length > 0 || e.reduced.computedCurrentState === 'conflict',
      divergence: e.reduced.documentaryDivergences.length > 0,
      href: `/sites/${siteId}/historique/sujets/${e.canonicalSubjectId}`,
    })
    durableByCs.set(e.canonicalSubjectId, list)
  }

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

  // WOW-1 — objets INLINE 1:1 groupés par sujet (réserves/échéances ouvertes uniquement) : ils gardent
  // leurs gestes existants (lever/dater). Les ACTIONS ne sont JAMAIS ici (arbitrage : elles sont
  // représentées par les CBO durables ci-dessus, pas par leurs formulations documentaires).
  const inlineByCs = new Map<string, LiveDebriefObjectItem[]>()
  const collectInline = (it: LiveDebriefObjectItem) => {
    if (!it.canonicalSubjectId) return
    if (it.disposition !== 'to_handle' && it.disposition !== 'to_watch') return
    const list = inlineByCs.get(it.canonicalSubjectId) ?? []
    list.push(it)
    inlineByCs.set(it.canonicalSubjectId, list)
  }

  for (const row of actions) place(actionToItem(row, today, siteId), toHandle, toWatch, recentlyHandled)
  for (const row of deadlines) { const it = deadlineToItem(row, today, siteId); collectInline(it); place(it, toHandle, toWatch, recentlyHandled) }
  for (const row of reserves) { const it = reserveToItem(row, today, siteId); collectInline(it); place(it, toHandle, toWatch, recentlyHandled) }
  for (const item of informationalItems(canonicalItems, openCanonicalSubjectIds, seenSignalKeys)) place(item, toHandle, toWatch, recentlyHandled)

  // WOW-1 — registres de pilotage au niveau SUJET (partition unique = category ; reopened en flag ;
  // CBO durables + objets 1:1 en drill-down). Projection, pas un moteur : consomme category + P0-2 + C2A.
  const registers = registerItems(canonicalItems, truthByCs, seenSignalKeys, durableByCs, inlineByCs)

  // 14A — sujets rouverts (signal `pv_reopened`), dérivés des items d'attention
  // déjà chargés : aucune requête neuve. `toHandle` reste dans l'ordre object-first
  // ici (parité mobile) ; le classement desktop est appliqué en aval par
  // `getSiteBriefAction` via `rankLiveDebriefToHandle`.
  const reopenedSubjectIds = canonicalItems
    .filter((c) => c.signals.includes('pv_reopened'))
    .map((c) => c.canonicalSubjectId)

  return {
    siteId,
    confirmedToday,
    sinceLastVisit,
    toHandle,
    toWatch,
    recentlyHandled,
    recentActivity,
    reopenedSubjectIds,
    registers,
  }
}
