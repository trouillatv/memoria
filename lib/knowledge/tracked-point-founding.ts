// P6 Live Writer — Phase 2 : extraction fidèle de la doctrine de fondation.
//
// Portage à l'identique (zero behavior change) de la logique pure de
// scripts/_p6d1a-preflight-global.ts (elle-même copie fidèle de Phase 5E
// scripts/_p5e-trackability-audit.ts) : decideFoundingOld → classifyTrackabilityContent
// → decideFoundingV2 → buildFoundingUnits. Aucune requête DB ici — ces fonctions sont
// pures et reçoivent leurs données déjà chargées par l'appelant (script offline ou,
// pour le Live Writer, le lecteur temps réel).
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md §7 (source mapping).

import { documentStatusToPvState } from '@/lib/documents/subject-state'

// ── Types d'entrée — mêmes champs que document_extraction_proposal, sous-ensemble
//    utilisé par la doctrine de fondation et le plan d'écriture en aval. ──────────────
export type PropRow = {
  id: string
  proposal_family: string
  document_status: string | null
  label: string
  subject_thread_id: string | null
  document_id: string | null
  extraction_run_id: string | null
  created_at: string
  review_status: string | null
  source_payload: unknown
}

// ── Doctrine V1 — copie fidèle de Phase 5E (frozen, ne pas modifier). ──────────────

export type FoundingOutcomeKindOld =
  | 'CONFIRMED' | 'PROVISIONAL' | 'RESOLUTION_WITHOUT_KNOWN_PROBLEM'
  | 'NO_POINT_KNOWLEDGE_ONLY' | 'NO_POINT_EMPTY_THREAD' | 'UNCOVERED_FAMILY_COMBINATION'

