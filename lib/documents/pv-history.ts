import 'server-only'

// Lot 3 — Chronologie métier des sujets extraits
//
// Lot 3A : getSubjectTimeline(subjectThreadId)
//   Chronologie complète d'un sujet stable à travers tous les PV d'un chantier.
//   Les PV où le sujet est absent sont représentés comme des trous calculés (non_mentionné).
//   HistoryTransition étend DeltaTransition avec 'réapparu' : sujet vu avant, disparu, puis de retour.
//
// Lot 3B : getSiteHistoricalTimeline(siteId)
//   Vue agrégée : pour chaque PV du chantier, compte des transitions de tous les sujets.
//   Source du Lot 4 (narration copilote).
//
// Contrat fondamental :
//   - non_mentionné est un état CALCULÉ — jamais stocké.
//   - Absence ≠ résolution. Le moteur observe, ne déduit pas.

import type { DeltaTransition } from './pv-comparison'
import { documentStatusToPvState } from './subject-state'

export type HistoryTransition = DeltaTransition | 'réapparu'

const OBSERVATION_FAMILIES = new Set(['observation', 'reservation', 'non_conformity'])

// Le SDK Supabase peut retourner les embeds en tableau ou en objet selon la version.
type RunRow = {
  id: string
  document_id: string
  created_at: string
  documents: Array<{ effective_date: string | null }> | { effective_date: string | null } | null
}

/** Date métier du PV : documents.effective_date si disponible, sinon created_at du run. */
export function runEffectiveDate(run: RunRow): string {
  const doc = Array.isArray(run.documents) ? run.documents[0] : run.documents
  return doc?.effective_date ?? run.created_at
}

/**
 * Retourne les runs canoniques d'un chantier, triés par date métier du PV (ASC).
 *
 * Invariant : 1 document = 1 snapshot temporel = 1 run canonique.
 *
 * P1-A.1 (parité read-model, GO Vincent 2026-08-24) : source = runs réellement
 * matérialisés (site_reports.extraction_run_id via getMaterializedRunIdsForSite),
 * jamais `is_canonical=true` seul. Même doctrine que canonical-subject-historical-
 * corpus-reconcile.ts : un run peut être canonique sans jamais avoir produit de
 * visite (fantôme, à ignorer), et un run matérialisé mais non encore marqué
 * canonique doit quand même apparaître dans les vues temporelles produit
 * (découverte Guillaume, P0-J.1/P1-A.1).
 */
export async function canonicalRunsForSite(siteId: string): Promise<RunRow[]> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { getMaterializedRunIdsForSite } = await import('@/lib/db/canonical-subject-historical-corpus-reconcile')
  const supabase = createAdminClient()
  const materializedRunIds = await getMaterializedRunIdsForSite(supabase, siteId)
  if (materializedRunIds.length === 0) return []
  const { data, error } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at, documents!document_id(effective_date)')
    .eq('target_site_id', siteId)
    .in('id', materializedRunIds)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as unknown as RunRow[])
  rows.sort((a, b) => {
    const da = runEffectiveDate(a), db = runEffectiveDate(b)
    return da !== db ? da.localeCompare(db) : a.created_at.localeCompare(b.created_at)
  })
  return rows
}
type PropRow = {
  id: string
  extraction_run_id: string
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  description: string | null
  document_status: string | null
  source_page: number | null
}

/**
 * Calcule la transition d'état entre deux occurrences successives du même sujet.
 *
 * prevResolved : dernier état de résolution connu (hors unknown) avant ce PV.
 *   null = aucun signal fiable antérieur.
 *   Permet le D1 fix : resolved → gap → open = réouvert (jamais réapparu).
 */
