import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalBusinessObjectEntry } from '@/lib/knowledge/canonical-business-object-projection'
import type { MaterializedEntityType } from '@/lib/db/canonical-subject-life'
import type { ObjectStateSignal } from '@/lib/ai/classify-occurrence-state-signal'

// Read-model de trajectoire longitudinale par CBO — P1-C2B.4 H2-B.4UI.
//
// Mandat Vincent (2026-08-25, après H2-B.4 : 78/78 signaux OCEF+PETRO backfillés) :
// lecture PURE des lignes déjà persistées dans object_state_occurrence_signal — aucune
// écriture, aucun appel Gemini déclenché par l'ouverture de la page (cf. doctrine de la
// table, migration 349 : "la trajectoire du CBO reste une fonction pure, recalculée à la
// demande à partir de ces lignes").
//
// Réduction longitudinale : même forme algorithmique que
// docs/memory-longitudinal-v1/P1-C2B4-STATE-CLASSIFICATION-DESIGN.md /
// scripts/p1c2b4e-longitudinal-state-recalc.ts (buckets OPEN_LIKE/PROGRESSING/REALIZED,
// détection de régression après un état réalisé, desync = calculé DONE vs statut structuré
// resté ouvert) — mais appliquée au nouveau vocabulaire de signal (object_state_occurrence_signal),
// pas au vocabulaire document_status. Contrairement à ce script, aucune résolution de scope
// de preuve n'est nécessaire ici : chaque ligne de signal est déjà adressée sans ambiguïté
// par (entity_type, entity_id), donc pas de verdict UNKNOWN/CONTRADICTED-par-scope.
//
// Hors périmètre volontaire : les 36 NO_CBO de H2-B.4 n'ont jamais de ligne de signal
// (canonical_business_object_id requis pour être interrogé ici) — rien à exclure explicitement,
// l'absence de CBO les exclut structurellement.

export type CboComputedState = 'OPEN' | 'PROGRESSING' | 'DONE' | 'REOPENED' | 'CONTRADICTED' | 'NO_SIGNAL'

export type CboSignalOccurrence = {
  entityId: string
  entityType: MaterializedEntityType
  occurrenceDate: string | null
  finalSignal: ObjectStateSignal
  // P1-4A : 'native_action_event' = clôture/réouverture explicite de l'utilisateur (preuve de
  // premier ordre). La réduction n'utilise pas `source` (seul finalSignal+date comptent) ; ce
  // champ ne sert qu'à la provenance affichée. Ouvert pour les canaux futurs (P1-4B documentaire).
  source: string
  reasoning: string | null
}

export type CboEvolution = {
  computedState: CboComputedState
  lastMeaningfulEvolutionAt: string | null
  occurrenceCount: number
  structuredStatusDesync: boolean
  trajectory: CboSignalOccurrence[]
}

type SignalBucket = 'OPEN_LIKE' | 'PROGRESSING' | 'REALIZED'

function bucketOfSignal(signal: ObjectStateSignal): SignalBucket | null {
  if (signal === 'OPENED' || signal === 'STILL_OPEN' || signal === 'REOPENED') return 'OPEN_LIKE'
  if (signal === 'PROGRESS') return 'PROGRESSING'
  if (signal === 'COMPLETED') return 'REALIZED'
  return null // NO_STATE_SIGNAL — pas de bucket, exclu du calcul en amont
}

function bucketOfPhysicalStatus(status: string | null): SignalBucket | null {
  if (!status) return null
  if (status === 'done' || status === 'cancelled' || status === 'lifted' || status === 'informational') return 'REALIZED'
  if (status === 'in_progress') return 'PROGRESSING'
  if (status === 'open' || status === 'planned' || status === 'non_compliant' || status === 'awaiting_validation' || status === 'to_plan' || status === 'still_open') return 'OPEN_LIKE'
  return null
}

/** Baseline structurée d'un CBO : DONE seulement si TOUS les membres connus sont réalisés (même règle que p1c2b4e). */
function physicalBaselineOf(statuses: (string | null)[]): SignalBucket | null {
  const known = statuses.map(bucketOfPhysicalStatus).filter((b): b is SignalBucket => b !== null)
  if (known.length === 0) return null
  return known.every((b) => b === 'REALIZED') ? 'REALIZED' : 'OPEN_LIKE'
}

/**
 * Réduction pure — état calculé à partir des occurrences significatives (NO_STATE_SIGNAL
 * déjà exclu), triées chronologiquement ascendant. Détecte la régression (REOPENED) et la
 * contradiction (deux buckets opposés à la même date), même logique que scripts/p1c2b4e.
 */