export function decideFoundingOld(
  props: { proposal_family: string; document_status: string | null }[],
  singleCboId: string | null,
): { kind: FoundingOutcomeKindOld; cboId?: string; triggerFamily?: string; families?: string[] } {
  if (singleCboId) return { kind: 'CONFIRMED', cboId: singleCboId }
  if (props.length === 0) return { kind: 'NO_POINT_EMPTY_THREAD' }
  const families = new Set(props.map((p) => p.proposal_family))
  if (families.has('decision')) return { kind: 'PROVISIONAL', triggerFamily: 'decision' }
  if (families.has('reservation')) return { kind: 'PROVISIONAL', triggerFamily: 'reservation' }
  if (families.has('observation')) {
    const obsOpen = props.some((p) => p.proposal_family === 'observation' && documentStatusToPvState(p.document_status) === 'open')
    if (obsOpen) return { kind: 'PROVISIONAL', triggerFamily: 'observation' }
  }
  const nonKnowledge = [...families].filter((f) => f !== 'knowledge_fact')
  if (nonKnowledge.length === 0 && families.has('knowledge_fact')) {
    const anyResolved = props.some((p) => p.proposal_family === 'knowledge_fact' && documentStatusToPvState(p.document_status) === 'resolved')
    return anyResolved ? { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' } : { kind: 'NO_POINT_KNOWLEDGE_ONLY' }
  }
  return { kind: 'UNCOVERED_FAMILY_COMBINATION', families: [...families] }
}

// ── Trackability V2 — copie fidèle de Phase 5E V2 (frozen, ne pas modifier). ────────

export type TrackabilityCategory = 'TRACKABLE_CONDITION' | 'CONTEXT_ONLY' | 'ACTOR_ONLY' | 'TEMPORAL_ONLY' | 'RESOLUTION_SIGNAL_ONLY' | 'UNDETERMINED'

export const ACTIONABLE_FAMILIES = new Set(['action', 'deadline', 'planning'])
export const ACTOR_FAMILIES = new Set(['person', 'company'])

export function relevanceOf(p: PropRow): string | null {
  const sp = p.source_payload as { relevanceScore?: string } | null
  return sp?.relevanceScore ?? null
}

export function classifyTrackabilityContent(props: PropRow[]): TrackabilityCategory {
  if (props.length === 0) return 'UNDETERMINED'
  const onlyActor = props.every((p) => ACTOR_FAMILIES.has(p.proposal_family))
  if (onlyActor) return 'ACTOR_ONLY'
  const allResolved = props.every((p) => documentStatusToPvState(p.document_status) === 'resolved')
  if (allResolved) return 'RESOLUTION_SIGNAL_ONLY'
  const actionable = props.filter((p) => ACTIONABLE_FAMILIES.has(p.proposal_family))
  const actionableStrongOrMedium = actionable.filter((p) => { const r = relevanceOf(p); return r === 'strong' || r === 'medium' })
  if (actionableStrongOrMedium.length > 0) return 'TRACKABLE_CONDITION'
  const deadlineWeakOnly = actionable.length > 0 && actionable.every((p) => p.proposal_family === 'deadline' && relevanceOf(p) === 'weak')
  if (deadlineWeakOnly) return 'TEMPORAL_ONLY'
  if (actionable.length > 0) return 'CONTEXT_ONLY'
  return 'UNDETERMINED'
}

export type FoundingOutcomeV2 =
  | { kind: 'CONFIRMED'; cboId: string }
  | { kind: 'PROVISIONAL'; triggerFamily: string }
  | { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' }
  | { kind: 'NO_POINT_KNOWLEDGE_ONLY' }
  | { kind: 'NO_POINT_EMPTY_THREAD' }
  | { kind: 'PROVISIONAL_TRACKABLE'; trackability: 'TRACKABLE_CONDITION' }
  | { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY' }
  | { kind: 'EXCLUDED_ACTOR_CONTEXT_TEMPORAL'; trackability: TrackabilityCategory }
  | { kind: 'PENDING_TRACKABILITY' }

export function decideFoundingV2(props: PropRow[], singleCboId: string | null): { outcome: FoundingOutcomeV2; trackability?: TrackabilityCategory } {
  const old = decideFoundingOld(props, singleCboId)
  if (old.kind !== 'UNCOVERED_FAMILY_COMBINATION') return { outcome: old as FoundingOutcomeV2 }
  const trackability = classifyTrackabilityContent(props)
  switch (trackability) {
    case 'TRACKABLE_CONDITION': return { outcome: { kind: 'PROVISIONAL_TRACKABLE', trackability: 'TRACKABLE_CONDITION' }, trackability }
    case 'RESOLUTION_SIGNAL_ONLY': return { outcome: { kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY' }, trackability }
    case 'CONTEXT_ONLY': case 'ACTOR_ONLY': case 'TEMPORAL_ONLY':
      return { outcome: { kind: 'EXCLUDED_ACTOR_CONTEXT_TEMPORAL', trackability }, trackability }
    case 'UNDETERMINED': default:
      return { outcome: { kind: 'PENDING_TRACKABILITY' }, trackability: 'UNDETERMINED' }
  }
}

// ── Founding units — reproduction fidèle de la boucle 5E/6C (scope thread + proposal_set). ──

export type FoundingUnit = {
  threadId: string; scope: 'thread' | 'proposal_set'; proposalSetOf?: string
  props: PropRow[]; families: string[]
  threadLabel: string
  outcomeOld: FoundingOutcomeKindOld
  outcomeV2: FoundingOutcomeV2
  trackability?: TrackabilityCategory
}

/**
 * Sous-ensemble minimal de FullSiteData (scripts/_p6d1a-preflight-global.ts) requis par
 * buildFoundingUnits — délibérément plus étroit que le type de chargement DB complet pour
 * ne pas coupler la primitive pure à l'orchestration de lecture (site, CBO labels, etc.).
 * Un objet FullSiteData réel satisfait structurellement cette interface.
 */
export type FoundingUnitsInput = {
  threads: Array<{ threadId: string; label: string }>
  propsByThread: Map<string, PropRow[]>
  threadToCbos: Map<string, Set<string>>
  proposalToCbos: Map<string, Set<string>>
}

export function buildFoundingUnits(sd: FoundingUnitsInput): FoundingUnit[] {
  const units: FoundingUnit[] = []
  for (const t of sd.threads) {
    const props = sd.propsByThread.get(t.threadId) ?? []
    const cboSet = sd.threadToCbos.get(t.threadId) ?? new Set<string>()

    if (cboSet.size <= 1) {
      const singleCboId = cboSet.size === 1 ? [...cboSet][0] : null
      const old = decideFoundingOld(props, singleCboId)
      const v2 = singleCboId ? { outcome: old as FoundingOutcomeV2 } : decideFoundingV2(props, null)
      units.push({
        threadId: t.threadId, scope: 'thread', props,
        families: [...new Set(props.map((p) => p.proposal_family))].sort(),
        threadLabel: t.label,
        outcomeOld: old.kind, outcomeV2: v2.outcome, trackability: v2.trackability,
      })
      continue
    }

    const propsByCbo = new Map<string, PropRow[]>()
    const orphanProps: PropRow[] = []
    for (const p of props) {
      const pcbos = sd.proposalToCbos.get(p.id)
      if (!pcbos || pcbos.size === 0) { orphanProps.push(p); continue }
      for (const cid of pcbos) {
        const l = propsByCbo.get(cid) ?? []
        l.push(p)
        propsByCbo.set(cid, l)
      }
    }
    for (const [cid, subset] of propsByCbo) {
      const old = decideFoundingOld(subset, cid)
      units.push({
        threadId: t.threadId, scope: 'proposal_set', proposalSetOf: `cbo:${cid}`, props: subset,
        families: [...new Set(subset.map((p) => p.proposal_family))].sort(),
        threadLabel: t.label,
        outcomeOld: old.kind, outcomeV2: old as FoundingOutcomeV2,
      })
    }
    if (orphanProps.length > 0) {
      const old = decideFoundingOld(orphanProps, null)
      const v2 = decideFoundingV2(orphanProps, null)
      units.push({
        threadId: t.threadId, scope: 'proposal_set', proposalSetOf: 'orphan', props: orphanProps,
        families: [...new Set(orphanProps.map((p) => p.proposal_family))].sort(),
        threadLabel: t.label,
        outcomeOld: old.kind, outcomeV2: v2.outcome, trackability: v2.trackability,
      })
    }
  }
  return units
}
