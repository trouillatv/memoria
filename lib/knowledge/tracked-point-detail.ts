import 'server-only'

// ── FICHE POINT — read model d'UN tracked_point (6F, mandat Vincent) ─────────
//
// Compose au-dessus de tracked-point-read-model.ts, JAMAIS un second moteur d'état :
// le derivedState/markers/trajectory viennent tels quels de `loadTrackedPointReadModel`
// (elle-même consommant `reduceTrackedPointLifecycle`, gelé). Ce fichier n'ajoute que
// de l'HYDRATATION en lecture — libellés, preuves détaillées, actions/échéances/réserves
// liées, acteurs — jamais un recalcul d'état.
//
// Point merged (doctrine 6F) : la fiche affiche la vérité CANONIQUE du Point cible
// (state/actions/preuves déjà agrégées sur tout le composant de fusion par
// loadTrackedPointReadModel), sans perdre la traçabilité du Point source — `mergeNotice`
// signale qu'on a été redirigé depuis un Point fusionné, `mergedFrom` liste les Points
// (avec leur propre libellé) qui ont été fusionnés dans ce canonique.

import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { todayLocalIso } from '@/lib/time/local-date'
import type { SiteActionStatus } from '@/types/db'
import {
  loadTrackedPointReadModel,
  type PointReadModelEntry,
  type TrackedPointIdentityStatus,
  type TrackedPointStatus,
} from '@/lib/knowledge/tracked-point-read-model'
import type { PointComputedCurrentState, PointMarker, PointEventKind } from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import { documentHref } from '@/lib/knowledge/document-href'
import { detectActorRelations, type ActorSubject } from '@/lib/db/actor-citation'
import { loadSitePvDates, daysSince, countPassagesAfter } from '@/lib/knowledge/tracked-point-lingering'

const ACTION_STATUS_LABEL: Record<SiteActionStatus, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée',
}
type DeadlineStatus = 'to_plan' | 'planned' | 'done' | 'cancelled' | 'superseded'
const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  to_plan: 'À planifier', planned: 'Planifiée', done: 'Réalisée', cancelled: 'Annulée', superseded: 'Remplacée',
}
type ReserveStatus = 'open' | 'lifted'
// Vocabulaire réserve (mig 110) : jamais « résolu » — toujours « levée ».
const RESERVE_STATUS_LABEL: Record<ReserveStatus, string> = { open: 'Ouverte', lifted: 'Levée' }