function computeState(meaningful: CboSignalOccurrence[]): CboComputedState {
  if (meaningful.length === 0) return 'NO_SIGNAL'

  const last = meaningful[meaningful.length - 1]
  if (last.finalSignal === 'REOPENED') return 'REOPENED'

  const lastBucket = bucketOfSignal(last.finalSignal)!
  let candidate: CboComputedState = lastBucket === 'REALIZED' ? 'DONE' : lastBucket === 'PROGRESSING' ? 'PROGRESSING' : 'OPEN'

  const lastRealizedIdx = [...meaningful]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find((x) => bucketOfSignal(x.m.finalSignal) === 'REALIZED')?.i ?? -1
  if (lastRealizedIdx >= 0 && lastRealizedIdx < meaningful.length - 1) candidate = 'REOPENED'

  const lastDate = last.occurrenceDate
  if (lastDate) {
    const sameDateBuckets = new Set(
      meaningful.filter((m) => m.occurrenceDate === lastDate).map((m) => bucketOfSignal(m.finalSignal)),
    )
    if (sameDateBuckets.size > 1 && sameDateBuckets.has('REALIZED') && (sameDateBuckets.has('OPEN_LIKE') || sameDateBuckets.has('PROGRESSING'))) {
      candidate = 'CONTRADICTED'
    }
  }
  return candidate
}

function sortByOccurrenceDate<T extends { occurrenceDate: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.occurrenceDate && b.occurrenceDate) return a.occurrenceDate.localeCompare(b.occurrenceDate)
    if (a.occurrenceDate) return -1
    if (b.occurrenceDate) return 1
    return 0
  })
}

// Un .in() sur des centaines d'UUID dépasse la limite de headers HTTP du client PostgREST —
// même contrainte que fetchCboMemberships (canonical-business-object-projection.ts).
const CHUNK_SIZE = 100

type SignalRow = {
  canonical_business_object_id: string
  entity_type: string
  entity_id: string
  occurrence_date: string | null
  final_signal: string
  source: string
  step1_reasoning: string | null
}

/**
 * Charge la trajectoire de signal de chaque CBO regroupé parmi les entrées fournies.
 * N'interroge QUE les CBO déjà identifiés côté page (entry.isGrouped) — un CBO sans
 * canonical_business_object_id (NO_CBO) n'entre jamais dans cette fonction. Lecture seule
 * stricte (SELECT uniquement), aucun appel IA.
 */
export async function loadCboEvolutions(
  entries: CanonicalBusinessObjectEntry[],
): Promise<Map<string, CboEvolution>> {
  const cboIds = entries.filter((e) => e.isGrouped).map((e) => e.key)
  const result = new Map<string, CboEvolution>()
  if (cboIds.length === 0) return result

  const sb = createAdminClient()
  const rows: SignalRow[] = []
  for (let i = 0; i < cboIds.length; i += CHUNK_SIZE) {
    const chunk = cboIds.slice(i, i + CHUNK_SIZE)
    const { data, error } = await sb
      .from('object_state_occurrence_signal')
      .select('canonical_business_object_id, entity_type, entity_id, occurrence_date, final_signal, source, step1_reasoning')
      .in('canonical_business_object_id', chunk)
      .eq('status', 'resolved')
    if (error) throw new Error(`loadCboEvolutions: échec du chunk [${i}, ${i + chunk.length}) — ${error.message}`)
    rows.push(...((data ?? []) as SignalRow[]))
  }

  const byCbo = new Map<string, SignalRow[]>()
  for (const r of rows) {
    const list = byCbo.get(r.canonical_business_object_id) ?? []
    list.push(r)
    byCbo.set(r.canonical_business_object_id, list)
  }

  const memberTitleByEntity = new Map<string, string>()
  const statusesByEntry = new Map<string, (string | null)[]>()
  for (const e of entries) {
    if (!e.isGrouped) continue
    statusesByEntry.set(e.key, e.members.map((m) => m.status))
    for (const m of e.members) memberTitleByEntity.set(`${m.entityType}:${m.entityId}`, m.title)
  }

  for (const cboId of cboIds) {
    const signalRows = byCbo.get(cboId) ?? []
    const trajectory = sortByOccurrenceDate(
      signalRows.map((r) => ({
        entityId: r.entity_id,
        entityType: r.entity_type as MaterializedEntityType,
        occurrenceDate: r.occurrence_date,
        finalSignal: r.final_signal as ObjectStateSignal,
        source: r.source,
        reasoning: r.step1_reasoning ?? memberTitleByEntity.get(`${r.entity_type}:${r.entity_id}`) ?? null,
      })),
    )

    const meaningful = trajectory.filter((t) => t.finalSignal !== 'NO_STATE_SIGNAL')
    const computedState = computeState(meaningful)
    const lastMeaningful = meaningful[meaningful.length - 1] ?? null

    const structuredStatusDesync =
      computedState === 'DONE' && physicalBaselineOf(statusesByEntry.get(cboId) ?? []) === 'OPEN_LIKE'

    result.set(cboId, {
      computedState,
      lastMeaningfulEvolutionAt: lastMeaningful?.occurrenceDate ?? null,
      occurrenceCount: trajectory.length,
      structuredStatusDesync,
      trajectory,
    })
  }

  return result
}
