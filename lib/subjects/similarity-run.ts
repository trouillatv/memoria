import 'server-only'

// P1-A — Exécution partagée de l'analyse de similarité (candidats → Gemini →
// persistance). Utilisé par le batch CLI (scripts/analyze-subject-similarities.ts)
// et par le déclenchement produit (lib/subjects/similarity-trigger.ts) — un seul
// chemin de code, pour ne jamais faire diverger le comportement des deux appelants.
//
// Ne fusionne rien, ne crée aucune relation : persiste uniquement des suggestions
// via upsertSuggestion, qui refuse déjà d'écraser une décision humaine
// (accepted_merge / accepted_link / rejected).

import { createAdminClient } from '@/lib/supabase/admin'
import { generateCandidates, type Candidate } from './similarity-candidates'
import { analyzeSubjectPair, upsertSuggestion, type SimilarityResult } from './similarity-analyze'
import type { SimilarityContextSubject } from './similarity-context'

export interface SimilarityRunOptions {
  siteId: string
  /** Paires déjà rejetées humainement — jamais reproposées (sauf appelant qui choisit de vider ce set). */
  rejectedPairs?: Set<string>
  /**
   * Scope incrémental : ne retenir que les paires dont au moins un membre
   * appartient à ce set (sujets touchés × sujets actifs). null/undefined = full scope.
   */
  scopeSubjectIds?: Set<string> | null
  dryRun?: boolean
  userId?: string | null
  onPairAnalyzed?: (info: {
    subjectA: SimilarityContextSubject
    subjectB: SimilarityContextSubject
    candidate: Candidate
    result: SimilarityResult
  }) => void
  onPairError?: (info: { subjectA: SimilarityContextSubject; subjectB: SimilarityContextSubject; error: string }) => void
}

export interface SimilarityRunSummary {
  subjectCount: number
  candidateCount: number
  scopedCandidateCount: number
  analyzedCount: number
  persistedCount: number
  errorCount: number
}

export async function runSimilarityAnalysisForSubjects(
  subjects: SimilarityContextSubject[],
  opts: SimilarityRunOptions,
): Promise<SimilarityRunSummary> {
  const supabase = createAdminClient()
  const rejectedPairs = opts.rejectedPairs ?? new Set<string>()

  const candidates = generateCandidates(
    subjects.map((s) => s.forCandidates),
    rejectedPairs,
  )
  const scoped = opts.scopeSubjectIds
    ? candidates.filter((c) => opts.scopeSubjectIds!.has(c.a.id) || opts.scopeSubjectIds!.has(c.b.id))
    : candidates

  const byId = new Map(subjects.map((s) => [s.forCandidates.id, s]))
  let analyzedCount = 0
  let persistedCount = 0
  let errorCount = 0

  for (const candidate of scoped) {
    const subjectA = byId.get(candidate.a.id)
    const subjectB = byId.get(candidate.b.id)
    if (!subjectA || !subjectB) continue

    try {
      const result = await analyzeSubjectPair(subjectA.forAnalyze, subjectB.forAnalyze, opts.userId ?? null, {
        typeHintA: candidate.typeHintA,
        typeHintB: candidate.typeHintB,
        fusionBlockReason: candidate.fusionBlockReason,
        fusionWarningReason: candidate.fusionWarningReason,
      })
      analyzedCount++
      opts.onPairAnalyzed?.({ subjectA, subjectB, candidate, result })

      if (!opts.dryRun) {
        const saved = await upsertSuggestion(supabase, opts.siteId, subjectA.forCandidates.id, subjectB.forCandidates.id, result)
        if ('error' in saved) {
          errorCount++
          opts.onPairError?.({ subjectA, subjectB, error: saved.error })
        } else {
          persistedCount++
        }
      }
    } catch (e) {
      errorCount++
      opts.onPairError?.({ subjectA, subjectB, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    subjectCount: subjects.length,
    candidateCount: candidates.length,
    scopedCandidateCount: scoped.length,
    analyzedCount,
    persistedCount,
    errorCount,
  }
}