export const POINT_STATE_LABEL: Record<PointComputedCurrentState, string> = {
  unknown: 'Inconnu', open: 'Ouvert', resolved: 'Résolu', reopened: 'Réouvert', conflict: 'Conflit',
}
export const POINT_MARKER_LABEL: Record<PointMarker, string> = {
  to_confirm: 'À confirmer',
  closed_by_decision: 'Clos par décision',
  awaiting_decision: 'Décision en attente',
  documentaryDivergence: 'Divergence documentaire',
}
const POINT_EVENT_LABEL: Record<PointEventKind, string> = {
  intent_set: 'Intention posée',
  decision_pending: 'Décision en attente',
  no_action_decided: 'Clos par décision (aucune action nécessaire)',
  resolution_signal: 'Preuve documentaire de résolution',
  open_signal: 'Signal documentaire d’ouverture',
  resolution_claimed: 'Résolution annoncée (à confirmer)',
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export interface PointDetailTrajectoryEntry {
  effectiveAt: string
  dateLabel: string | null
  kind: PointEventKind
  kindLabel: string
  isResolving: boolean
  source: string | null
}

export interface PointDetailEvidence {
  proposalId: string
  documentId: string | null
  kind: PointEventKind
  kindLabel: string
  date: string
  dateLabel: string | null
  isResolving: boolean
  documentFilename: string | null
  documentType: string | null
  href: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
}

export type PointDetailResponsible =
  | { kind: 'contact'; name: string; fonction: string | null }
  | { kind: 'company'; name: string }
  | { kind: 'text'; label: string }

// Provenance documentaire d'une Action (mandat Vincent, mini-lot « provenance des Actions
// dans la fiche Point ») — construite depuis `document_proposal_materialization`
// (target_entity_type='site_action'), jamais fabriquée : une Action de saisie humaine ou
// Copilote (sans matérialisation) a `sources: []`, ce n'est pas un manque à combler.
export interface PointDetailActionSource {
  documentId: string
  documentFilename: string | null
  documentType: string | null
  href: string
  date: string | null
  dateLabel: string | null
  sourcePage: number | null
  sourceExcerpt: string | null
}

export interface PointDetailLinkedObject {
  objectType: 'site_action' | 'site_reserve' | 'site_deadline'
  id: string
  title: string
  status: string
  statusLabel: string
  isDone: boolean
  isLate: boolean
  dueDate: string | null
  dueDateLabel: string | null
  responsible: PointDetailResponsible | null
  // Suggestion GAP 1 (mandat Vincent, lot Point Actions inline) : nom d'un acteur DÉJÀ
  // structuré sur ce Point (cf. `actors`) dont le nom apparaît en containment EXACT
  // (substring, zéro fuzzy) dans ce titre — uniquement quand `responsible` est null et
  // qu'un seul acteur correspond. Toujours une suggestion, jamais une affectation.
  suggestedResponsibleName: string | null
  // Provenance documentaire (site_action uniquement) — toujours [] pour reserve/deadline
  // (hors périmètre du mini-lot provenance).
  sources: PointDetailActionSource[]
  href: string
  // ── Dates de cycle de vie (Film du Point, mandat Vincent 2026-09-14) ──────
  // Additives, null quand non pertinentes pour l'objectType. `createdAt` n'est
  // fiable QUE pour une Action jamais matérialisée depuis un document : pour une
  // Action importée depuis un PV historique, `site_actions.created_at` vaut la
  // date du batch d'import (défaut `now()` de `materialize_historical_visit()`,
  // jamais corrigé même après mig 374), pas la date réelle du fait — d'où
  // `wasMaterialized` qui commande quelle date le Film peut réellement afficher.
  createdAt: string | null
  wasMaterialized: boolean
  doneAt: string | null
  issuedOn: string | null
  liftedAt: string | null
}

export interface PointDetailActor {
  kind: 'contact' | 'company'
  id: string
  name: string
  fonction: string | null
  // Comptage honnête de responsabilité par type d'objet lié à CE Point (mandat Vincent :
  // distinguer « acteur mentionné » de « responsable d'une Action précise ») — jamais un
  // total agrégé qui effacerait la distinction, jamais une métrique de « citation » non
  // mesurée (aucune donnée de ce type n'existe aujourd'hui).
  responsibleActionCount: number
  responsibleReserveCount: number
  responsibleDeadlineCount: number
}

// Entreprise citée dans le titre du Point ou dans le texte des preuves, mais jamais
// affectée `assigned_company_id`/`responsible_company_id` sur un objet lié (mandat
// Vincent, lot Acteurs/entreprise citée, cas Clim Exp'Air) — cf. `computeCitedCompanies`.
// Distincte de `PointDetailActor` : une citation n'est jamais une responsabilité.
export interface PointDetailCitedCompany {
  id: string
  name: string
}

export interface PointDetailMergeSource {
  id: string
  label: string
}

// Provenance affichée juste sous le bandeau d'état (mandat Vincent, lot UX Point 3F) :
// isCausal=true quand la preuve fait partie de stateBasis (elle a RÉELLEMENT déterminé
// derivedState) → « Pourquoi ce Point est … ? ». isCausal=false = repli honnête quand
// stateBasis est vide (état venu d'un verdict CBO sans événement propre au Point) : on
// montre alors la preuve la plus récente sans jamais prétendre qu'elle explique l'état.
export interface PointDetailProvenance extends PointDetailEvidence {
  isCausal: boolean
}

export interface PointDetailLinkedObjectGroup {
  key: string
  title: string
  objectType: PointDetailLinkedObject['objectType']
  count: number
  items: PointDetailLinkedObject[]
  representative: PointDetailLinkedObject
}

export interface TrackedPointDetail {
  id: string
  siteId: string
  label: string
  status: TrackedPointStatus
  identityStatus: TrackedPointIdentityStatus
  derivedState: PointComputedCurrentState
  derivedStateLabel: string
  // « Ce qu'il faut retenir aujourd'hui » — une phrase, synthèse déterministe de
  // derivedState + markers/divergences déjà calculés (aucun recalcul d'état).
  headline: string
  createdAt: string | null
  createdAtLabel: string | null
  markers: PointMarker[]
  markerLabels: string[]
  toConfirm: boolean
  hasDocumentaryDivergence: boolean
  hasConflict: boolean
  documentaryDivergences: string[]
  conflicts: string[]
  ownerCanonicalSubjectId: string | null
  ownerCanonicalSubjectLabel: string | null
  // Date d'ouverture réelle (premier événement de trajectoire, ordre ascendant garanti
  // par le reducer) — distincte de latestMeaningfulEventAt qui est le DERNIER événement.
  openedAt: string | null
  openedAtLabel: string | null
  latestMeaningfulEventAt: string | null
  latestMeaningfulEventLabel: string | null
  latestEvidenceAt: string | null
  // Nombre d'occurrences/mentions connues (longueur de la trajectoire) — compense
  // en mots l'absence de trajectoire riche (6F.1), jamais un second score.
  mentionsCount: number
  // §3 — Évolution : la trajectoire déjà réduite, mise en mots (aucun recalcul).
  trajectory: PointDetailTrajectoryEntry[]
  // §2 — FILM DU POINT (mandat Vincent 2026-09-14) : composition unique de présentation
  // de la trajectoire + cycle de vie Actions/Réserves, dédupliquée, prête à rendre.
  film: PointFilm
  // §4 — Preuves et sources, triées la plus récente en premier (une preuve ancienne
  // résolue ne doit jamais masquer une preuve ouverte plus récente : l'ordre seul
  // suffit, le state affiché vient déjà du reducer, jamais recalculé ici).
  evidence: PointDetailEvidence[]
  // Provenance causale (lot UX Point 3F) — null seulement si aucune preuve documentaire
  // n'existe pour ce Point (jamais fabriquée).
  provenance: PointDetailProvenance | null
  // §2/§5 — actions/échéances/réserves liées, ouvertes ET terminées.
  linkedObjects: PointDetailLinkedObject[]
  openLinkedObjects: PointDetailLinkedObject[]
  closedLinkedObjects: PointDetailLinkedObject[]
  // §1 « À faire » compacté (lot UX Point 3F) — regroupement VISUEL par titre exactement
  // identique (zéro fuzzy, cf. doctrine dédup CBO) ; ne modifie aucune donnée sous-jacente.
  openLinkedObjectGroups: PointDetailLinkedObjectGroup[]
  // §6 — acteurs explicitement liés (jamais déduits).
  actors: PointDetailActor[]
  // §6bis — entreprises CITÉES (titre du Point ou texte des preuves) mais jamais
  // affectées comme responsable sur ce Point — jamais une promotion automatique
  // vers `actors` (mandat Vincent, lot Acteurs/entreprise citée, cas Clim Exp'Air).
  citedCompanies: PointDetailCitedCompany[]
  // §7 — identité/mémoire (secondaire/admin).
  foundingKind: string
  foundingSource: string | null
  hasUpstreamDefect: boolean
  cboIds: string[]
  hardMemberThreadIds: string[]
  canonicalPointId: string
  isMergedAway: boolean
  mergedIntoId: string | null
  mergedFrom: PointDetailMergeSource[]
  // Présent uniquement si l'id demandé était un Point fusionné : la fiche affiche
  // alors la vérité du canonique, mais ce champ garde la trace de la redirection.
  mergeNotice: { requestedPointId: string; requestedLabel: string } | null
}

export function toTrajectoryEntry(t: { effectiveAt: string; kind: PointEventKind; source?: string }): PointDetailTrajectoryEntry {
  return {
    effectiveAt: t.effectiveAt,
    dateLabel: frDate(t.effectiveAt),
    kind: t.kind,
    kindLabel: POINT_EVENT_LABEL[t.kind] ?? t.kind,
    isResolving: t.kind === 'resolution_signal' || t.kind === 'no_action_decided',
    source: t.source ?? null,
  }
}

/** Regroupe des objets liés au titre EXACTEMENT identique (même objectType) — zéro fuzzy,
 *  même doctrine que la dédup CBO. Ordre d'entrée préservé (déjà trié par échéance) : ne
 *  fait que compacter l'affichage, ne modifie ni la donnée ni son tri. */
export function groupLinkedObjectsByTitle(items: PointDetailLinkedObject[]): PointDetailLinkedObjectGroup[] {
  const groups = new Map<string, PointDetailLinkedObjectGroup>()
  for (const item of items) {
    const key = `${item.objectType}:${item.title.trim()}`
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      existing.count += 1
    } else {
      groups.set(key, { key, title: item.title, objectType: item.objectType, count: 1, items: [item], representative: item })
    }
  }
  return [...groups.values()]
}

/** Dérive les acteurs §6 : union des responsables déjà structurés (contact/entreprise)
 *  des objets liés, JAMAIS une déduction — un acteur sans FK explicite n'apparaît pas
 *  ici. Comptage honnête par type d'objet (mandat Vincent, lot Point Actions inline) :
 *  distingue « acteur mentionné » de « responsable d'une Action précise », jamais un
 *  total agrégé qui effacerait cette distinction. */
