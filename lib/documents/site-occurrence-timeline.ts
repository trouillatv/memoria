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

/**
 * P0-2b — Projection MATRICE : combine PRÉSENCE documentaire et ÉTAT occurrence, sans jamais utiliser
 * de proposition pour l'état. Trois natures de cellule :
 *   - occurrence présente        → cellule d'état (observedTriState, transition, report mis à jour) ;
 *   - présent sans occurrence     → « présent, état porté conservé » : isGap=false, isMentioned=true,
 *     observedTriState=null, transition=null, currentProvenState reporté (ni preuve open, ni non-mention) ;
 *   - absent du document          → gap « non mentionné » (isGap=true, isMentioned=false).
 * `isPresent` (présence documentaire) est fourni PAR L'APPELANT — la primitive ne lit aucune proposition.
 * La ligne démarre à la première PRÉSENCE documentaire ; la transition « première » se règle sur la
 * première OCCURRENCE (pas la première présence).
 */
export function buildDocumentPresenceCells(
  runs: Array<{ runId: string; documentId: string; effectiveDate: string; isPresent: boolean; occs: RunOccurrence[] }>,
): Array<OccTimelineCell | null> {
  const firstPresent = runs.findIndex((r) => r.isPresent || r.occs.length > 0)
  if (firstPresent < 0) return runs.map(() => null)

  const cells: Array<OccTimelineCell | null> = []
  let carried: boolean | null = null
  let gapSince = false
  let hasOccurrenceBefore = false

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (i < firstPresent) { cells.push(null); continue }
    const prevProven = toProven(carried)

    if (r.occs.length === 0) {
      if (r.isPresent) {
        // Présent sans occurrence éligible : présence documentaire, état porté conservé.
        cells.push({
          runId: r.runId, documentId: r.documentId, effectiveDate: r.effectiveDate,
          isMentioned: true, observedTriState: null, eventDate: null,
          previousProvenState: prevProven, currentProvenState: prevProven,
          transition: null, label: null, stateKey: null, sourcePage: null, evidenceCount: 0, isGap: false,
        })
        // pas un gap : ne modifie pas gapSince
      } else {
        // Absent du document : gap.
        cells.push({
          runId: r.runId, documentId: r.documentId, effectiveDate: r.effectiveDate,
          isMentioned: false, observedTriState: null, eventDate: null,
          previousProvenState: prevProven, currentProvenState: prevProven,
          transition: 'non_mentionné', label: null, stateKey: null, sourcePage: null, evidenceCount: 0, isGap: true,
        })
        gapSince = true
      }
      continue
    }

    const obsResolved = deriveCurrentResolvedState(r.occs.map((o) => o.stateStatus))
    const observedTriState: PvState = obsResolved === null ? 'unknown' : obsResolved ? 'resolved' : 'open'
    const primary = [...r.occs].sort((a, b) => famRank(a.stateKey) - famRank(b.stateKey))[0]
    const transition: HistoryTransition | null = !hasOccurrenceBefore
      ? null
      : computeHistoryTransition(primary.stateKey, carried, null, stateToPseudo(observedTriState), gapSince)

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
    hasOccurrenceBefore = true
  }
  return cells
}

/**
 * P0-2c — Projection CHRONOLOGIE : classe une cellule en transition de delta (DeltaTransition),
 * en préservant la distinction présence / événement d'état / gap.
 *   - gap (absent)                       → 'non_mentionné' ;
 *   - première apparition documentaire   → 'nouveau' ;
 *   - présent SANS occurrence d'état     → 'maintenu' (mentionné, aucun nouvel événement d'état) ;
 *   - occurrence d'état                  → la transition observée (réalisé/réouvert/…), 'maintenu' si null.
 * `isFirstAppearance` : cette cellule est la 1re présence documentaire du sujet (relatif au delta).
 */
