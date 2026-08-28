import 'server-only'

// P0-2 — Primitive PARTAGÉE de trajectoire d'occurrences (source de vérité unique pour Tension,
// Chronologie et Lignes de vie). Elle expose des FAITS NEUTRES par (sujet, run) ; chaque read-model
// fait ensuite SA projection. Elle ne contient AUCUNE conclusion de présentation.
//
// Invariant non négociable (doctrine R-1 / P0-1) : une absence d'occurrence à un document ne constitue
// AUCUN événement d'état. Le dernier état PROUVÉ est REPORTÉ (carry-forward) ; jamais
// open → unknown → unknown → resolved. `isMentioned` reste exposé pour distinguer « état porté » (proven)
// de « preuve observée à cet instant » (observedTriState).

import type { PvState } from './subject-state'
import { deriveCurrentResolvedState } from './subject-state'
import { computeHistoryTransition, canonicalRunsForSite, runEffectiveDate } from './pv-history'
import type { HistoryTransition } from './pv-history'

export type ProvenState = 'open' | 'resolved' | null

/** Occurrence atomique d'un sujet à un run (matière neutre). */
export interface RunOccurrence {
  stateStatus: PvState        // tri-state R-1 (resolved | open | unknown)
  stateKey: string            // = famille (discriminateur d'état)
  label: string
  note: string | null
  eventDate: string | null    // date propre du fait (position), ou null
  sourcePage: number | null
  evidenceCount: number
}

/** Une cellule = l'état d'UN sujet à UN run. `null` (dans le tableau) = antérieur à la 1re apparition. */
export interface OccTimelineCell {
  runId: string
  documentId: string
  effectiveDate: string             // date documentaire du PV
  isMentioned: boolean              // ≥1 occurrence à ce run (preuve observée)
  observedTriState: PvState | null  // tri-state observé CE run (null si non mentionné)
  eventDate: string | null          // plus petite event_date des occurrences du run (position)
  previousProvenState: ProvenState  // dernier état prouvé AVANT ce run
  currentProvenState: ProvenState   // dernier état prouvé APRÈS ce run (= previous si non mentionné)
  transition: HistoryTransition | null // entre l'état prouvé antérieur et l'observation (null = 1re / gap géré)
  label: string | null              // label primaire du run (ou null pour un gap)
  stateKey: string | null           // famille primaire du run
  sourcePage: number | null
  evidenceCount: number
  isGap: boolean                    // sujet connu mais NON mentionné à ce run
}

const FAMILY_ORDER = ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company']
const famRank = (f: string) => { const i = FAMILY_ORDER.indexOf(f); return i < 0 ? FAMILY_ORDER.length : i }
// Tri-state → pseudo-statut brut pour réutiliser computeHistoryTransition sans la modifier
// (le tri-state ne distingue pas cancelled/non_compliant/planned → pas de annulé/aggravé/progressé).
const stateToPseudo = (s: PvState): string | null => (s === 'resolved' ? 'done' : s === 'open' ? 'open' : null)
const toProven = (b: boolean | null): ProvenState => (b === true ? 'resolved' : b === false ? 'open' : null)

/**
 * Cœur PUR : à partir de la suite ordonnée des runs (chacun portant 0..N occurrences du sujet),
 * produit une cellule par run. Report du dernier état prouvé ; l'unknown et la non-mention ne
 * changent pas l'état porté. Reproduit la sémantique occurrence de getCanonicalSubjectLife.
 */
export function buildOccurrenceCells(
  runs: Array<{ runId: string; documentId: string; effectiveDate: string; occs: RunOccurrence[] }>,
): Array<OccTimelineCell | null> {
  const firstIdx = runs.findIndex((r) => r.occs.length > 0)
  if (firstIdx < 0) return runs.map(() => null)

  const cells: Array<OccTimelineCell | null> = []
  let carried: boolean | null = null   // true=resolved, false=open, null=inconnu jusqu'ici
  let gapSince = false

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (i < firstIdx) { cells.push(null); continue }
    const prevProven = toProven(carried)

    if (r.occs.length === 0) {
      // Non mentionné → aucun événement d'état : report du dernier état prouvé.
      cells.push({
        runId: r.runId, documentId: r.documentId, effectiveDate: r.effectiveDate,
        isMentioned: false, observedTriState: null, eventDate: null,
        previousProvenState: prevProven, currentProvenState: prevProven,
        transition: 'non_mentionné', label: null, stateKey: null, sourcePage: null,
        evidenceCount: 0, isGap: true,
      })
      gapSince = true
      continue
    }

    // Observé ce run : tri-state agrégé (dernier prouvé du run, unknown si aucun signal).
    const obsResolved = deriveCurrentResolvedState(r.occs.map((o) => o.stateStatus))
    const observedTriState: PvState = obsResolved === null ? 'unknown' : obsResolved ? 'resolved' : 'open'
    const primary = [...r.occs].sort((a, b) => famRank(a.stateKey) - famRank(b.stateKey))[0]
    const hasRealBefore = cells.some((c) => c && !c.isGap)
    const transition: HistoryTransition | null = !hasRealBefore
      ? null
      : computeHistoryTransition(primary.stateKey, carried, null, stateToPseudo(observedTriState), gapSince)

    // Report : unknown ne change pas l'état porté.
    let next: boolean | null = carried
    if (observedTriState === 'resolved') next = true
    else if (observedTriState === 'open') next = false

    const evs = r.occs.map((o) => o.eventDate).filter((x): x is string => !!x).sort()
    cells.push({
      runId: r.runId, documentId: r.documentId, effectiveDate: r.effectiveDate,
      isMentioned: true, observedTriState, eventDate: evs[0] ?? null,
      previousProvenState: prevProven, currentProvenState: toProven(next),
      transition, label: primary.label, stateKey: primary.stateKey, sourcePage: primary.sourcePage,
      evidenceCount: r.occs.reduce((s, o) => s + o.evidenceCount, 0), isGap: false,
    })
    carried = next
    gapSince = false
  }
  return cells
}