export function computePointActors(linkedObjects: PointDetailLinkedObject[]): PointDetailActor[] {
  const actorsMap = new Map<string, PointDetailActor>()
  for (const o of linkedObjects) {
    const responsible = o.responsible
    if (!responsible) continue
    let key: string | null = null
    let name: string | null = null
    let fonction: string | null = null
    if (responsible.kind === 'contact') { key = `contact:${responsible.name}`; name = responsible.name; fonction = responsible.fonction }
    else if (responsible.kind === 'company') { key = `company:${responsible.name}`; name = responsible.name }
    if (!key || !name) continue
    let actor = actorsMap.get(key)
    if (!actor) {
      actor = {
        kind: responsible.kind === 'contact' ? 'contact' : 'company',
        id: key,
        name,
        fonction,
        responsibleActionCount: 0,
        responsibleReserveCount: 0,
        responsibleDeadlineCount: 0,
      }
      actorsMap.set(key, actor)
    }
    if (o.objectType === 'site_action') actor.responsibleActionCount += 1
    else if (o.objectType === 'site_reserve') actor.responsibleReserveCount += 1
    else if (o.objectType === 'site_deadline') actor.responsibleDeadlineCount += 1
  }
  return [...actorsMap.values()]
}

/** Suggestion GAP 1 (mandat Vincent, lot Point Actions inline) : pour chaque objet SANS
 *  responsable, propose le nom d'un acteur DÉJÀ structuré sur ce Point (responsable d'au
 *  moins un autre objet lié) dont le nom apparaît en containment EXACT (substring, zéro
 *  fuzzy) dans le titre. Silence (null) si aucun acteur ne correspond ou si plusieurs
 *  correspondent — jamais un choix arbitraire parmi plusieurs (même doctrine que
 *  needsYouQuestionId). Retourne un NOUVEAU tableau, ne mute jamais l'entrée. */
export function suggestResponsibleNames(
  items: PointDetailLinkedObject[],
  actorNames: string[],
): PointDetailLinkedObject[] {
  if (actorNames.length === 0) return items
  return items.map((o) => {
    if (o.responsible) return o
    const matches = actorNames.filter((name) => o.title.includes(name))
    return matches.length === 1 ? { ...o, suggestedResponsibleName: matches[0] } : o
  })
}

/** §6bis — Entreprises citées mais jamais castées en Responsable (mandat Vincent, lot
 *  Acteurs/entreprise citée, cas Clim Exp'Air : « L'exploitant doit lever le doute avec
 *  Clim'Expair », citée dans le titre d'une Action sans jamais être `assigned_company_id`).
 *  Réutilise `detectActorRelations` (P1-C1b, même détection déterministe à bornes de mot
 *  que la citation d'occurrence) — jamais une nouvelle heuristique de matching. Une
 *  entreprise déjà DANS `actors` (déjà responsable d'un objet lié à ce Point) n'est jamais
 *  redondamment listée ici : citée et responsable sont mutuellement exclusives dans une
 *  même fiche, jamais une promotion automatique de l'une vers l'autre. */
export function computeCitedCompanies(
  texts: Array<string | null | undefined>,
  candidates: ActorSubject[],
  excludeNames: string[],
): PointDetailCitedCompany[] {
  if (candidates.length === 0) return []
  const excluded = new Set(excludeNames.map((n) => n.trim().toLowerCase()))
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const out: PointDetailCitedCompany[] = []
  for (const relation of detectActorRelations(texts, candidates)) {
    const candidate = byId.get(relation.actorId)
    if (!candidate) continue
    if (excluded.has(candidate.label.trim().toLowerCase())) continue
    out.push({ id: candidate.id, name: candidate.label })
  }
  return out
}

/** Extrait un id de `document_extraction_proposal` d'une référence `proposal:<id>` de
 *  trajectoire. `null` si la trajectoire n'a pas d'origine documentaire (ex. décision native). */
export function proposalIdFromSource(source: string | null): string | null {
  if (!source || !source.startsWith('proposal:')) return null
  return source.slice('proposal:'.length)
}

/** « Ce qu'il faut retenir aujourd'hui » — une phrase déterministe, composée
 *  UNIQUEMENT à partir de champs déjà calculés par le reducer (derivedState,
 *  documentaryDivergences, conflicts, openedAt, latestMeaningfulEventAt,
 *  mentionsCount). Ne recalcule jamais l'état : c'est de la mise en mots, pas
 *  un second moteur.
 *  openedAt = premier événement de trajectoire (date d'ouverture réelle) ;
 *  latestMeaningfulEventAt = dernier événement (date de réouverture/résolution).
 *  Les confondre pour l'état 'open' donnait une date d'ouverture fausse quand un
 *  Point a plusieurs mentions étalées dans le temps — corrigé ici (6F.1). */
export function buildHeadline(entry: {
  derivedState: PointComputedCurrentState
  documentaryDivergences: string[]
  conflicts: string[]
  openedAt: string | null
  latestMeaningfulEventAt: string | null
  mentionsCount: number
}): string {
  const latestLabel = frDate(entry.latestMeaningfulEventAt)
  const openedLabel = frDate(entry.openedAt)
  // Une seule mention == l'ouverture elle-même : ne rien ajouter (pas d'info nouvelle).
  const mentionClause = (count: number): string =>
    count > 1 ? `, mentionné dans ${count} occurrences` : ''

  switch (entry.derivedState) {
    case 'reopened':
      return entry.documentaryDivergences[0]
        ? `Réouvert — ${entry.documentaryDivergences[0]}`
        : `Réouvert${latestLabel ? ` depuis le ${latestLabel}` : ''} — une preuve plus récente contredit une résolution antérieure.`
    case 'conflict':
      return entry.conflicts[0] ? `En conflit — ${entry.conflicts[0]}` : 'En conflit — les preuves disponibles se contredisent.'
    case 'resolved':
      return latestLabel
        ? `Résolu depuis le ${latestLabel}${mentionClause(entry.mentionsCount)}.`
        : entry.mentionsCount > 0 ? `Résolu${mentionClause(entry.mentionsCount)}.` : 'Résolu.'
    case 'open':
      return openedLabel
        ? `Ouvert depuis le ${openedLabel}${mentionClause(entry.mentionsCount)} — aucune résolution constatée à ce jour.`
        : 'Ouvert — aucune résolution constatée à ce jour, aucune preuve documentaire retrouvée.'
    case 'unknown':
    default:
      return 'État non déterminé — pas assez d’éléments pour se prononcer.'
  }
}

export interface PointOrigin {
  dateLabel: string | null
  evidence: PointDetailEvidence | null
}

/** Genèse du Point (mandat Vincent, lot UX Cockpit+Points) : date d'ouverture réelle
 *  (déjà calculée, openedAt = trajectory[0]) + sa preuve documentaire SI elle en a une
 *  (jointure par kind+date sur l'événement d'ouverture — jamais fabriquée). */
