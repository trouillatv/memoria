import 'server-only'

// Phase 2 (programme Point de suivi) — réducteur de cycle de vie du Point. Contrat
// P0-1G/P0-1H (Gate 4, table de vérité 12 lignes). PUR : aucune lecture DB, aucun appel LLM.
//
// Consomme des événements DÉJÀ structurés (le rattachement/l'appartenance est établi en
// amont — Phase 4, membership READ-ONLY) et, pour chaque CBO membre, son `CboReducedState`
// DÉJÀ réduit (P1-4C2A). Le Point ne ré-arbitre JAMAIS l'intérieur d'un CBO : il consomme
// `computedCurrentState` tel quel (Gate 4, principe préalable).
//
// Deux étages délibérément NON fusionnés :
//   1. réduction NATIVE du Point — décisions + signaux documentaires propres au Point,
//      réduits chronologiquement par date métier (symétrique de `reduceCboLifecycle`) ;
//   2. composition avec le VERDICT du/des CBO membre(s) — appliquée comme un instantané
//      APRÈS l'étage 1, jamais injectée dans la même frise chronologique. Une preuve
//      documentaire ancienne au niveau Point combinée à un CBO membre encore actif doit
//      produire une divergence visible (ligne 3), jamais une fausse résolution obtenue en
//      mélangeant les deux échelles de temps dans un seul tri.
//
// Table de vérité de référence : P0-1H-GATES-POINT-DE-SUIVI.md § Gate 4 (12 lignes),
// rejouée intégralement par les tests.

import type { CboReducedState, CboComputedCurrentState } from './cbo-lifecycle-reducer'

export type PointDecisionEventKind = 'intent_set' | 'decision_pending' | 'no_action_decided'
export type PointDocEventKind = 'resolution_signal' | 'open_signal' | 'resolution_claimed'
export type PointEventKind = PointDecisionEventKind | PointDocEventKind

export type PointLifecycleEvent = {
  kind: PointEventKind
  /** Date métier explicite de l'événement, si prouvée. */
  eventAt?: string | null
  /** Date d'attestation (document/décision) — fallback si eventAt absent. */
  attestedAt: string
  source?: string
}

export type PointCboMember = { cboId: string; reduced: CboReducedState }

export type PointComputedCurrentState = 'unknown' | 'open' | 'resolved' | 'reopened' | 'conflict'
export type PointMarker = 'to_confirm' | 'closed_by_decision' | 'awaiting_decision' | 'documentaryDivergence'

export type PointTrajectoryEvent = { effectiveAt: string; basis: 'explicit_event_date' | 'first_attestation'; kind: PointEventKind; source?: string }

export type PointReducedState = {
  computedCurrentState: PointComputedCurrentState
  markers: PointMarker[]
  historicalTrajectory: PointTrajectoryEvent[]
  stateBasis: string[]
  conflicts: string[]
  documentaryDivergences: string[]
}

const RESOLVE_KINDS = new Set<PointEventKind>(['resolution_signal', 'no_action_decided'])
const MARKER_OF: Partial<Record<PointEventKind, PointMarker>> = {
  no_action_decided: 'closed_by_decision',
  decision_pending: 'awaiting_decision',
  resolution_claimed: 'to_confirm',
}

function effective(e: PointLifecycleEvent): PointTrajectoryEvent {
  const at = e.eventAt ?? e.attestedAt
  return { effectiveAt: at, basis: e.eventAt ? 'explicit_event_date' : 'first_attestation', kind: e.kind, source: e.source }
}
const ref = (t: PointTrajectoryEvent) => `${t.kind}@${t.effectiveAt}`

type NativeResult = {
  state: 'unknown' | 'open' | 'resolved' | 'reopened' | 'conflict'
  markers: Set<PointMarker>
  trajectory: PointTrajectoryEvent[]
  basisRefs: string[]
  conflicts: string[]
}

/**
 * Étage 1 — réduction chronologique PURE des événements propres au Point (décisions +
 * signaux documentaires). Symétrique de `reduceCboLifecycle` ; n'implique aucun CBO.
 */
function reduceNative(events: PointLifecycleEvent[]): NativeResult {
  const traj = events.map(effective).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.kind.localeCompare(b.kind))
  const byDate = new Map<string, PointTrajectoryEvent[]>()
  for (const t of traj) { const l = byDate.get(t.effectiveAt) ?? []; l.push(t); byDate.set(t.effectiveAt, l) }

  let state: NativeResult['state'] = 'unknown'
  let markers = new Set<PointMarker>()
  let basis: PointTrajectoryEvent[] = []
  let everResolved = false
  const conflicts: string[] = []

  for (const date of [...byDate.keys()].sort()) {
    const group = byDate.get(date)!
    const resolveEvents = group.filter((t) => RESOLVE_KINDS.has(t.kind))
    const openEvents = group.filter((t) => !RESOLVE_KINDS.has(t.kind))

    if (resolveEvents.length && openEvents.length) {
      state = 'conflict'
      conflicts.push(`résolution et ouverture à la même date ${date} — ordre indéterminable`)
      basis = [...resolveEvents, ...openEvents]
      markers = new Set()
      continue
    }
    if (resolveEvents.length) {
      state = 'resolved'
      everResolved = true
      basis = resolveEvents
      markers = new Set(resolveEvents.map((t) => MARKER_OF[t.kind]).filter((m): m is PointMarker => !!m))
      continue
    }
    if (openEvents.length) {
      state = everResolved ? 'reopened' : 'open'
      basis = openEvents
      markers = new Set(openEvents.map((t) => MARKER_OF[t.kind]).filter((m): m is PointMarker => !!m))
    }
  }

  return { state, markers, trajectory: traj, basisRefs: basis.map(ref), conflicts }
}