export interface OccTimelineSubject {
  canonicalSubjectId: string
  label: string
  stateKeys: string[]
  cells: Array<OccTimelineCell | null>
}

export interface SiteOccurrenceTimeline {
  siteId: string
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  subjects: OccTimelineSubject[]
}

/**
 * Orchestrateur DB : lit canonical_subject_occurrence (historical_pdf) et construit la trajectoire
 * neutre par canonical_subject sur l'axe des runs canoniques. Source unique pour les 3 read-models.
 */
export async function buildSiteOccurrenceTimeline(siteId: string): Promise<SiteOccurrenceTimeline> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const rawRuns = await canonicalRunsForSite(siteId)
  const runs = rawRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) }))
  if (runs.length === 0) return { siteId, runs: [], subjects: [] }

  const { data: occRows } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_ref_id, state_key, state_status, label, note, event_date, source_page, evidence_count')
    .eq('site_id', siteId)
    .eq('source_kind', 'historical_pdf')
    .not('validation_status', 'in', '("rejected","source_superseded")')
  type OccRow = {
    canonical_subject_id: string; source_ref_id: string; state_key: string; state_status: string | null
    label: string; note: string | null; event_date: string | null; source_page: number | null; evidence_count: number
  }
  const occAll = (occRows ?? []) as OccRow[]

  // report (source_ref_id) → run
  const repIds = [...new Set(occAll.map((o) => o.source_ref_id))]
  const repToRun = new Map<string, string>()
  if (repIds.length > 0) {
    const { data: reps } = await supabase.from('site_reports').select('id, extraction_run_id').in('id', repIds)
    for (const r of (reps ?? []) as Array<{ id: string; extraction_run_id: string | null }>) {
      if (r.extraction_run_id) repToRun.set(r.id, r.extraction_run_id)
    }
  }

  // cs → run → occurrences
  const byCsRun = new Map<string, Map<string, RunOccurrence[]>>()
  const csKeys = new Map<string, Set<string>>()
  for (const o of occAll) {
    const run = repToRun.get(o.source_ref_id)
    if (!run) continue
    const cs = o.canonical_subject_id
    if (!byCsRun.has(cs)) byCsRun.set(cs, new Map())
    if (!csKeys.has(cs)) csKeys.set(cs, new Set())
    csKeys.get(cs)!.add(o.state_key)
    const rm = byCsRun.get(cs)!
    const list = rm.get(run) ?? []
    list.push({
      stateStatus: (o.state_status ?? 'unknown') as PvState, stateKey: o.state_key,
      label: o.label, note: o.note, eventDate: o.event_date, sourcePage: o.source_page,
      evidenceCount: o.evidence_count ?? 0,
    })
    rm.set(run, list)
  }

  // labels
  const csIds = [...byCsRun.keys()]
  const csLabel = new Map<string, string>()
  for (let i = 0; i < csIds.length; i += 200) {
    const { data } = await supabase.from('canonical_subject').select('id, label').in('id', csIds.slice(i, i + 200))
    for (const c of (data ?? []) as Array<{ id: string; label: string }>) csLabel.set(c.id, c.label)
  }

  const subjects: OccTimelineSubject[] = csIds.map((cs) => {
    const rm = byCsRun.get(cs)!
    const perRun = runs.map((r) => ({ runId: r.id, documentId: r.documentId, effectiveDate: r.effectiveDate, occs: rm.get(r.id) ?? [] }))
    return { canonicalSubjectId: cs, label: csLabel.get(cs) ?? cs, stateKeys: [...(csKeys.get(cs) ?? [])], cells: buildOccurrenceCells(perRun) }
  })

  return { siteId, runs, subjects }
}
