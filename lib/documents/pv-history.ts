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

export type HistoryTransition = DeltaTransition | 'réapparu'

const OBSERVATION_FAMILIES = new Set(['observation', 'reservation', 'non_conformity'])

type RunRow = { id: string; document_id: string; created_at: string }
type PropRow = {
  id: string
  extraction_run_id: string
  target_site_id: string | null
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
 * Contrairement à computeTransition (Lot 2), cette version connaît le contexte historique :
 *   hasGap = true → le sujet a disparu puis réapparu → 'réapparu'
 */
export function computeHistoryTransition(
  family: string,
  fromStatus: string | null,
  toStatus: string | null,
  hasGap: boolean,
): HistoryTransition {
  if (hasGap) return 'réapparu'
  if (toStatus === 'cancelled') return 'annulé'
  if (toStatus === 'done' && fromStatus !== 'done') {
    return OBSERVATION_FAMILIES.has(family) ? 'levé' : 'réalisé'
  }
  if (fromStatus === 'done' && toStatus !== null && toStatus !== 'done' && toStatus !== 'cancelled') return 'réouvert'
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
    .select('id, extraction_run_id, target_site_id, subject_thread_id, proposal_family, thematic_category, label, description, document_status, source_page')
    .eq('subject_thread_id', subjectThreadId)
  if (propsErr) throw new Error(propsErr.message)
  if (!propsRaw?.length) return null

  const props = propsRaw as PropRow[]
  const siteId = props.find((p) => p.target_site_id)?.target_site_id ?? null
  if (!siteId) return null

  const { data: runsRaw, error: runsErr } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at')
    .eq('target_site_id', siteId)
    .eq('status', 'ready_for_review')
    .order('created_at', { ascending: true })
  if (runsErr) throw new Error(runsErr.message)

  const allRuns = (runsRaw ?? []) as RunRow[]
  const propByRun = new Map<string, PropRow>()
  for (const p of props) propByRun.set(p.extraction_run_id, p)

  const firstRunIndex = allRuns.findIndex((r) => propByRun.has(r.id))
  if (firstRunIndex < 0) return null

  const relevantRuns = allRuns.slice(firstRunIndex)

  // Métadonnées canoniques : label/statut de la dernière occurrence
  const propsWithDate = props
    .map((p) => ({ p, date: allRuns.find((r) => r.id === p.extraction_run_id)?.created_at ?? '' }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const firstEntry = propsWithDate[0]
  const lastEntry = propsWithDate[propsWithDate.length - 1]
  const latestProp = lastEntry.p

  const occurrences: SubjectOccurrence[] = []
  let prevProp: PropRow | null = null
  let gapSinceLastOccurrence = false

  for (const run of relevantRuns) {
    const prop = propByRun.get(run.id) ?? null

    if (prop === null) {
      occurrences.push({
        runId: run.id,
        documentId: run.document_id,
        proposalId: null,
        effectiveDate: run.created_at,
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
            prevProp?.document_status ?? null,
            prop.document_status,
            gapSinceLastOccurrence,
          )

      occurrences.push({
        runId: run.id,
        documentId: run.document_id,
        proposalId: prop.id,
        effectiveDate: run.created_at,
        status: prop.document_status,
        label: prop.label,
        description: prop.description,
        thematicCategory: prop.thematic_category,
        sourcePage: prop.source_page,
        transition,
        isGap: false,
      })
      prevProp = prop
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

  const { data: runsRaw, error: runsErr } = await supabase
    .from('document_extraction_run')
    .select('id, document_id, created_at')
    .eq('target_site_id', siteId)
    .eq('status', 'ready_for_review')
    .order('created_at', { ascending: true })
  if (runsErr) throw new Error(runsErr.message)

  const runs = (runsRaw ?? []) as RunRow[]
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
        t = computeHistoryTransition(toProp.proposal_family, fromProp.document_status, toProp.document_status, false)
      }
      counts[t] = (counts[t] ?? 0) + 1
    }

    snapshots.push({
      runId: run.id,
      documentId: run.document_id,
      effectiveDate: run.created_at,
      isFirstRun: i === 0,
      transitionCounts: counts,
    })
  }

  return { siteId, snapshots }
}