export function resolveOrigin(entry: {
  openedAtLabel: string | null
  trajectory: PointDetailTrajectoryEntry[]
  evidence: PointDetailEvidence[]
}): PointOrigin {
  const first = entry.trajectory[0] ?? null
  const evidence = first
    ? entry.evidence.find((e) => e.kind === first.kind && e.date === first.effectiveAt) ?? null
    : null
  return { dateLabel: entry.openedAtLabel, evidence }
}

/** true si la provenance courante (§ état) et la preuve de genèse sont LE MÊME
 *  événement (même kind + même date) — évite d'afficher deux fois la même preuve
 *  quand le Point n'a jamais évolué depuis son ouverture (mandat : « pas de
 *  répétition si genèse et provenance courante sont identiques »). */
export function originMatchesProvenance(origin: PointOrigin, provenance: PointDetailProvenance | null): boolean {
  if (!provenance || !origin.evidence) return false
  return provenance.kind === origin.evidence.kind && provenance.date === origin.evidence.date
}

// ── FILM DU POINT (mandat Vincent, GO 2026-09-14) ─────────────────────────────
//
// Transformation en place de l'ancien §2 « Histoire et preuves » : composition PURE des
// primitives déjà calculées ci-dessus (trajectory, evidence, linkedObjects), AUCUN nouveau
// moteur, AUCUNE modification de tracked-point-lifecycle-reducer.ts. Périmètre V1 gelé par
// Vincent : trajectoire documentaire + création/clôture Actions/Réserves ; échéances et
// resolution_claimed exclus ; pas d'historique d'état natif intermédiaire (le state
// composé final peut diverger de reduceNative, cf. audit film-du-point-audit.md).

export type PointFilmMajorKind =
  | 'apparition'
  | 'resolution_constatee'
  | 'reouverture'
  | 'transition_native'
  | 'action_creee'
  | 'action_cloturee'
  | 'reserve_creee'
  | 'reserve_levee'

export interface PointFilmMajorEvent {
  key: string
  date: string
  dateLabel: string | null
  kind: PointFilmMajorKind
  label: string
  href: string | null
  documentLabel: string | null
  sourceNote: string | null
}

export interface PointFilmMentionGroup {
  key: string
  count: number
  label: string
  stateLabel: string
  dates: string[]
  dateLabels: string[]
  href: string | null
}

export type PointFilmItem =
  | { type: 'major'; sortDate: string; event: PointFilmMajorEvent }
  | { type: 'mentions'; sortDate: string; group: PointFilmMentionGroup }

export interface PointFilm {
  items: PointFilmItem[]
  todayLabel: string
  sinceSummary: string | null
  mergeDisclaimer: string | null
}

// Libellé des ré-occurrences SANS changement d'état (mandat : compacter, jamais une
// ligne développée par occurrence — sinon « frise de 40 mètres » sur les gros Points).
const MENTION_STATE_LABEL: Record<PointEventKind, string> = {
  intent_set: 'intention reconfirmée',
  decision_pending: 'décision toujours en attente',
  no_action_decided: 'toujours clos par décision',
  resolution_signal: 'toujours résolu',
  open_signal: 'toujours ouvert',
  resolution_claimed: 'résolution annoncée', // jamais atteint : aucun producteur réel (V1 exclu)
}

function transitionLabel(kind: PointEventKind, lastKind: PointEventKind | null): { kind: PointFilmMajorKind; label: string } {
  if (kind === 'resolution_signal') return { kind: 'resolution_constatee', label: 'Résolution constatée' }
  if (kind === 'open_signal' && lastKind === 'resolution_signal') {
    return { kind: 'reouverture', label: 'Réouverture — nouvelle preuve d’ouverture après une résolution constatée' }
  }
  return { kind: 'transition_native', label: POINT_EVENT_LABEL[kind] ?? kind }
}

/** Dérive les événements DOCUMENTAIRES du Film à partir de la trajectoire déjà réduite :
 *  1re occurrence = Apparition (majeur) ; changement de kind = transition (majeur) ;
 *  répétition du même kind = mention compacte (regroupée par bloc, jamais individuelle).
 *  `resolution_claimed` n'apparaît jamais ici (aucun producteur réel, exclu V1 par Vincent). */
function buildDocumentaryItems(
  trajectory: PointDetailTrajectoryEntry[],
  evidence: PointDetailEvidence[],
): PointFilmItem[] {
  const evidenceByKindDate = new Map(evidence.map((e) => [`${e.kind}@${e.date}`, e]))
  const items: PointFilmItem[] = []
  let lastKind: PointEventKind | null = null
  let pending: PointDetailTrajectoryEntry[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    const kind = pending[0].kind
    const first = pending[0]
    const evRef = evidenceByKindDate.get(`${first.kind}@${first.effectiveAt}`)
    items.push({
      type: 'mentions',
      sortDate: first.effectiveAt,
      group: {
        key: `mentions:${first.kind}:${first.effectiveAt}`,
        count: pending.length,
        label: pending.length > 1 ? `${pending.length} passages sans changement` : 'Toujours mentionné',
        stateLabel: MENTION_STATE_LABEL[kind] ?? kind,
        dates: pending.map((p) => p.effectiveAt),
        dateLabels: pending.map((p) => p.dateLabel).filter((d): d is string => !!d),
        href: evRef?.href ?? null,
      },
    })
    pending = []
  }

  trajectory.forEach((t, i) => {
    if (i === 0) {
      const evRef = evidenceByKindDate.get(`${t.kind}@${t.effectiveAt}`)
      items.push({
        type: 'major',
        sortDate: t.effectiveAt,
        event: {
          key: `apparition:${t.effectiveAt}`,
          date: t.effectiveAt,
          dateLabel: t.dateLabel,
          kind: 'apparition',
          label: 'Point apparu',
          href: evRef?.href ?? null,
          documentLabel: evRef?.documentFilename ?? null,
          sourceNote: null,
        },
      })
      lastKind = t.kind
      return
    }
    if (t.kind === lastKind) {
      pending.push(t)
      return
    }
    flushPending()
    const evRef = evidenceByKindDate.get(`${t.kind}@${t.effectiveAt}`)
    const { kind: majorKind, label } = transitionLabel(t.kind, lastKind)
    items.push({
      type: 'major',
      sortDate: t.effectiveAt,
      event: {
        key: `${majorKind}:${t.effectiveAt}`,
        date: t.effectiveAt,
        dateLabel: t.dateLabel,
        kind: majorKind,
        label,
        href: evRef?.href ?? null,
        documentLabel: evRef?.documentFilename ?? null,
        sourceNote: null,
      },
    })
    lastKind = t.kind
  })
  flushPending()
  return items
}

/** Événements de cycle de vie Actions/Réserves (mandat Vincent : « pas seulement PV → PV →
 *  PV », V1 = trajectoire + création/clôture Actions/Réserves). Dédup obligatoire : une
 *  Action dupliquée en plusieurs lignes site_actions (même titre exact, cf. audit CBO
 *  multiplicité) ne doit produire qu'UN SEUL événement « créée » et qu'UN SEUL « clôturée »
 *  — réutilise `groupLinkedObjectsByTitle`, aucune nouvelle logique de dédup. Échéances
 *  explicitement exclues du V1 (Vincent). */
