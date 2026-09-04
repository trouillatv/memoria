import 'server-only'

// P1-4C2A-INTEGRATION — réducteur de cycle de vie du CBO (unité de vérité unique).
//
// Reçoit UNIQUEMENT des événements DÉJÀ scopés au même CBO (aucun matching d'intention ici :
// l'appartenance est établie en amont par l'architecture CBO). Réduit :
//   - branche NATIVE autoritative : événements du journal `site_action_events` (append-only,
//     transactionnel, `occurred_at`) — la vérité lifecycle native, PAS l'upsert lossy
//     object_state_occurrence_signal(native_action_event).
//   - branche DOCUMENTAIRE fiabilisée : résolutions B (document_completion_resolution, policy active)
//     + qualification temporelle DÉTERMINISTE (C1C) → documentary_completion_candidate.
//     Les anciens signaux document_status/llm ne décident PLUS l'état documentaire du CBO.
//
// Invariants figés : natif > documentaire (le documentaire ne renverse jamais une vérité native,
// il émet une `documentaryDivergence`) ; accomplissement ≠ obligation terminée (seule une intention
// one_shot+terminal_candidate peut produire une complétion documentaire) ; unknown/continuous ne
// deviennent jamais DONE ; complétion historique conservée lors d'une réouverture ; égalité de date
// à polarité opposée = CONFLICT (jamais l'ordre SQL) ; ordre métier indépendant de l'ordre d'import.
//
// READ-ONLY / dérivé : ne persiste rien, ne déclenche AUCUN appel LLM (le collapse d'une intention
// one_shot est trivial : effective_at = event_at ?? première attestation ; le juge C1B n'est requis
// que pour le COMPTAGE d'événements récurrents, hors périmètre de la complétion). Aucun consommateur
// branché dans ce lot.

export type CboEventKind =
  | 'native_completed' | 'native_reopened' | 'native_cancelled' | 'native_open' | 'native_progress'
  | 'doc_completion' | 'doc_open' | 'doc_conformity'

const NATIVE_KINDS = new Set<CboEventKind>(['native_completed', 'native_reopened', 'native_cancelled', 'native_open', 'native_progress'])
const NATIVE_TERMINAL = new Set<CboEventKind>(['native_completed', 'native_reopened', 'native_cancelled'])

export type CboLifecycleEvent = {
  kind: CboEventKind
  /** Date métier EXPLICITE de l'accomplissement/événement, si prouvée. */
  eventAt?: string | null
  /** Date métier du document/journal qui atteste l'événement. */
  attestedAt: string
  /** Provenance (id de proposition, id d'événement d'action). */
  source?: string
}

export type EffectiveAtBasis = 'explicit_event_date' | 'first_attestation'

export type CboComputedCurrentState =
  | 'open' | 'progressing'
  | 'documentary_completed' | 'documentary_reopened'
  | 'native_completed' | 'native_reopened' | 'native_cancelled'
  | 'conforme_at' | 'unknown' | 'conflict'

export type TrajectoryEvent = { effectiveAt: string; basis: EffectiveAtBasis; kind: CboEventKind; source?: string }

export type CboReducedState = {
  computedCurrentState: CboComputedCurrentState
  historicalTrajectory: TrajectoryEvent[]
  stateBasis: string[]
  conflicts: string[]
  documentaryDivergences: string[]
}

function effective(e: CboLifecycleEvent): TrajectoryEvent {
  const eventAt = e.eventAt ?? e.attestedAt
  return { effectiveAt: eventAt, basis: e.eventAt ? 'explicit_event_date' : 'first_attestation', kind: e.kind, source: e.source }
}
const ref = (t: TrajectoryEvent) => `${t.kind}@${t.effectiveAt}`

/**
 * Réduction PURE et déterministe. Entrée = événements CBO-scopés. Tri par date métier (`effectiveAt`),
 * jamais l'ordre d'insertion → un import rétroactif inséré entre deux événements est absorbé sans
 * dépendre de l'ordre d'arrivée. Priorité native : une fois une vérité native terminale posée, le
 * documentaire ne la renverse jamais — il émet une divergence.
 */
