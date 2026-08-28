import 'server-only'

// P1-A — Contexte réel pour l'analyse de similarité entre canonical_subject.
//
// Remplace l'ancien stub (scripts/analyze-subject-similarities.ts::fetchSubjects,
// qui renvoyait first_seen_at/last_seen_at/current_status/is_stagnant/objets actifs
// systématiquement null/false/0) par le read-model produit réel
// (getNavigableSubjectsForSite). Chargeur unique, réutilisé par le batch CLI et
// par le déclenchement produit — jamais deux qualités de données différentes.

import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { isActorKind } from '@/lib/subjects/kind'
import type { SubjectForCandidates } from './similarity-candidates'
import type { SubjectInput } from './similarity-analyze'

export interface SimilarityContextSubject {
  forCandidates: SubjectForCandidates
  forAnalyze: SubjectInput
}

/**
 * Charge les sujets métier actifs d'un chantier (personnes/entreprises exclues)
 * avec leur contexte temporel/opérationnel réel et leur topic.
 */
export async function loadSimilarityContextSubjects(siteId: string): Promise<SimilarityContextSubject[]> {
  const navigable = await getNavigableSubjectsForSite(siteId)
  const businessSubjects = navigable.filter((s) => !isActorKind(s.durableKind))
  if (businessSubjects.length === 0) return []

  const supabase = createAdminClient()
  const csIds = businessSubjects.map((s) => s.canonicalSubjectId)
  const { data: topicRows } = await supabase
    .from('canonical_topic_subject')
    .select('canonical_subject_id, canonical_topic_id, canonical_topic(label)')
    .in('canonical_subject_id', csIds)

  const topicMap = new Map<string, { topicId: string; topicLabel: string }>()
  for (const row of topicRows ?? []) {
    const r = row as unknown as {
      canonical_subject_id: string
      canonical_topic_id: string
      canonical_topic: { label: string } | null
    }
    if (r.canonical_topic) {
      topicMap.set(r.canonical_subject_id, { topicId: r.canonical_topic_id, topicLabel: r.canonical_topic.label })
    }
  }

  return businessSubjects.map((s) => {
    const topic = topicMap.get(s.canonicalSubjectId)
    return {
      forCandidates: {
        id: s.canonicalSubjectId,
        label: s.title,
        aliases: s.aliases,
        topicId: topic?.topicId ?? null,
      },
      forAnalyze: {
        id: s.canonicalSubjectId,
        label: s.title,
        aliases: s.aliases,
        topicLabel: topic?.topicLabel ?? null,
        firstSeenAt: s.firstSeenAt,
        lastSeenAt: s.lastSeenAt,
        pvCount: s.pvCount,
        nativeOccurrenceCount: s.nativeOccurrenceCount,
        currentStatus: s.currentStatus,
        isStagnant: s.isStagnant,
        activeObjects: {
          actionsOpen: s.activeObjects.actionsOpen,
          reservesOpen: s.activeObjects.reservesOpen,
          decisionsOpen: s.activeObjects.decisionsOpen,
          deadlinesActive: s.activeObjects.deadlinesActive,
        },
      },
    }
  })
}