function buildObjectLifecycleItems(linkedObjects: PointDetailLinkedObject[]): PointFilmItem[] {
  const groups = groupLinkedObjectsByTitle(linkedObjects.filter((o) => o.objectType !== 'site_deadline'))
  const items: PointFilmItem[] = []

  for (const group of groups) {
    if (group.objectType === 'site_action') {
      // Date de création fiable : preuve documentaire (Action matérialisée depuis un PV) en
      // priorité, sinon `created_at` UNIQUEMENT si l'Action n'a jamais été matérialisée
      // (created_at vaut la date d'IMPORT, pas la date réelle, pour toute Action historique —
      // vérifié sur materialize_historical_visit(), mig 374 incluse). Silence si matérialisée
      // sans preuve résolue : aucune date fiable, on n'invente rien.
      let bestDate: string | null = null
      let bestHref: string | null = null
      let bestDoc: string | null = null
      let bestSourceNote: string | null = null
      for (const item of group.items) {
        let date: string | null = null
        let href: string | null = null
        let doc: string | null = null
        let sourceNote: string | null = null
        if (item.wasMaterialized) {
          const earliest = item.sources.length > 0 ? item.sources[item.sources.length - 1] : null
          if (earliest?.date) { date = earliest.date; href = earliest.href; doc = earliest.documentFilename }
        } else if (item.createdAt) {
          date = item.createdAt.slice(0, 10)
          sourceNote = 'Source : Action MemorIA'
        }
        if (date && (!bestDate || date < bestDate)) { bestDate = date; bestHref = href; bestDoc = doc; bestSourceNote = sourceNote }
      }
      if (bestDate) {
        items.push({
          type: 'major',
          sortDate: bestDate,
          event: {
            key: `action-creee:${group.key}`,
            date: bestDate,
            dateLabel: frDate(bestDate),
            kind: 'action_creee',
            label: `Action créée : ${group.representative.title}`,
            href: bestHref,
            documentLabel: bestDoc,
            sourceNote: bestSourceNote,
          },
        })
      }
      const doneDates = group.items.map((i) => i.doneAt).filter((d): d is string => !!d).sort()
      if (doneDates.length > 0) {
        const doneDate = doneDates[0].slice(0, 10)
        items.push({
          type: 'major',
          sortDate: doneDate,
          event: {
            key: `action-cloturee:${group.key}`,
            date: doneDate,
            dateLabel: frDate(doneDate),
            kind: 'action_cloturee',
            label: `Action clôturée : ${group.representative.title}`,
            href: null,
            documentLabel: null,
            sourceNote: 'Clôturée dans MemorIA',
          },
        })
      }
    } else if (group.objectType === 'site_reserve') {
      const issuedDates = group.items.map((i) => i.issuedOn).filter((d): d is string => !!d).sort()
      if (issuedDates.length > 0) {
        const issuedDate = issuedDates[0]
        items.push({
          type: 'major',
          sortDate: issuedDate,
          event: {
            key: `reserve-creee:${group.key}`,
            date: issuedDate,
            dateLabel: frDate(issuedDate),
            kind: 'reserve_creee',
            label: `Réserve créée : ${group.representative.title}`,
            href: null,
            documentLabel: null,
            sourceNote: 'Source : Réserve MemorIA',
          },
        })
      }
      const liftedDates = group.items.map((i) => i.liftedAt).filter((d): d is string => !!d).sort()
      if (liftedDates.length > 0) {
        const liftedDate = liftedDates[0].slice(0, 10)
        items.push({
          type: 'major',
          sortDate: liftedDate,
          event: {
            key: `reserve-levee:${group.key}`,
            date: liftedDate,
            dateLabel: frDate(liftedDate),
            kind: 'reserve_levee',
            label: `Réserve levée : ${group.representative.title}`,
            href: null,
            documentLabel: null,
            sourceNote: 'Levée dans MemorIA',
          },
        })
      }
    }
  }
  return items
}

export function buildPointFilm(input: {
  trajectory: PointDetailTrajectoryEntry[]
  evidence: PointDetailEvidence[]
  linkedObjects: PointDetailLinkedObject[]
  derivedStateLabel: string
  latestMeaningfulEventAt: string | null
  daysSinceLastEvent: number | null
  passagesSinceLastEvent: number | null
  mergedFrom: PointDetailMergeSource[]
}): PointFilm {
  const items = [...buildDocumentaryItems(input.trajectory, input.evidence), ...buildObjectLifecycleItems(input.linkedObjects)]
  items.sort((a, b) => a.sortDate.localeCompare(b.sortDate))

  const sinceSummary = input.latestMeaningfulEventAt && input.daysSinceLastEvent !== null
    ? `${input.daysSinceLastEvent} jour${input.daysSinceLastEvent !== 1 ? 's' : ''}`
      + (input.passagesSinceLastEvent ? ` · ${input.passagesSinceLastEvent} passage${input.passagesSinceLastEvent !== 1 ? 's' : ''} sans évolution` : '')
    : null

  return {
    items,
    todayLabel: `Aujourd’hui — ${input.derivedStateLabel}`,
    sinceSummary,
    mergeDisclaimer: input.mergedFrom.length > 0
      ? 'Ce Point regroupe plusieurs anciens suivis. L’historique affiché ici peut être partiel avant leur fusion.'
      : null,
  }
}