export function reduceCboLifecycle(events: CboLifecycleEvent[]): CboReducedState {
  const traj = events.map(effective).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.kind.localeCompare(b.kind))
  const byDate = new Map<string, TrajectoryEvent[]>()
  for (const t of traj) { const l = byDate.get(t.effectiveAt) ?? []; l.push(t); byDate.set(t.effectiveAt, l) }

  let state: CboComputedCurrentState = 'unknown'
  let basis: TrajectoryEvent[] = []
  const conflicts: string[] = []
  const divergences: string[] = []
  let nativeLocked: CboComputedCurrentState | null = null
  const hasDocCompletion = () => state === 'documentary_completed'

  for (const date of [...byDate.keys()].sort()) {
    const group = byDate.get(date)!
    const nat = group.filter((t) => NATIVE_KINDS.has(t.kind))
    const doc = group.filter((t) => !NATIVE_KINDS.has(t.kind))

    if (nat.length) {
      const kinds = new Set(nat.map((t) => t.kind))
      if (kinds.has('native_completed') && (kinds.has('native_open') || kinds.has('native_reopened'))) {
        state = 'conflict'; conflicts.push(`événements natifs contradictoires à ${date}`); basis = nat
      } else if (kinds.has('native_reopened')) { state = 'native_reopened'; basis = nat.filter((t) => t.kind === 'native_reopened') }
      else if (kinds.has('native_cancelled')) { state = 'native_cancelled'; basis = nat.filter((t) => t.kind === 'native_cancelled') } // D2 : jamais completed
      else if (kinds.has('native_completed')) { state = 'native_completed'; basis = nat.filter((t) => t.kind === 'native_completed') }
      else if (kinds.has('native_open')) { state = hasDocCompletion() ? 'native_reopened' : 'open'; basis = nat }
      else if (kinds.has('native_progress')) { state = 'progressing'; basis = nat }
      if (NATIVE_TERMINAL.has([...kinds][0]) || [...kinds].some((k) => NATIVE_TERMINAL.has(k))) nativeLocked = state
      if (doc.length) divergences.push(`documentaire à ${date} subordonné au natif (${doc.map((d) => d.kind).join(',')})`)
      continue
    }

    // uniquement documentaire à cette date
    const comp = doc.find((t) => t.kind === 'doc_completion')
    const open = doc.find((t) => t.kind === 'doc_open')
    const conf = doc.find((t) => t.kind === 'doc_conformity')

    if (nativeLocked) {
      // le documentaire ne renverse jamais une vérité native terminale → uniquement divergence
      if (open && nativeLocked === 'native_completed') divergences.push(`PV ${date} suggère une réouverture (natif=completed, non renversé)`)
      else if (comp && nativeLocked === 'native_reopened') divergences.push(`PV ${date} suggère une complétion (natif=reopened, non renversé)`)
      continue
    }

    if (comp && open) { state = 'conflict'; conflicts.push(`même date ${date} : completion + open documentaires, ordre indéterminable → CONFLICT`); basis = [comp, open] }
    else if (comp) { state = 'documentary_completed'; basis = [comp] }
    else if (open) { state = hasDocCompletion() ? 'documentary_reopened' : 'open'; basis = [open] }
    else if (conf) { if (!hasDocCompletion()) { state = 'conforme_at'; basis = [conf] } }
  }

  return { computedCurrentState: state, historicalTrajectory: traj, stateBasis: basis.map(ref), conflicts, documentaryDivergences: divergences }
}

// ─────────────────────────────────────────────────────────────────────────────
// Qualification temporelle DÉTERMINISTE (C1C) — discriminant positif, unknown par défaut.
// Aucun LLM. « verbe seul » proscrit sauf l'intention explicite de MAINTIEN (obligation continue).
// ─────────────────────────────────────────────────────────────────────────────
export type CboNature = 'one_shot' | 'recurring' | 'continuous' | 'unknown'
export type StateChar = 'terminal_candidate' | 'regression_sensitive' | 'point_in_time_only' | 'unknown'

const MAINTENANCE = /(maintenir|garder|conserver|tenir)\b.*(exempt|d[ée]gag|libre|propre|à jour)/i
const REPEATABLE = /(v[ée]rifier|contr[ôo]ler|test|exercice|inspection|dotation|nombre)/i
const TELIC = /^(r[ée]diger|supprimer|poser|installer|reprendre|remplacer|mettre en place|d[ée]poser)/i
// Régressabilité PROUVÉE seulement par une intention de placement d'effectif : verbe de placement
// + objet « personnel/SSIAP/agent/présence ». Un livrable documentaire À PROPOS du personnel
// (« Rédiger les fiches de poste … SSIAP ») n'est PAS régressable — il reste terminal_candidate.
const STAFFING_PLACEMENT = /(mettre en place|affecter|embaucher|recruter|d[ée]signer|nommer|assurer)\b.*(ssiap|personnel|agent|pr[ée]sence|effectif|poste de s[ée]curit[ée])/i

