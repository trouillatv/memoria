import 'server-only'

// Journalisation shadow des verdicts V2.
//
// Déclenchement : fire-and-forget depuis projectAndTrace(), après reconcileSourceToCanonicalSubjects().
// Périmètre    : uniquement les canonical_subjects touchés par le rapport courant (source_ref_id).
// Garantie     : aucune écriture dans les métriques officielles.

import { createAdminClient } from '@/lib/supabase/admin'
import { isEvolutionV2Enabled, classifySubjectEvolutionV2 } from './evolution-v2'
import { buildNativeEvolutionData } from '@/lib/db/canonical-subject-life'

const MOTOR_VERSION = 'v2.1'

export async function runEvolutionV2Shadow(params: {
  reportId: string
  siteId: string
}): Promise<void> {
  const { reportId, siteId } = params
  if (!isEvolutionV2Enabled(siteId)) return

  const sb = createAdminClient()

  // 1. Sujets canoniques touchés par ce rapport
  const { data: affectedRaw } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id')
    .eq('source_ref_id', reportId)
    .not('validation_status', 'in', '("rejected","source_superseded")')

  const affectedIds = new Set((affectedRaw ?? []).map((r: { canonical_subject_id: string }) => r.canonical_subject_id))
  if (affectedIds.size === 0) return

  // 2. Données complètes des sujets du site (≥2 événements), filtrées aux sujets touchés
  const allSubjects = await buildNativeEvolutionData(siteId)
  const subjects = allSubjects.filter((s) => affectedIds.has(s.canonicalSubjectId))
  if (subjects.length === 0) return

  // 3. Classifier et persister chaque paire
  for (const subject of subjects) {
    if (subject.events.length < 2) continue

    let result
    try {
      result = await classifySubjectEvolutionV2({
        canonicalSubjectId: subject.canonicalSubjectId,
        label: subject.label,
        events: subject.events,
      })
    } catch {
      continue
    }

    for (const pair of result.pairs) {
      if (!pair.result) continue

      await sb
        .from('canonical_subject_evolution_shadow')
        .upsert(
          {
            site_id: siteId,
            canonical_subject_id: subject.canonicalSubjectId,
            event_t1_date: pair.stateT1.date.slice(0, 10),
            event_t1_source_kind: pair.stateT1.sourceKind,
            event_t2_date: pair.stateT2.date.slice(0, 10),
            event_t2_source_kind: pair.stateT2.sourceKind,
            state_t1: pair.stateT1,
            state_t2: pair.stateT2,
            verdict: pair.result.verdict,
            pattern: pair.result.pattern ?? null,
            justification: pair.result.justification,
            confidence: pair.result.confidence,
            motor_version: MOTOR_VERSION,
            calculated_at: new Date().toISOString(),
          },
          {
            onConflict: 'canonical_subject_id,event_t1_date,event_t1_source_kind,event_t2_date,event_t2_source_kind,motor_version',
          },
        )
        .then(undefined, (err: unknown) =>
          console.error('[evolution-v2-shadow] upsert erreur:', String(err).slice(0, 200)),
        )
    }
  }
}