export function computeHistoryTransition(
  family: string,
  prevResolved: boolean | null,
  fromStatus: string | null,
  toStatus: string | null,
  hasGap: boolean,
): HistoryTransition {
  if (hasGap) {
    // Le signal actuel prime sur le gap (réalisé > réouvert > réapparu)
    if (toStatus === 'cancelled') return 'annulé'
    if (toStatus === 'done') return OBSERVATION_FAMILIES.has(family) ? 'levé' : 'réalisé'
    if (prevResolved === true) return 'réouvert'  // D1 : résolu avant gap + retour actif
    return 'réapparu'
  }
  if (toStatus === 'cancelled') return 'annulé'
  if (toStatus === 'done' && fromStatus !== 'done') {
    return OBSERVATION_FAMILIES.has(family) ? 'levé' : 'réalisé'
  }
  if (fromStatus === 'done' && toStatus !== null && toStatus !== 'done' && toStatus !== 'cancelled') return 'réouvert'
  // D1 sans gap : done → unknown → open (prevResolved=true, fromStatus=null/unknown)
  if (prevResolved === true && toStatus === 'open') return 'réouvert'
  if ((fromStatus === 'open' || fromStatus === 'in_progress') && toStatus === 'non_compliant') return 'aggravé'
  if (fromStatus === 'planned' && (toStatus === 'in_progress' || toStatus === 'open')) return 'progressé'
  if (fromStatus === toStatus) return 'maintenu'
  return 'changé'
}

// ── Types publics ─────────────────────────────────────────────────────────────

export interface SubjectOccurrence {
  runId: string
  documentId: string
  proposalId: string | null  // null pour les entrées de type gap (non_mentionné)
  effectiveDate: string      // created_at du run (proxy date PV)
  status: string | null
  label: string | null       // null pour les gaps
  description: string | null
  thematicCategory: string | null
  sourcePage: number | null
  transition: HistoryTransition | null  // null pour la première occurrence
  isGap: boolean
}

export interface SubjectTimeline {
  subjectThreadId: string
  canonicalLabel: string        // label de la dernière occurrence connue
  family: string
  thematicCategory: string | null
  firstSeenAt: string
  lastSeenAt: string
  currentStatus: string | null  // statut de la dernière occurrence réelle
  occurrences: SubjectOccurrence[]
}

export interface SiteRunSnapshot {
  runId: string
  documentId: string
  effectiveDate: string
  isFirstRun: boolean
  transitionCounts: Partial<Record<HistoryTransition, number>>
}

export interface SiteHistoricalTimeline {
  siteId: string
  snapshots: SiteRunSnapshot[]
}

// ── Types Vue 1 — Grille ligne de vie ────────────────────────────────────────

export interface MatrixCell {
  status: string | null
  transition: HistoryTransition | null
  isGap: boolean
  proposalId: string | null
  label: string | null
}

export interface SubjectMatrixRow {
  subjectThreadId: string
  canonicalLabel: string
  family: string
  thematicCategory: string | null
  currentStatus: string | null
  /** canonical_subject_id si le thread est rattaché (null = thread non encore résolu). */
  canonicalSubjectId: string | null
  /** Une cellule par run (même longueur que SiteSubjectMatrix.runs). null = antérieur à la première occurrence. */
  cells: Array<MatrixCell | null>
  /** canonical_topic_id si le sujet est classifié (null = sans topic). */
  topicId: string | null
  /** Libellé du canonical_topic (null si sans topic). */
  topicLabel: string | null
}

export interface SiteSubjectMatrix {
  siteId: string
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  rows: SubjectMatrixRow[]
}

// ── Lot 3A — Chronologie d'un sujet ──────────────────────────────────────────

/**
 * Retourne la vie complète d'un sujet stable à travers les PV du chantier.
 *
 * Plage affichée : de la première occurrence jusqu'au dernier run disponible.
 * Les runs intermédiaires ou postérieurs sans cette proposition → entrée isGap=true.
 *
 * Retourne null si le subject_thread_id est inconnu ou sans target_site_id.
 */