export function cellDeltaTransition(
  cell: OccTimelineCell,
  isFirstAppearance: boolean,
): 'nouveau' | 'non_mentionné' | 'maintenu' | 'réalisé' | 'levé' | 'réouvert' | 'aggravé' | 'progressé' | 'annulé' | 'changé' {
  if (cell.isGap) return 'non_mentionné'
  if (isFirstAppearance) return 'nouveau'
  if (cell.observedTriState === null) return 'maintenu' // présent, aucun événement d'état
  const t = cell.transition
  if (t === null || t === 'réapparu') return t === 'réapparu' ? 'nouveau' : 'maintenu'
  return t
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
 * P0-2d — FETCH PARTAGÉ UNIQUE des occurrences historiques d'un chantier, par (canonical_subject, run).
 * Source de vérité commune consommée par : buildSiteOccurrenceTimeline, buildSiteSubjectCells (Lignes de
 * vie / Chronologie) ET getSiteHealthTimeline (Tension). Chaque consommateur applique ENSUITE sa propre
 * agrégation métier (runTensionState pour la Tension, deriveCurrentResolvedState pour l'état de la fiche) :
 * source unique ≠ agrégation unique.
 */
export async function fetchSiteHistoricalOccurrences(siteId: string): Promise<{
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  byCsRun: Map<string, Map<string, RunOccurrence[]>>
  familiesByCs: Map<string, Set<string>>
}> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const rawRuns = await canonicalRunsForSite(siteId)
  const runs = rawRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) }))
  if (runs.length === 0) return { runs: [], byCsRun: new Map(), familiesByCs: new Map() }

  const { data: occRows } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_ref_id, state_key, state_status, label, note, event_date, source_page, evidence_count')
    .eq('site_id', siteId)
    .eq('source_kind', 'historical_pdf')
    .not('validation_status', 'in', '("rejected","source_superseded")')
  type O = { canonical_subject_id: string; source_ref_id: string; state_key: string; state_status: string | null; label: string; note: string | null; event_date: string | null; source_page: number | null; evidence_count: number }
  const occAll = (occRows ?? []) as O[]

  const repIds = [...new Set(occAll.map((o) => o.source_ref_id))]
  const repToRun = new Map<string, string>()
  if (repIds.length > 0) {
    const { data: reps } = await supabase.from('site_reports').select('id, extraction_run_id').in('id', repIds)
    for (const r of (reps ?? []) as Array<{ id: string; extraction_run_id: string | null }>) if (r.extraction_run_id) repToRun.set(r.id, r.extraction_run_id)
  }

  const byCsRun = new Map<string, Map<string, RunOccurrence[]>>()
  const familiesByCs = new Map<string, Set<string>>()
  for (const o of occAll) {
    const run = repToRun.get(o.source_ref_id)
    if (!run) continue
    const cs = o.canonical_subject_id
    if (!byCsRun.has(cs)) byCsRun.set(cs, new Map())
    if (!familiesByCs.has(cs)) familiesByCs.set(cs, new Set())
    familiesByCs.get(cs)!.add(o.state_key)
    const rm = byCsRun.get(cs)!
    const list = rm.get(run) ?? []
    list.push({ stateStatus: (o.state_status ?? 'unknown') as PvState, stateKey: o.state_key, label: o.label, note: o.note, eventDate: o.event_date, sourcePage: o.source_page, evidenceCount: o.evidence_count ?? 0 })
    rm.set(run, list)
  }
  return { runs, byCsRun, familiesByCs }
}

export interface SiteSubjectCellsRow {
  canonicalSubjectId: string
  label: string
  family: string           // famille dominante (state_key des occurrences, sinon famille de proposition)
  thematicCategory: string | null
  cells: Array<OccTimelineCell | null>
}
export interface SiteSubjectCells {
  siteId: string
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  rows: SiteSubjectCellsRow[]
}