export async function getTrackedPointDetail(
  siteId: string,
  pointId: string,
  // Base de la page Actions du SURFACE APPELANT (desktop `/sites/${id}/actions`, mobile
  // `/m/site/${siteId}/actions`) — corrige un bug latent où « Voir le détail » pointait
  // toujours vers le desktop, y compris depuis la fiche Point mobile. Défaut = desktop,
  // pour ne jamais casser un appelant qui ne le fournirait pas encore.
  actionsHref: string = `/sites/${siteId}/actions`,
): Promise<TrackedPointDetail | null> {
  const db = createAdminClient()

  const { data: site } = await db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  if (!site) return null
  const siteOrgId = (site as { organization_id: string | null }).organization_id
  if (!siteOrgId || !(await requireOrganizationMembership(siteOrgId)).ok) return null

  const { points, mergedPoints } = await loadTrackedPointReadModel(siteId)

  const requested: PointReadModelEntry | undefined =
    points.find((p) => p.id === pointId) ?? mergedPoints.find((p) => p.id === pointId)
  if (!requested) return null

  const isMergedAway = requested.status === 'merged'
  const canonicalEntry: PointReadModelEntry = isMergedAway
    ? (points.find((p) => p.id === requested.canonicalPointId) ?? requested)
    : requested

  const mergedFrom: PointDetailMergeSource[] = mergedPoints
    .filter((mp) => mp.canonicalPointId === canonicalEntry.id && mp.id !== canonicalEntry.id)
    .map((mp) => ({ id: mp.id, label: mp.label }))

  const mergeNotice = isMergedAway && canonicalEntry.id !== requested.id
    ? { requestedPointId: requested.id, requestedLabel: requested.label }
    : null

  // ── Date de création du Point (hydratation additive, hors read-model) ────
  const { data: pointRow } = await db.from('tracked_point')
    .select('created_at').eq('id', canonicalEntry.id).maybeSingle()
  const createdAt = (pointRow as { created_at: string } | null)?.created_at ?? null

  // ── Sujet canonique propriétaire ──────────────────────────────────────────
  let ownerCanonicalSubjectLabel: string | null = null
  if (canonicalEntry.ownerCanonicalSubjectId) {
    const { data: subj } = await db.from('canonical_subject')
      .select('label').eq('id', canonicalEntry.ownerCanonicalSubjectId).maybeSingle()
    ownerCanonicalSubjectLabel = (subj as { label: string } | null)?.label ?? null
  }

  // ── §3/§4 — trajectoire + hydratation des preuves documentaires ──────────
  // trajectory est chronologiquement ascendante (invariant du reducer, cf.
  // projectTrackedPoint) : le premier élément est la date d'ouverture réelle.
  const openedAt = canonicalEntry.trajectory.length > 0 ? canonicalEntry.trajectory[0].effectiveAt : null
  const mentionsCount = canonicalEntry.trajectory.length
  const trajectory = canonicalEntry.trajectory.map(toTrajectoryEntry)
  const proposalIds = [...new Set(
    canonicalEntry.trajectory.map((t) => proposalIdFromSource(t.source ?? null)).filter((id): id is string => !!id),
  )]

  const evidence: PointDetailEvidence[] = []
  if (proposalIds.length > 0) {
    const { data: proposalRows } = await db.from('document_extraction_proposal')
      .select('id, document_id, source_page, source_excerpt').in('id', proposalIds)
    const proposalById = new Map((proposalRows ?? []).map((r) => [r.id as string, r as {
      id: string; document_id: string | null; source_page: number | null; source_excerpt: string | null
    }]))
    const documentIds = [...new Set([...proposalById.values()].map((p) => p.document_id).filter((id): id is string => !!id))]
    const docById = new Map<string, { filename: string | null; document_type: string | null }>()
    if (documentIds.length > 0) {
      const { data: docRows } = await db.from('documents').select('id, filename, document_type').in('id', documentIds)
      for (const d of docRows ?? []) docById.set(d.id as string, { filename: d.filename as string | null, document_type: d.document_type as string | null })
    }
    for (const t of canonicalEntry.trajectory) {
      const proposalId = proposalIdFromSource(t.source ?? null)
      if (!proposalId) continue
      const proposal = proposalById.get(proposalId)
      const doc = proposal?.document_id ? docById.get(proposal.document_id) : undefined
      evidence.push({
        proposalId,
        documentId: proposal?.document_id ?? null,
        kind: t.kind,
        kindLabel: POINT_EVENT_LABEL[t.kind] ?? t.kind,
        date: t.effectiveAt,
        dateLabel: frDate(t.effectiveAt),
        isResolving: t.kind === 'resolution_signal',
        documentFilename: doc?.filename ?? null,
        documentType: doc?.document_type ?? null,
        href: proposal?.document_id && doc?.document_type
          ? documentHref({ id: proposal.document_id, document_type: doc.document_type }, siteId)
          : null,
        sourcePage: proposal?.source_page ?? null,
        sourceExcerpt: proposal?.source_excerpt?.trim() || null,
      })
    }
  }
  evidence.sort((a, b) => b.date.localeCompare(a.date))
  const latestEvidenceAt = evidence.length > 0 ? evidence[0].date : null

  // ── Provenance causale (lot UX Point 3F) ──────────────────────────────────
  // stateBasis (reduceTrackedPointLifecycle) = refs `${kind}@${effectiveAt}` des événements
  // qui ont RÉELLEMENT déterminé derivedState. On ne recalcule rien : on matche juste les
  // preuves déjà triées contre ces refs. Vide quand l'état vient d'un verdict CBO sans
  // événement propre au Point → repli honnête sur la preuve la plus récente (isCausal=false),
  // jamais présentée comme la preuve du constat.
  const stateBasisRefs = new Set(canonicalEntry.stateBasis)
  const causalEvidence = evidence.filter((e) => stateBasisRefs.has(`${e.kind}@${e.date}`))
  const provenance: PointDetailProvenance | null =
    causalEvidence.length > 0 ? { ...causalEvidence[0], isCausal: true }
    : evidence.length > 0 ? { ...evidence[0], isCausal: false }
    : null

  // ── §2/§5 — actions/échéances/réserves liées, via canonical_business_object_member ──
  const linkedObjects: PointDetailLinkedObject[] = []
  if (canonicalEntry.cboIds.length > 0) {
    const { data: memberRows } = await db.from('canonical_business_object_member')
      .select('canonical_business_object_id, member_entity_id, member_entity_type')
      .in('canonical_business_object_id', canonicalEntry.cboIds)
    const actionIds = new Set<string>()
    const reserveIds = new Set<string>()
    const deadlineIds = new Set<string>()
    for (const r of memberRows ?? []) {
      const type = r.member_entity_type as string
      if (type === 'site_action') actionIds.add(r.member_entity_id as string)
      else if (type === 'site_reserve') reserveIds.add(r.member_entity_id as string)
      else if (type === 'site_deadline') deadlineIds.add(r.member_entity_id as string)
    }

    const contactIds = new Set<string>()
    const companyIds = new Set<string>()

    type ActionRow = {
      id: string; title: string; status: SiteActionStatus; due_date: string | null; due_date_status: 'explicit' | 'estimated' | null
      assigned_to: string | null; assigned_contact_id: string | null; assigned_company_id: string | null
      created_at: string | null; done_at: string | null
    }
    let actionRows: ActionRow[] = []
    if (actionIds.size > 0) {
      const { data } = await db.from('site_actions')
        .select('id, title, status, due_date, due_date_status, assigned_to, assigned_contact_id, assigned_company_id, created_at, done_at')
        .in('id', [...actionIds]).eq('site_id', siteId)
      actionRows = (data ?? []) as ActionRow[]
      for (const a of actionRows) { if (a.assigned_contact_id) contactIds.add(a.assigned_contact_id); if (a.assigned_company_id) companyIds.add(a.assigned_company_id) }
    }

    // ── Provenance documentaire des Actions (mini-lot Vincent, « provenance des
    //    Actions dans la fiche Point ») — via document_proposal_materialization,
    //    JAMAIS une heuristique : lien structuré posé à l'import historique
    //    (materialize_historical_visit). Une Action de saisie humaine/Copilote
    //    n'a simplement aucune ligne ici → sources: [] (fait honnête, pas un manque). ──
    const actionSourcesById = new Map<string, PointDetailActionSource[]>()
    // Vrai dès qu'une ligne `document_proposal_materialization` existe pour l'Action —
    // AVANT résolution proposal→document, qui peut échouer sans que ça change l'origine
    // réelle de l'Action (importée d'un PV). Sert à décider si `created_at` est fiable
    // (Film du Point, mandat Vincent 2026-09-14) : jamais utilisé si materialized=true.
    const wasMaterializedActionIds = new Set<string>()
    if (actionIds.size > 0) {
      const { data: materializationRows } = await db.from('document_proposal_materialization')
        .select('target_entity_id, proposal_id')
        .eq('target_entity_type', 'site_action')
        .in('target_entity_id', [...actionIds])
      const proposalIdByActionId = new Map<string, string[]>()
      for (const m of materializationRows ?? []) {
        const actionId = m.target_entity_id as string
        wasMaterializedActionIds.add(actionId)
        const proposalId = m.proposal_id as string | null
        if (!proposalId) continue
        const list = proposalIdByActionId.get(actionId) ?? []
        list.push(proposalId)
        proposalIdByActionId.set(actionId, list)
      }
      const sourceProposalIds = [...new Set([...proposalIdByActionId.values()].flat())]
      if (sourceProposalIds.length > 0) {
        const { data: sourceProposalRows } = await db.from('document_extraction_proposal')
          .select('id, document_id, source_page, source_excerpt').in('id', sourceProposalIds)
        const sourceProposalById = new Map((sourceProposalRows ?? []).map((r) => [r.id as string, r as {
          id: string; document_id: string | null; source_page: number | null; source_excerpt: string | null
        }]))
        const sourceDocIds = [...new Set([...sourceProposalById.values()].map((p) => p.document_id).filter((id): id is string => !!id))]
        const sourceDocById = new Map<string, { filename: string | null; document_type: string | null; effective_date: string | null }>()
        if (sourceDocIds.length > 0) {
          const { data: sourceDocRows } = await db.from('documents').select('id, filename, document_type, effective_date').in('id', sourceDocIds)
          for (const d of sourceDocRows ?? []) {
            sourceDocById.set(d.id as string, {
              filename: d.filename as string | null,
              document_type: d.document_type as string | null,
              effective_date: (d.effective_date as string | null)?.slice(0, 10) ?? null,
            })
          }
        }
        for (const [actionId, proposalIdList] of proposalIdByActionId) {
          const sources: PointDetailActionSource[] = []
          for (const proposalId of proposalIdList) {
            const proposal = sourceProposalById.get(proposalId)
            if (!proposal?.document_id) continue
            const doc = sourceDocById.get(proposal.document_id)
            if (!doc) continue
            sources.push({
              documentId: proposal.document_id,
              documentFilename: doc.filename,
              documentType: doc.document_type,
              href: documentHref({ id: proposal.document_id, document_type: doc.document_type ?? '' }, siteId),
              date: doc.effective_date,
              dateLabel: frDate(doc.effective_date),
              sourcePage: proposal.source_page,
              sourceExcerpt: proposal.source_excerpt?.trim() || null,
            })
          }
          sources.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
          if (sources.length > 0) actionSourcesById.set(actionId, sources)
        }
      }
    }

    type DeadlineRow = {
      id: string; title: string; status: DeadlineStatus; due_date: string | null
      assigned_contact_id: string | null; assigned_company_id: string | null
    }
    let deadlineRows: DeadlineRow[] = []
    if (deadlineIds.size > 0) {
      const { data } = await db.from('site_deadlines')
        .select('id, title, status, due_date, assigned_contact_id, assigned_company_id')
        .in('id', [...deadlineIds]).eq('site_id', siteId)
      deadlineRows = (data ?? []) as DeadlineRow[]
      for (const d of deadlineRows) { if (d.assigned_contact_id) contactIds.add(d.assigned_contact_id); if (d.assigned_company_id) companyIds.add(d.assigned_company_id) }
    }

    type ReserveRow = {
      id: string; label: string; status: ReserveStatus; responsible_company_id: string | null
      issued_on: string | null; lifted_at: string | null
    }
    let reserveRows: ReserveRow[] = []
    if (reserveIds.size > 0) {
      const { data } = await db.from('site_reserve')
        .select('id, label, status, responsible_company_id, issued_on, lifted_at')
        .in('id', [...reserveIds]).eq('site_id', siteId)
      reserveRows = (data ?? []) as ReserveRow[]
      for (const r of reserveRows) { if (r.responsible_company_id) companyIds.add(r.responsible_company_id) }
    }

    const contactById = new Map<string, { full_name: string; function: string | null }>()
    if (contactIds.size > 0) {
      const { data } = await db.from('company_contacts').select('id, full_name, function').in('id', [...contactIds])
      for (const c of data ?? []) contactById.set(c.id as string, { full_name: c.full_name as string, function: c.function as string | null })
    }
    const companyById = new Map<string, string>()
    if (companyIds.size > 0) {
      const { data } = await db.from('companies').select('id, name').in('id', [...companyIds])
      for (const c of data ?? []) companyById.set(c.id as string, c.name as string)
    }

    const today = todayLocalIso()
    const responsibleFor = (contactId: string | null, companyId: string | null, text: string | null): PointDetailResponsible | null => {
      if (contactId) { const c = contactById.get(contactId); if (c) return { kind: 'contact', name: c.full_name, fonction: c.function } }
      if (companyId) { const name = companyById.get(companyId); if (name) return { kind: 'company', name } }
      if (text) return { kind: 'text', label: text }
      return null
    }

    for (const a of actionRows) {
      const due = a.due_date ? a.due_date.slice(0, 10) : null
      linkedObjects.push({
        objectType: 'site_action', id: a.id, title: a.title, status: a.status, statusLabel: ACTION_STATUS_LABEL[a.status] ?? a.status,
        isDone: a.status === 'done' || a.status === 'cancelled',
        isLate: a.due_date_status === 'explicit' && due !== null && due < today && a.status !== 'done' && a.status !== 'cancelled',
        dueDate: due, dueDateLabel: frDate(due),
        responsible: responsibleFor(a.assigned_contact_id, a.assigned_company_id, a.assigned_to),
        suggestedResponsibleName: null,
        sources: actionSourcesById.get(a.id) ?? [],
        href: `${actionsHref}?actionId=${a.id}`,
        createdAt: a.created_at,
        wasMaterialized: wasMaterializedActionIds.has(a.id),
        doneAt: a.done_at,
        issuedOn: null,
        liftedAt: null,
      })
    }
    for (const d of deadlineRows) {
      const due = d.due_date ? d.due_date.slice(0, 10) : null
      const terminal = d.status === 'done' || d.status === 'cancelled' || d.status === 'superseded'
      linkedObjects.push({
        objectType: 'site_deadline', id: d.id, title: d.title, status: d.status, statusLabel: DEADLINE_STATUS_LABEL[d.status] ?? d.status,
        isDone: terminal,
        isLate: !terminal && due !== null && due < today,
        dueDate: due, dueDateLabel: frDate(due),
        responsible: responsibleFor(d.assigned_contact_id, d.assigned_company_id, null),
        suggestedResponsibleName: null,
        sources: [],
        href: `/sites/${siteId}/echeances`,
        createdAt: null,
        wasMaterialized: false,
        doneAt: null,
        issuedOn: null,
        liftedAt: null,
      })
    }
    for (const r of reserveRows) {
      linkedObjects.push({
        objectType: 'site_reserve', id: r.id, title: r.label, status: r.status, statusLabel: RESERVE_STATUS_LABEL[r.status] ?? r.status,
        isDone: r.status === 'lifted',
        isLate: false,
        dueDate: null, dueDateLabel: null,
        responsible: responsibleFor(null, r.responsible_company_id, null),
        suggestedResponsibleName: null,
        sources: [],
        href: `/sites/${siteId}/reserves`,
        createdAt: null,
        wasMaterialized: false,
        doneAt: null,
        issuedOn: r.issued_on,
        liftedAt: r.lifted_at,
      })
    }
  }
  linkedObjects.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))

  // ── §6 — acteurs explicitement liés : union des responsables des objets liés,
  //    JAMAIS une déduction (un acteur sans FK explicite n'apparaît pas ici). ──
  const actors = computePointActors(linkedObjects)
  // ── Suggestion GAP 1 (mandat Vincent, lot Point Actions inline) ────────────
  const linkedObjectsWithSuggestions = suggestResponsibleNames(linkedObjects, actors.map((a) => a.name))

  // ── §6bis — entreprises citées (mandat Vincent, lot Acteurs/entreprise citée) ──
  // Pool = toutes les entreprises identifiées comme acteur sur CE site (canonical_subject
  // kind=actor), indépendamment du casting site_intervenants — c'est précisément ce qui
  // manque à `listSiteCandidateCompanies` pour couvrir le cas Clim Exp'Air.
  type ActorCompanyRow = { company_id: string; label: string; aliases: string[] | null }
  const { data: actorCompanyRows } = await db.from('canonical_subject')
    .select('company_id, label, aliases')
    .eq('site_id', siteId).eq('kind', 'actor').eq('status', 'active').not('company_id', 'is', null)
  const citedCompanyCandidates: ActorSubject[] = ((actorCompanyRows ?? []) as ActorCompanyRow[])
    .map((r) => ({ id: r.company_id, label: r.label, aliases: r.aliases ?? [] }))
  const citedCompanies = computeCitedCompanies(
    [canonicalEntry.label, ...linkedObjects.map((o) => o.title), ...evidence.map((e) => e.sourceExcerpt)],
    citedCompanyCandidates,
    actors.map((a) => a.name),
  )
  const openLinkedObjects = linkedObjectsWithSuggestions.filter((o) => !o.isDone)
  const closedLinkedObjects = linkedObjectsWithSuggestions.filter((o) => o.isDone)

  const markerLabels = canonicalEntry.markers.map((m) => POINT_MARKER_LABEL[m] ?? m)

  // ── FILM DU POINT — « X jours · Y passages sans évolution » (mandat Vincent) ────
  // Réutilise le même calcul que le bloc lingering de Pilotage (daysSince/countPassagesAfter),
  // jamais un second calcul : un Point sans latestMeaningfulEventAt n'a simplement pas de
  // résumé de délai (silence honnête), pas une valeur fabriquée.
  const pvDates = await loadSitePvDates(siteId)
  const today = todayLocalIso()
  const daysSinceLastEvent = canonicalEntry.latestMeaningfulEventAt ? daysSince(canonicalEntry.latestMeaningfulEventAt, today) : null
  const passagesSinceLastEvent = canonicalEntry.latestMeaningfulEventAt
    ? countPassagesAfter(pvDates, canonicalEntry.latestMeaningfulEventAt)
    : null
  const film = buildPointFilm({
    trajectory,
    evidence,
    linkedObjects: linkedObjectsWithSuggestions,
    derivedStateLabel: POINT_STATE_LABEL[canonicalEntry.derivedState] ?? canonicalEntry.derivedState,
    latestMeaningfulEventAt: canonicalEntry.latestMeaningfulEventAt,
    daysSinceLastEvent,
    passagesSinceLastEvent,
    mergedFrom,
  })

  return {
    id: canonicalEntry.id,
    siteId: canonicalEntry.siteId,
    label: canonicalEntry.label,
    status: canonicalEntry.status,
    identityStatus: canonicalEntry.identityStatus,
    derivedState: canonicalEntry.derivedState,
    derivedStateLabel: POINT_STATE_LABEL[canonicalEntry.derivedState] ?? canonicalEntry.derivedState,
    headline: buildHeadline({
      derivedState: canonicalEntry.derivedState,
      documentaryDivergences: canonicalEntry.documentaryDivergences,
      conflicts: canonicalEntry.conflicts,
      openedAt,
      latestMeaningfulEventAt: canonicalEntry.latestMeaningfulEventAt,
      mentionsCount,
    }),
    createdAt,
    createdAtLabel: frDate(createdAt),
    markers: canonicalEntry.markers,
    markerLabels,
    toConfirm: canonicalEntry.toConfirm,
    hasDocumentaryDivergence: canonicalEntry.hasDocumentaryDivergence,
    hasConflict: canonicalEntry.hasConflict,
    documentaryDivergences: canonicalEntry.documentaryDivergences,
    conflicts: canonicalEntry.conflicts,
    ownerCanonicalSubjectId: canonicalEntry.ownerCanonicalSubjectId,
    ownerCanonicalSubjectLabel,
    openedAt,
    openedAtLabel: frDate(openedAt),
    latestMeaningfulEventAt: canonicalEntry.latestMeaningfulEventAt,
    latestMeaningfulEventLabel: frDate(canonicalEntry.latestMeaningfulEventAt),
    latestEvidenceAt,
    mentionsCount,
    trajectory,
    film,
    evidence,
    provenance,
    linkedObjects: linkedObjectsWithSuggestions,
    openLinkedObjects,
    closedLinkedObjects,
    openLinkedObjectGroups: groupLinkedObjectsByTitle(openLinkedObjects),
    actors,
    citedCompanies,
    foundingKind: canonicalEntry.foundingKind,
    foundingSource: canonicalEntry.foundingSource,
    hasUpstreamDefect: canonicalEntry.hasUpstreamDefect,
    cboIds: canonicalEntry.cboIds,
    hardMemberThreadIds: canonicalEntry.hardMemberThreadIds,
    canonicalPointId: canonicalEntry.canonicalPointId,
    isMergedAway,
    mergedIntoId: canonicalEntry.mergedIntoId,
    mergedFrom,
    mergeNotice,
  }
}
