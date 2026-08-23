import 'server-only'

/**
 * Read-model de confrontation échéances ↔ terrain (Phase B).
 *
 * Principe : absence de preuve ≠ preuve d'absence.
 * Aucune écriture, aucun statut modifié. L'échéance reste planned/to_plan
 * jusqu'à ce qu'un humain la clôture.
 *
 * Classifications :
 *   FIELD_COMPLETION_EVIDENCE          — field_checked après due_date
 *   FIELD_PROGRESS_OBSERVED            — still_open ou non qualifié, après due_date
 *   OVERDUE_WITHOUT_PROGRESS_EVIDENCE  — aucune occurrence postérieure (≠ rien fait)
 *   NO_POST_DUE_EVIDENCE               — occurrences présentes mais > 60 j avant due_date
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type DeadlineFieldClassification =
  | 'FIELD_COMPLETION_EVIDENCE'
  | 'FIELD_PROGRESS_OBSERVED'
  | 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE'
  | 'NO_POST_DUE_EVIDENCE'

export type DeadlineFieldEvidence = {
  classification: DeadlineFieldClassification
  /** Date ISO (YYYY-MM-DD) de l'occurrence la plus récente dans la fenêtre d'intérêt. */
  lastEvidenceDate: string | null
  lastEvidenceLabel: string | null
  /** Niveau de confiance de la meilleure occurrence. */
  validationStatus: 'confirmed' | 'observed' | null
  rationale: string
}

type RawOcc = {
  canonical_subject_id: string
  visit_status: string | null
  validation_status: string
  effective_date: string
  label: string
}

const WINDOW_DAYS = 60

function classify(dueDate: string, occs: RawOcc[]): DeadlineFieldEvidence {
  const active = occs.filter((o) => !['rejected', 'source_superseded'].includes(o.validation_status))

  if (active.length === 0) {
    return {
      classification: 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE',
      lastEvidenceDate: null,
      lastEvidenceLabel: null,
      validationStatus: null,
      rationale: 'aucune occurrence terrain active',
    }
  }

  const windowStart = new Date(dueDate + 'T00:00:00Z')
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS)
  const windowStartStr = windowStart.toISOString().slice(0, 10)
  const recent = active.filter((o) => o.effective_date >= windowStartStr)
  const postDue = recent.filter((o) => o.effective_date >= dueDate)

  if (recent.length === 0) {
    const last = active[0]
    return {
      classification: 'NO_POST_DUE_EVIDENCE',
      lastEvidenceDate: last?.effective_date ?? null,
      lastEvidenceLabel: last?.label ?? null,
      validationStatus: null,
      rationale: 'occurrences trop anciennes (>60 j avant due_date)',
    }
  }

  if (postDue.length === 0) {
    const last = recent[0]
    return {
      classification: 'OVERDUE_WITHOUT_PROGRESS_EVIDENCE',
      lastEvidenceDate: last?.effective_date ?? null,
      lastEvidenceLabel: last?.label ?? null,
      validationStatus: null,
      rationale: 'observations présentes, aucune postérieure à la date prévue',
    }
  }

  const checked = postDue.filter((o) => o.visit_status === 'field_checked')
  if (checked.length > 0) {
    const best = checked.find((o) => o.validation_status === 'confirmed') ?? checked[0]
    return {
      classification: 'FIELD_COMPLETION_EVIDENCE',
      lastEvidenceDate: best.effective_date,
      lastEvidenceLabel: best.label,
      validationStatus: best.validation_status === 'confirmed' ? 'confirmed' : 'observed',
      rationale: `${checked.length} occurrence(s) field_checked postérieure(s)`,
    }
  }

  const best = postDue[0]
  return {
    classification: 'FIELD_PROGRESS_OBSERVED',
    lastEvidenceDate: best.effective_date,
    lastEvidenceLabel: best.label,
    validationStatus: best.validation_status === 'confirmed' ? 'confirmed' : 'observed',
    rationale: `${postDue.length} occurrence(s) postérieure(s) à la date prévue`,
  }
}

/**
 * Confronte un lot d'échéances à leurs occurrences terrain.
 *
 * @returns Map<deadlineId, DeadlineFieldEvidence>
 *          Seules les échéances fournies apparaissent dans la map.
 *          Les échéances sans occurrence active reçoivent OVERDUE_WITHOUT_PROGRESS_EVIDENCE.
 */
export async function getDeadlineFieldEvidenceBatch(
  deadlines: ReadonlyArray<{ id: string; canonical_subject_id: string; due_date: string }>,
): Promise<Map<string, DeadlineFieldEvidence>> {
  if (deadlines.length === 0) return new Map()

  const csIds = [...new Set(deadlines.map((d) => d.canonical_subject_id))]
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, visit_status, validation_status, effective_date, label')
    .in('canonical_subject_id', csIds)

  if (error) return new Map()

  const occsByCs = new Map<string, RawOcc[]>()
  for (const o of (data ?? []) as RawOcc[]) {
    const list = occsByCs.get(o.canonical_subject_id) ?? []
    list.push(o)
    occsByCs.set(o.canonical_subject_id, list)
  }
  for (const list of occsByCs.values()) {
    list.sort((a, b) => b.effective_date.localeCompare(a.effective_date))
  }

  const result = new Map<string, DeadlineFieldEvidence>()
  for (const d of deadlines) {
    const occs = occsByCs.get(d.canonical_subject_id) ?? []
    result.set(d.id, classify(d.due_date, occs))
  }
  return result
}