/**
 * P0-2c — Vue canonical-level UNIFIÉE pour la Chronologie : par canonical_subject (occurrence-backed ET
 * acteurs sans occurrence), cellules construites via buildDocumentPresenceCells — ÉTAT depuis les
 * occurrences (state_status), PRÉSENCE depuis les propositions. Un acteur (aucune occurrence) n'a que
 * des cellules de présence (jamais d'événement d'état). Aucune proposition ne détermine l'état.
 */
export async function buildSiteSubjectCells(siteId: string): Promise<SiteSubjectCells> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  // État : fetch partagé unique des occurrences (même source que la Tension et la primitive).
  const { runs, byCsRun: occByCsRun } = await fetchSiteHistoricalOccurrences(siteId)
  if (runs.length === 0) return { siteId, runs: [], rows: [] }
  const runIds = runs.map((r) => r.id)

  // Présence documentaire : propositions par (thread, run) → canonical via STI.
  const { data: propsRaw } = await supabase
    .from('document_extraction_proposal')
    .select('extraction_run_id, subject_thread_id, proposal_family, thematic_category, label')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  type P = { extraction_run_id: string; subject_thread_id: string; proposal_family: string; thematic_category: string | null; label: string }
  const props = (propsRaw ?? []) as P[]
  const threadIds = [...new Set(props.map((p) => p.subject_thread_id))]
  const t2c = new Map<string, string>()
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data } = await supabase.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').in('subject_thread_id', threadIds.slice(i, i + 200))
    for (const s of (data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) t2c.set(s.subject_thread_id, s.canonical_subject_id)
  }
  const presentByCsRun = new Map<string, Set<string>>()      // cs → runs présents (proposition)
  const csMeta = new Map<string, { family: string; thematic: string | null; label: string }>()
  for (const p of props) {
    const cs = t2c.get(p.subject_thread_id); if (!cs) continue
    if (!presentByCsRun.has(cs)) presentByCsRun.set(cs, new Set())
    presentByCsRun.get(cs)!.add(p.extraction_run_id)
    if (!csMeta.has(cs)) csMeta.set(cs, { family: p.proposal_family, thematic: p.thematic_category, label: p.label })
  }

  // Union des canonicals (présence proposition ∪ occurrences).
  const allCs = new Set<string>([...presentByCsRun.keys(), ...occByCsRun.keys()])
  const csLabel = new Map<string, string>()
  const csIds = [...allCs]
  for (let i = 0; i < csIds.length; i += 200) {
    const { data } = await supabase.from('canonical_subject').select('id, label').in('id', csIds.slice(i, i + 200))
    for (const c of (data ?? []) as Array<{ id: string; label: string }>) csLabel.set(c.id, c.label)
  }

  const rows: SiteSubjectCellsRow[] = csIds.map((cs) => {
    const rm = occByCsRun.get(cs)
    const present = presentByCsRun.get(cs) ?? new Set<string>()
    const perRun = runs.map((r) => ({
      runId: r.id, documentId: r.documentId, effectiveDate: r.effectiveDate,
      isPresent: present.has(r.id), occs: rm?.get(r.id) ?? [],
    }))
    const cells = buildDocumentPresenceCells(perRun)
    const domKey = [...cells].reverse().find((c) => c && !c.isGap && c.stateKey)?.stateKey
    const meta = csMeta.get(cs)
    return {
      canonicalSubjectId: cs,
      label: csLabel.get(cs) ?? meta?.label ?? cs,
      family: domKey ?? meta?.family ?? 'unknown',
      thematicCategory: meta?.thematic ?? null,
      cells,
    }
  })

  return { siteId, runs, rows }
}

/**
 * Orchestrateur DB : lit canonical_subject_occurrence (historical_pdf) et construit la trajectoire
 * neutre par canonical_subject sur l'axe des runs canoniques. Source unique pour les 3 read-models.
 */
export async function buildSiteOccurrenceTimeline(siteId: string): Promise<SiteOccurrenceTimeline> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const { runs, byCsRun, familiesByCs: csKeys } = await fetchSiteHistoricalOccurrences(siteId)
  if (runs.length === 0) return { siteId, runs: [], subjects: [] }

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