export async function getSubjectTimeline(subjectThreadId: string): Promise<SubjectTimeline | null> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const { data: propsRaw, error: propsErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, subject_thread_id, proposal_family, thematic_category, label, description, document_status, source_page')
    .eq('subject_thread_id', subjectThreadId)
  if (propsErr) throw new Error(propsErr.message)
  if (!propsRaw?.length) return null

  const props = propsRaw as PropRow[]

  // document_extraction_proposal.target_site_id est NULL en base : le site se
  // dérive via extraction_run_id → document_extraction_run.target_site_id.
  const runIds = Array.from(new Set(props.map((p) => p.extraction_run_id)))
  const { data: runsForSite, error: runsForSiteErr } = await supabase
    .from('document_extraction_run')
    .select('id, target_site_id')
    .in('id', runIds)
  if (runsForSiteErr) throw new Error(runsForSiteErr.message)
  const siteId = (runsForSite ?? []).find((r) => r.target_site_id)?.target_site_id ?? null
  if (!siteId) return null

  // 1 document = 1 snapshot temporel. Seul le run canonique par document est inclus.
  const allRuns = await canonicalRunsForSite(siteId)
  const propByRun = new Map<string, PropRow>()
  for (const p of props) propByRun.set(p.extraction_run_id, p)

  const firstRunIndex = allRuns.findIndex((r) => propByRun.has(r.id))
  if (firstRunIndex < 0) return null

  const relevantRuns = allRuns.slice(firstRunIndex)

  // Métadonnées canoniques : label/statut de la dernière occurrence
  const runDateMap = new Map<string, string>()
  for (const r of allRuns) runDateMap.set(r.id, runEffectiveDate(r))
  const propsWithDate = props
    .map((p) => ({ p, date: runDateMap.get(p.extraction_run_id) ?? '' }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const firstEntry = propsWithDate[0]
  const lastEntry = propsWithDate[propsWithDate.length - 1]
  const latestProp = lastEntry.p

  const occurrences: SubjectOccurrence[] = []
  let prevProp: PropRow | null = null
  let gapSinceLastOccurrence = false
  let prevResolvedState: boolean | null = null  // dernier état non-unknown avant ce PV

  for (const run of relevantRuns) {
    const prop = propByRun.get(run.id) ?? null

    if (prop === null) {
      occurrences.push({
        runId: run.id,
        documentId: run.document_id,
        proposalId: null,
        effectiveDate: runEffectiveDate(run),
        status: null,
        label: null,
        description: null,
        thematicCategory: null,
        sourcePage: null,
        transition: 'non_mentionné',
        isGap: true,
      })
      gapSinceLastOccurrence = true
    } else {
      const isFirst = occurrences.length === 0 && !gapSinceLastOccurrence
      const transition: HistoryTransition | null = isFirst
        ? null
        : computeHistoryTransition(
            prop.proposal_family,
            prevResolvedState,
            prevProp?.document_status ?? null,
            prop.document_status,
            gapSinceLastOccurrence,
          )

      occurrences.push({
        runId: run.id,
        documentId: run.document_id,
        proposalId: prop.id,
        effectiveDate: runEffectiveDate(run),
        status: prop.document_status,
        label: prop.label,
        description: prop.description,
        thematicCategory: prop.thematic_category,
        sourcePage: prop.source_page,
        transition,
        isGap: false,
      })
      prevProp = prop
      // Mettre à jour prevResolvedState ; unknown ne réinitialise pas l'état antérieur
      const pvState = documentStatusToPvState(prop.document_status)
      if (pvState === 'resolved') prevResolvedState = true
      else if (pvState === 'open') prevResolvedState = false
      gapSinceLastOccurrence = false
    }
  }

  return {
    subjectThreadId,
    canonicalLabel: latestProp.label,
    family: latestProp.proposal_family,
    thematicCategory: latestProp.thematic_category,
    firstSeenAt: firstEntry.date,
    lastSeenAt: lastEntry.date,
    currentStatus: latestProp.document_status,
    occurrences,
  }
}

// ── Lot 3B — Chronologie agrégée du chantier ─────────────────────────────────

/**
 * Retourne, pour chaque PV du chantier, le décompte des transitions de tous les sujets.
 *
 * Source principale du Lot 4 (narration copilote).
 * 2 requêtes DB — toutes les propositions chargées en mémoire pour comparaison séquentielle.
 */
export async function getSiteHistoricalTimeline(siteId: string): Promise<SiteHistoricalTimeline> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const runs = await canonicalRunsForSite(siteId)
  if (runs.length === 0) return { siteId, snapshots: [] }

  const runIds = runs.map((r) => r.id)

  type SitePropRow = {
    id: string
    extraction_run_id: string
    proposal_family: string
    document_status: string | null
    subject_thread_id: string
  }

  const { data: propsRaw, error: propsErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, proposal_family, document_status, subject_thread_id')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  if (propsErr) throw new Error(propsErr.message)

  const props = (propsRaw ?? []) as SitePropRow[]

  // Grouper par run → par subject_thread_id
  const byRun = new Map<string, Map<string, SitePropRow>>()
  for (const run of runs) byRun.set(run.id, new Map())
  for (const p of props) byRun.get(p.extraction_run_id)?.set(p.subject_thread_id, p)

  const snapshots: SiteRunSnapshot[] = []

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const prevRun = i > 0 ? runs[i - 1] : null
    const curr = byRun.get(run.id)!
    const prev = prevRun ? (byRun.get(prevRun.id) ?? new Map<string, SitePropRow>()) : new Map<string, SitePropRow>()

    const counts: Partial<Record<HistoryTransition, number>> = {}
    const allThreads = new Set([...curr.keys(), ...prev.keys()])

    for (const threadId of allThreads) {
      const fromProp = prev.get(threadId) ?? null
      const toProp = curr.get(threadId) ?? null

      let t: HistoryTransition
      if (!fromProp) {
        t = 'nouveau'
      } else if (!toProp) {
        t = 'non_mentionné'
      } else {
        // Runs consécutifs → hasGap = false (les gaps ne s'appliquent qu'à la chronologie par sujet)
        const fromPvState = documentStatusToPvState(fromProp.document_status)
        const fromResolved = fromPvState === 'resolved' ? true : fromPvState === 'open' ? false : null
        t = computeHistoryTransition(toProp.proposal_family, fromResolved, fromProp.document_status, toProp.document_status, false)
      }
      counts[t] = (counts[t] ?? 0) + 1
    }

    snapshots.push({
      runId: run.id,
      documentId: run.document_id,
      effectiveDate: runEffectiveDate(run),
      isFirstRun: i === 0,
      transitionCounts: counts,
    })
  }

  return { siteId, snapshots }
}

// ── Vue 1 — Matrice ligne de vie ─────────────────────────────────────────────

/**
 * Retourne la matrice complète des sujets × runs pour un chantier.
 *
 * 2 requêtes DB (identiques à getSiteHistoricalTimeline).
 * Une cellule `null` signifie que le sujet n'était pas encore apparu à ce run.
 * Une cellule `isGap=true` signifie que le sujet était connu mais absent du PV.
 *
 * Tri par défaut : activité décroissante (dernier run avec présence réelle).
 */
export async function getSiteSubjectMatrix(siteId: string): Promise<SiteSubjectMatrix> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const runs = await canonicalRunsForSite(siteId)
  if (runs.length === 0) return { siteId, runs: [], rows: [] }

  const runIds = runs.map((r) => r.id)

  type MatrixPropRow = {
    id: string
    extraction_run_id: string
    proposal_family: string
    document_status: string | null
    subject_thread_id: string
    thematic_category: string | null
    label: string
  }

  const { data: propsRaw, error: propsErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, proposal_family, document_status, subject_thread_id, thematic_category, label')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  if (propsErr) throw new Error(propsErr.message)

  const props = (propsRaw ?? []) as MatrixPropRow[]

  // byRun[runId][threadId] → prop
  const byRun = new Map<string, Map<string, MatrixPropRow>>()
  for (const run of runs) byRun.set(run.id, new Map())
  for (const p of props) byRun.get(p.extraction_run_id)?.set(p.subject_thread_id, p)

  // Collect all threads and their metadata (canonical = latest label)
  const threadMeta = new Map<string, { family: string; thematicCategory: string | null; label: string; lastRunIndex: number }>()
  for (let i = 0; i < runs.length; i++) {
    const curr = byRun.get(runs[i].id)!
    for (const [threadId, prop] of curr.entries()) {
      const prev = threadMeta.get(threadId)
      if (!prev || i >= prev.lastRunIndex) {
        threadMeta.set(threadId, {
          family: prop.proposal_family,
          thematicCategory: prop.thematic_category,
          label: prop.label,
          lastRunIndex: i,
        })
      }
    }
  }

  // Canonical subject IDs par thread (pour lien vers la vue "Vie du sujet")
  const threadToCanonical = new Map<string, string | null>()
  if (threadMeta.size > 0) {
    const { data: stiRows } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', [...threadMeta.keys()])
    for (const r of ((stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)) {
      threadToCanonical.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  let rows: SubjectMatrixRow[] = []

  for (const [threadId, meta] of threadMeta.entries()) {
    const cells: Array<MatrixCell | null> = []
    let prevProp: MatrixPropRow | null = null
    let firstRunIndex = -1
    let gapSinceLastOccurrence = false
    let prevResolvedState: boolean | null = null  // dernier état non-unknown avant ce PV

    // Find first run index for this thread
    for (let i = 0; i < runs.length; i++) {
      if (byRun.get(runs[i].id)!.has(threadId)) { firstRunIndex = i; break }
    }

    for (let i = 0; i < runs.length; i++) {
      const curr = byRun.get(runs[i].id)!
      const prop = curr.get(threadId) ?? null

      if (i < firstRunIndex) {
        // Not yet appeared
        cells.push(null)
        continue
      }

      if (prop === null) {
        cells.push({ status: null, transition: 'non_mentionné', isGap: true, proposalId: null, label: null })
        gapSinceLastOccurrence = true
      } else {
        const isFirst = i === firstRunIndex
        const transition: HistoryTransition | null = isFirst
          ? null
          : computeHistoryTransition(
              prop.proposal_family,
              prevResolvedState,
              prevProp?.document_status ?? null,
              prop.document_status,
              gapSinceLastOccurrence,
            )
        cells.push({
          status: prop.document_status,
          transition,
          isGap: false,
          proposalId: prop.id,
          label: prop.label,
        })
        prevProp = prop
        // Mettre à jour prevResolvedState ; unknown ne réinitialise pas l'état antérieur
        const pvState = documentStatusToPvState(prop.document_status)
        if (pvState === 'resolved') prevResolvedState = true
        else if (pvState === 'open') prevResolvedState = false
        gapSinceLastOccurrence = false
      }
    }

    // Current status = last real cell's status
    let currentStatus: string | null = null
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i]
      if (cell && !cell.isGap) { currentStatus = cell.status; break }
    }

    rows.push({
      subjectThreadId: threadId,
      canonicalLabel: meta.label,
      family: meta.family,
      thematicCategory: meta.thematicCategory,
      currentStatus,
      canonicalSubjectId: threadToCanonical.get(threadId) ?? null,
      cells,
      topicId: null,
      topicLabel: null,
    })
  }

  // Grouper les lignes par canonical_subject_id pour éviter les doublons
  // (un canonical peut avoir plusieurs subject_thread_id via subject_thread_identity)
  const canonicalGroups = new Map<string, SubjectMatrixRow[]>()
  const ungrouped: SubjectMatrixRow[] = []
  for (const row of rows) {
    if (row.canonicalSubjectId !== null) {
      const g = canonicalGroups.get(row.canonicalSubjectId) ?? []
      g.push(row)
      canonicalGroups.set(row.canonicalSubjectId, g)
    } else {
      ungrouped.push(row)
    }
  }

  // Récupérer les labels canoniques depuis canonical_subject
  const allCanonicalIds = [...canonicalGroups.keys()]
  const canonicalLabelMap = new Map<string, string>()
  if (allCanonicalIds.length > 0) {
    const { data: csRows } = await supabase
      .from('canonical_subject')
      .select('id, label')
      .in('id', allCanonicalIds)
    for (const r of ((csRows ?? []) as Array<{ id: string; label: string }>)) {
      canonicalLabelMap.set(r.id, r.label)
    }
  }

  const mergedRows: SubjectMatrixRow[] = []
  for (const [csId, group] of canonicalGroups.entries()) {
    const numCols = runs.length
    // Fusionner les cellules : non-gap > gap > null
    const mergedCells: Array<MatrixCell | null> = Array.from({ length: numCols }, (_, i) => {
      let best: MatrixCell | null = null
      for (const row of group) {
        const cell = row.cells[i]
        if (cell === null) continue
        if (best === null || (!cell.isGap && best.isGap)) best = cell
      }
      return best
    })
    // Recalculer currentStatus depuis les cellules fusionnées
    let currentStatus: string | null = null
    for (let i = mergedCells.length - 1; i >= 0; i--) {
      const c = mergedCells[i]
      if (c && !c.isGap) { currentStatus = c.status; break }
    }
    // Représentant = thread avec le run réel le plus récent
    const representative = group.reduce((best, row) => {
      const lastReal = row.cells.findLastIndex((c) => c !== null && !c.isGap)
      const bestLastReal = best.cells.findLastIndex((c) => c !== null && !c.isGap)
      return lastReal >= bestLastReal ? row : best
    })
    mergedRows.push({
      subjectThreadId: csId,
      canonicalLabel: canonicalLabelMap.get(csId) ?? representative.canonicalLabel,
      family: representative.family,
      thematicCategory: representative.thematicCategory,
      currentStatus,
      canonicalSubjectId: csId,
      cells: mergedCells,
      topicId: null,
      topicLabel: null,
    })
  }

  rows = [...mergedRows, ...ungrouped]

  // Attacher les canonical_topic aux lignes canonical
  const canonicalIdsForTopics = rows
    .map((r) => r.canonicalSubjectId)
    .filter((id): id is string => id !== null)
  if (canonicalIdsForTopics.length > 0) {
    type TopicLink = {
      canonical_subject_id: string
      canonical_topic_id: string
      canonical_topic: Array<{ id: string; label: string }> | { id: string; label: string } | null
    }
    const { data: topicLinks } = await supabase
      .from('canonical_topic_subject')
      .select('canonical_subject_id, canonical_topic_id, canonical_topic!canonical_topic_id(id, label)')
      .in('canonical_subject_id', canonicalIdsForTopics)
    const topicMap = new Map<string, { id: string; label: string }>()
    for (const link of ((topicLinks ?? []) as TopicLink[])) {
      const t = Array.isArray(link.canonical_topic) ? link.canonical_topic[0] : link.canonical_topic
      if (t) topicMap.set(link.canonical_subject_id, { id: t.id, label: t.label })
    }
    for (const row of rows) {
      if (row.canonicalSubjectId && topicMap.has(row.canonicalSubjectId)) {
        const t = topicMap.get(row.canonicalSubjectId)!
        row.topicId = t.id
        row.topicLabel = t.label
      }
    }
  }

  // Sort by most recent active run (desc), then by canonicalLabel
  rows.sort((a, b) => {
    const lastA = a.cells.findLastIndex((c) => c !== null && !c.isGap)
    const lastB = b.cells.findLastIndex((c) => c !== null && !c.isGap)
    if (lastB !== lastA) return lastB - lastA
    return a.canonicalLabel.localeCompare(b.canonicalLabel, 'fr')
  })

  return {
    siteId,
    runs: runs.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
    rows,
  }
}