type CboVerdict = 'resolved' | 'open' | 'reopened' | 'conflict' | null

const CBO_RESOLVING = new Set<CboComputedCurrentState>(['native_completed', 'documentary_completed', 'conforme_at', 'native_cancelled'])
const CBO_REOPENING = new Set<CboComputedCurrentState>(['native_reopened', 'documentary_reopened'])
const CBO_BLOCKING = new Set<CboComputedCurrentState>(['open', 'progressing'])

function classifyCbo(s: CboComputedCurrentState): 'resolving' | 'reopening' | 'blocking' | 'conflict' | 'neutral' {
  if (s === 'conflict') return 'conflict'
  if (CBO_REOPENING.has(s)) return 'reopening'
  if (CBO_BLOCKING.has(s)) return 'blocking'
  if (CBO_RESOLVING.has(s)) return 'resolving'
  return 'neutral' // unknown
}

/**
 * Verdict combiné des CBO membres du Point — instantané, jamais fusionné dans la frise
 * chronologique de l'étage 1 (Gate 4 : "le Point ne ré-arbitre jamais l'intérieur d'un CBO").
 */
function cboVerdict(members: PointCboMember[]): CboVerdict {
  if (!members.length) return null
  const classes = members.map((m) => classifyCbo(m.reduced.computedCurrentState))
  if (classes.includes('conflict')) return 'conflict'
  if (classes.includes('reopening')) return 'reopened'
  const resolving = classes.includes('resolving')
  const blocking = classes.includes('blocking')
  if (resolving && blocking) return 'conflict' // CBO membres en désaccord — à re-juger, jamais silencieux
  if (blocking) return 'open'
  if (resolving) return 'resolved'
  return null // tout neutre (unknown)
}

/**
 * Réducteur pur du Point de suivi (Gate 4, table de vérité 12 lignes).
 *
 * `decisions`/`docs` : événements propres au Point (décisions Gate 2 + signaux documentaires).
 * `cboMembers` : CBO membres DÉJÀ réduits (`CboReducedState`, P1-4C2A) — jamais recalculés ici.
 */
export function reduceTrackedPointLifecycle(
  decisions: PointLifecycleEvent[],
  docs: PointLifecycleEvent[],
  cboMembers: PointCboMember[],
): PointReducedState {
  const native = reduceNative([...decisions, ...docs])
  const verdict = cboVerdict(cboMembers)
  const conflicts = [...native.conflicts]
  const divergences: string[] = []
  let markers = new Set(native.markers)
  let state: PointComputedCurrentState = native.state

  if (native.state === 'conflict') {
    // ligne 11 — déjà tranché par l'étage 1 (même date, résolution + ouverture). Rien à composer.
  } else if (verdict === 'conflict') {
    state = 'conflict'
    conflicts.push('CBO membres en désaccord (résolu et actif simultanément) — à re-juger')
  } else if (native.state === 'reopened') {
    // ligne 6 ("tout") — la propre trajectoire du Point (ouverture après résolution) prime toujours.
  } else if (verdict === 'reopened' && native.state !== 'open') {
    // ligne 5 — natif CBO reopened postérieur ; la résolution documentaire reste dans l'historique.
    state = 'reopened'
  } else if (native.state === 'resolved') {
    if (verdict === 'open') {
      // ligne 3 — le documentaire/décision ne ferme JAMAIS silencieusement un CBO natif actif.
      state = 'open'
      markers = new Set([...markers, 'documentaryDivergence'])
      divergences.push('preuve de résolution au niveau Point, CBO membre encore actif — divergence visible')
    }
    // sinon (verdict null ou 'resolved') : concordance ou CBO muet — lignes 2/4, resolved conservé.
  } else if (native.state === 'open') {
    // lignes 8/10 — rien côté CBO ne referme silencieusement un Point ouvert par ses propres signaux.
  } else if (native.state === 'unknown') {
    // ligne 12 (aucun signal Point) — le Point n'a que son/ses CBO membre(s), consommé tel quel
    // (étalon RIA "listing/plan" : Point à CBO seul, aucune ré-arbitration).
    if (verdict === 'resolved') state = 'resolved'
    else if (verdict === 'open') state = 'open'
    else if (verdict === 'reopened') state = 'reopened'
  }

  return {
    computedCurrentState: state,
    markers: [...markers],
    historicalTrajectory: native.trajectory,
    stateBasis: native.basisRefs,
    conflicts,
    documentaryDivergences: divergences,
  }
}