/** Nature de l'intention à partir de son libellé (corpus durable) + nombre d'événements distincts confirmés. */
export function deriveCboNature(intentionLabel: string, distinctEventsEstablished: number): { nature: CboNature; stateChar: StateChar } {
  if (distinctEventsEstablished >= 2) {
    const continuous = MAINTENANCE.test(intentionLabel)
    return { nature: continuous ? 'continuous' : 'recurring', stateChar: 'point_in_time_only' }
  }
  if (MAINTENANCE.test(intentionLabel)) return { nature: 'continuous', stateChar: 'point_in_time_only' }
  if (REPEATABLE.test(intentionLabel)) return { nature: 'unknown', stateChar: 'unknown' } // acte répétable + 1 événement : one-shot vs récurrent non tranchable
  if (TELIC.test(intentionLabel)) {
    const regress = STAFFING_PLACEMENT.test(intentionLabel)
    return { nature: 'one_shot', stateChar: regress ? 'unknown' : 'terminal_candidate' } // régressabilité non prouvée par le corpus → unknown
  }
  return { nature: 'unknown', stateChar: 'unknown' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assemblage PUR des événements d'un CBO à partir de ses sources déjà collectées (aucune DB).
// Isole toute la logique décisionnelle du plomberie SQL (loadCboReducedStates), donc testable seul.
// ─────────────────────────────────────────────────────────────────────────────

/** Membre site_action déjà résolu à sa provenance. `date`/`docId` null = dangling ou chaîne incomplète. */
export type CboMemberProvenance = { memberId: string; docId: string | null; date: string | null }
/** Complétion documentaire effective (B HIGH) avec sa provenance. */
export type CboCompletionProof = { proposalId: string; docId: string | null; date: string | null }
/** Événement natif brut du journal (kind = vocabulaire site_action_events). */
export type CboNativeJournalEvent = { kind: string; occurredAt: string | null }

export type AssembledCbo = {
  events: CboLifecycleEvent[]
  nature: { nature: CboNature; stateChar: StateChar }
  documentaryHighCount: number
  suppressedByNature: number
  docOpenCount: number
  membersSharedWithCompletionDoc: number
}

/** `created` EXCLU : son occurred_at est l'horloge d'import (date technique), pas une date métier. */
export function nativeKindOf(journalKind: string): CboEventKind | null {
  switch (journalKind) {
    case 'completed': return 'native_completed'
    case 'reopened': return 'native_reopened'
    case 'cancelled': return 'native_cancelled'
    case 'progress': return 'native_progress'
    default: return null // created (import bookkeeping), due_date_changed, autres non lifecycle
  }
}

const day = (s: string | null | undefined) => (s ?? '').slice(0, 10)

/**
 * Compose la frise d'un CBO :
 *  - complétion documentaire seulement si C1C = one_shot+terminal (sinon suppressed) et datable ;
 *  - doc_open = chaque membre datable, SAUF ceux issus d'un document de complétion retenu
 *    (règle de provenance : le PV qui clôture ne produit pas un doc_open concurrent — cas Éclairage) ;
 *  - natif : completed/reopened/cancelled/progress datés (created exclu).
 * Tri/priorité/verrou = reduceCboLifecycle (dates métier uniquement).
 */
export function assembleCboEvents(
  label: string,
  members: CboMemberProvenance[],
  completions: CboCompletionProof[],
  natives: CboNativeJournalEvent[],
): AssembledCbo {
  const events: CboLifecycleEvent[] = []
  const nature = deriveCboNature(label, 1) // récurrence prouvée = C1B, hors périmètre → 1
  const eligible = nature.nature === 'one_shot' && nature.stateChar === 'terminal_candidate'

  let suppressed = 0
  const completionDocIds = new Set<string>()
  for (const c of completions) {
    if (!eligible) { suppressed++; continue }
    const at = day(c.date)
    if (!at) { suppressed++; continue } // preuve non datable → non exploitable comme complétion
    if (c.docId) completionDocIds.add(c.docId)
    events.push({ kind: 'doc_completion', attestedAt: at, eventAt: at, source: `proposal:${c.proposalId}` })
  }

  let docOpenCount = 0, shared = 0
  for (const m of members) {
    if (!m.date || !m.docId) continue // dangling / chaîne incomplète → jamais d'open inventé
    if (completionDocIds.has(m.docId)) { shared++; continue }
    events.push({ kind: 'doc_open', attestedAt: day(m.date), eventAt: day(m.date), source: `member:${m.memberId}` })
    docOpenCount++
  }

  for (const ev of natives) {
    const kind = nativeKindOf(ev.kind); if (!kind) continue
    const at = day(ev.occurredAt); if (!at) continue
    events.push({ kind, attestedAt: at, eventAt: at, source: 'journal' })
  }

  return { events, nature, documentaryHighCount: completions.length, suppressedByNature: suppressed, docOpenCount, membersSharedWithCompletionDoc: shared }
}

// ─────────────────────────────────────────────────────────────────────────────
// P1-4C2D — agrégat SUJET ← CBO. Traduit les CboReducedState des CBO ACTION d'un sujet en une
// grandeur d'ACTIVITÉ DURABLE, destinée à remplacer la SEULE contribution « action » de
// `activeObjectsTotal` dans deriveCanonicalCurrentState (P0-2). Ne recalcule PAS C2A, ne remplace
// PAS P0-2 : les occurrences documentaires du sujet restent la preuve OPEN/RESOLVED/UNKNOWN.
//
// Sémantique figée (C2C) :
//   - actif : open | documentary_reopened | native_reopened | progressing
//   - non actif : documentary_completed | native_completed | native_cancelled | conforme_at
//   - conflict : bloque une résolution silencieuse (compté à part, `blocksResolution`)
//   - unknown : neutre — ne fabrique ni activité ni résolution (la preuve occurrence décide)
//   - documentaryDivergence : conservée pour la provenance, ne renverse jamais le natif.
// ─────────────────────────────────────────────────────────────────────────────

const SUBJECT_ACTIVE_STATES = new Set<CboComputedCurrentState>(['open', 'progressing', 'documentary_reopened', 'native_reopened'])
const SUBJECT_TERMINAL_STATES = new Set<CboComputedCurrentState>(['documentary_completed', 'native_completed', 'native_cancelled', 'conforme_at'])

export type SubjectCboState = {
  /** CBO action en état actif (open/reopened/progressing). */
  activeCboTotal: number
  /** CBO action terminés (completed/cancelled/conforme). */
  completedCboTotal: number
  /** CBO action en état unknown (neutre). */
  unknownCboTotal: number
  /** CBO action en conflit (bloque une résolution silencieuse). */
  conflictCboTotal: number
  /** Nombre total de CBO action du sujet (0 = aucun CBO → l'appelant retombe sur la vérité brute). */
  totalCboTotal: number
  /** Vrai si ≥1 CBO actif OU en conflit : le sujet ne peut pas être silencieusement résolu par le CBO. */
  blocksResolution: boolean
  conflicts: string[]
  documentaryDivergences: string[]
  stateBasis: string[]
}

/**
 * Contribution objet à l'état COURANT (entrée `activeObjectsTotal` de P0-2), composée :
 *  - ACTION : lifecycle CBO durable (`blocksResolution` = ≥1 actif OU conflit) DÈS QUE le sujet a des
 *    CBO action ; sinon vérité brute des actions (aucun CBO → ne jamais perdre d'activité non modélisée).
 *  - NON-ACTION (réserve/échéance/décision) : projection brute inchangée.
 * Retourne 1/0 (contrat isProvenOpen). Ne fabrique jamais de résolution : une occurrence OPEN reste
 * portée par deriveCanonicalCurrentState.
 */
export function activeObjectsTotalForState(
  subjectCbo: SubjectCboState | undefined,
  rawActionOpen: boolean,
  nonActionOpen: boolean,
): number {
  const actionActive = subjectCbo && subjectCbo.totalCboTotal > 0 ? subjectCbo.blocksResolution : rawActionOpen
  return actionActive || nonActionOpen ? 1 : 0
}

/** Agrège les CboReducedState des CBO action d'UN sujet. Pur, déterministe. */
export function deriveCanonicalSubjectCboState(states: CboReducedState[]): SubjectCboState {
  let active = 0, completed = 0, unknown = 0, conflict = 0
  const conflicts: string[] = [], divergences: string[] = [], basis: string[] = []
  for (const s of states) {
    const st = s.computedCurrentState
    if (st === 'conflict') conflict++
    else if (SUBJECT_ACTIVE_STATES.has(st)) active++
    else if (SUBJECT_TERMINAL_STATES.has(st)) completed++
    else unknown++ // 'unknown' — neutre
    if (s.conflicts.length) conflicts.push(...s.conflicts)
    if (s.documentaryDivergences.length) divergences.push(...s.documentaryDivergences)
    if (s.stateBasis.length) basis.push(...s.stateBasis)
  }
  return {
    activeCboTotal: active, completedCboTotal: completed, unknownCboTotal: unknown, conflictCboTotal: conflict,
    totalCboTotal: states.length, blocksResolution: active > 0 || conflict > 0,
    conflicts, documentaryDivergences: divergences, stateBasis: basis,
  }
}
