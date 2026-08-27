import 'server-only'

// P-UI-R2c/R2d — Orchestrateur de la VOIE SÉMANTIQUE vers canonical_subject_similarity_suggestion.
//
// Complète le workflow humain de rapprochement pour les paires que la voie
// lexicale (generateCandidates) ne produit pas. Réutilise le MÊME juge
// (analyzeSubjectPair), la MÊME persistance (upsertSuggestion) et le MÊME gate
// que le cœur P-UI-R2b (shouldPersistSemanticSuggestion) — aucun second moteur,
// aucune nouvelle table, aucune nouvelle UI.
//
// R2d — séparation en deux temps pour la stratégie hybride :
//   1. buildSemanticFeedPlan  : GRATUIT (aucun LLM) — compte les paires candidates.
//      → permet de décider auto (coût borné) vs recherche approfondie explicite.
//   2. executeSemanticFeedPlan : coûteux (LLM + persistance gatée).
//
// Ne fusionne rien, ne crée aucune relation. dryRun=true → aucune écriture.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  detectTypeHint,
  fusionBlockReason,
  fusionWarningReason,
  normalizePairKey,
  generateCandidates,
} from './similarity-candidates'
import {
  analyzeSubjectPair,
  upsertSuggestion,
  shouldPersistSemanticSuggestion,
  type SimilarityResult,
} from './similarity-analyze'
import type { SimilarityContextSubject } from './similarity-context'
import { loadOccurrenceContextMap } from './occurrence-context'
import {
  buildSemanticFeedPairs,
  SEMANTIC_FEED_MAX_PAIRS,
  type SemanticFeedPlan,
} from './semantic-feed-candidates'

export interface SemanticFeedOptions {
  siteId: string
  /** Sujets touchés par l'import courant (seules sources autorisées). */
  touchedSubjectIds: string[]
  /** Paires déjà rejetées humainement (clés normalizePairKey). Fusionnées aux exclusions. */
  rejectedPairs?: Set<string>
  /** Cap dur ; au-delà, skip total. Défaut SEMANTIC_FEED_MAX_PAIRS. */
  cap?: number
  dryRun?: boolean
  userId?: string | null
  /** Observabilité par paire (dry-run / logs). */
  onPairAnalyzed?: (info: {
    aId: string; bId: string; aLabel: string; bLabel: string; result: SimilarityResult; persistable: boolean
  }) => void
}

export interface SemanticFeedPerSource {
  subjectId: string
  label: string
  evaluated: number
  llmCalls: number
  persistable: number
}

export interface SemanticFeedPersistable {
  aId: string; bId: string; aLabel: string; bLabel: string
  verdict: string; recommendation: string; sameObjectHypothesis: boolean; score: number; reason: string
}

export interface SemanticFeedSummary {
  sourceCount: number
  targetCount: number
  /** Paires candidates distinctes après exclusions (avant cap). */
  evaluatedPairCount: number
  capped: boolean
  cap: number
  llmCallCount: number
  /** Paires que le gate juge dignes d'une suggestion (same_subject | related+SOH). */
  persistableCount: number
  /** Suggestions réellement écrites (0 en dryRun). */
  persistedCount: number
  errorCount: number
  perSource: SemanticFeedPerSource[]
  persistable: SemanticFeedPersistable[]
}

// ── Plan (GRATUIT — aucun appel LLM) ────────────────────────────────────────────

export interface SemanticFeedPlanResult {
  plan: SemanticFeedPlan
  sourceIds: string[]
  targetIds: string[]
  cap: number
}

/**
 * Construit le plan de paires candidates de la voie sémantique SANS aucun appel LLM.
 * Sert à décider la cadence (auto vs recherche approfondie) et à afficher le compteur UI.
 */
export async function buildSemanticFeedPlan(
  subjects: SimilarityContextSubject[],
  opts: Pick<SemanticFeedOptions, 'siteId' | 'touchedSubjectIds' | 'rejectedPairs' | 'cap'>,
): Promise<SemanticFeedPlanResult> {
  const cap = opts.cap ?? SEMANTIC_FEED_MAX_PAIRS
  const rejectedPairs = opts.rejectedPairs ?? new Set<string>()
  const byId = new Map(subjects.map((s) => [s.forCandidates.id, s]))
  const targetIds = subjects.map((s) => s.forCandidates.id)
  const sourceIds = [...new Set(opts.touchedSubjectIds.filter((id) => byId.has(id)))]

  if (sourceIds.length === 0 || targetIds.length < 2) {
    return { plan: { pairs: [], evaluatedPairCount: 0, capped: false }, sourceIds, targetIds, cap }
  }

  const excludedPairKeys = new Set<string>(rejectedPairs)
  // Paires déjà produites par la voie lexicale : elles suivent leur propre chemin.
  for (const c of generateCandidates(subjects.map((s) => s.forCandidates), rejectedPairs)) {
    excludedPairKeys.add(normalizePairKey(c.a.id, c.b.id))
  }
  // Paires déjà pending / acceptées / rejetées en base : ni doublon, ni re-analyse coûteuse.
  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .select('subject_a_id, subject_b_id, status')
    .eq('site_id', opts.siteId)
    .in('status', ['pending', 'accepted_merge', 'accepted_link', 'rejected'])
  for (const r of (existing ?? []) as Array<{ subject_a_id: string; subject_b_id: string }>) {
    excludedPairKeys.add(normalizePairKey(r.subject_a_id, r.subject_b_id))
  }

  const plan = buildSemanticFeedPairs({ sourceIds, targetIds, excludedPairKeys, cap })
  return { plan, sourceIds, targetIds, cap }
}

// ── Exécution (coûteuse — LLM + persistance gatée) ──────────────────────────────

function emptySummary(planResult: SemanticFeedPlanResult, byId: Map<string, SimilarityContextSubject>): SemanticFeedSummary {
  return {
    sourceCount: planResult.sourceIds.length,
    targetCount: planResult.targetIds.length,
    evaluatedPairCount: planResult.plan.evaluatedPairCount,
    capped: planResult.plan.capped,
    cap: planResult.cap,
    llmCallCount: 0,
    persistableCount: 0,
    persistedCount: 0,
    errorCount: 0,
    perSource: planResult.sourceIds.map((id) => ({ subjectId: id, label: byId.get(id)!.forCandidates.label, evaluated: 0, llmCalls: 0, persistable: 0 })),
    persistable: [],
  }
}

/**
 * Exécute un plan déjà calculé : contexte d'occurrence → juge → persistance UNIQUEMENT via
 * shouldPersistSemanticSuggestion. Acteurs déjà exclus (contexte business-only). dryRun sûr.
 */
export async function executeSemanticFeedPlan(
  subjects: SimilarityContextSubject[],
  planResult: SemanticFeedPlanResult,
  opts: SemanticFeedOptions,
): Promise<SemanticFeedSummary> {
  const supabase = createAdminClient()
  const byId = new Map(subjects.map((s) => [s.forCandidates.id, s]))
  const { plan, sourceIds } = planResult
  const sourceSet = new Set(sourceIds)

  if (plan.capped) {
    console.log(`[semantic-feed] site=${opts.siteId} SKIP capped : ${plan.evaluatedPairCount} paires > cap ${planResult.cap}`)
    return emptySummary(planResult, byId)
  }
  if (plan.pairs.length === 0) return emptySummary(planResult, byId)

  // Contexte d'occurrence (compact) pour les extrémités réellement candidates.
  const neededIds = new Set<string>()
  for (const [a, b] of plan.pairs) { neededIds.add(a); neededIds.add(b) }
  const occContext = await loadOccurrenceContextMap([...neededIds])

  const perSource = new Map<string, SemanticFeedPerSource>()
  for (const id of sourceIds) perSource.set(id, { subjectId: id, label: byId.get(id)!.forCandidates.label, evaluated: 0, llmCalls: 0, persistable: 0 })
  const bump = (id: string, field: 'evaluated' | 'llmCalls' | 'persistable') => {
    const row = perSource.get(id)
    if (row) row[field]++
  }

  let llmCallCount = 0
  let persistableCount = 0
  let persistedCount = 0
  let errorCount = 0
  const persistable: SemanticFeedPersistable[] = []

  for (const [aId, bId] of plan.pairs) {
    const subjectA = byId.get(aId)!
    const subjectB = byId.get(bId)!
    if (sourceSet.has(aId)) bump(aId, 'evaluated')
    if (sourceSet.has(bId)) bump(bId, 'evaluated')

    const typeHintA = detectTypeHint(subjectA.forCandidates.label)
    const typeHintB = detectTypeHint(subjectB.forCandidates.label)
    const block = fusionBlockReason(typeHintA, typeHintB)
    const warn = block ? null : fusionWarningReason(typeHintA, typeHintB)

    try {
      const result = await analyzeSubjectPair(
        { ...subjectA.forAnalyze, occurrenceContext: occContext.get(aId) ?? null },
        { ...subjectB.forAnalyze, occurrenceContext: occContext.get(bId) ?? null },
        opts.userId ?? null,
        { typeHintA, typeHintB, fusionBlockReason: block, fusionWarningReason: warn },
      )
      llmCallCount++
      if (sourceSet.has(aId)) bump(aId, 'llmCalls')
      if (sourceSet.has(bId)) bump(bId, 'llmCalls')

      const persist = shouldPersistSemanticSuggestion(result.verdict, result.same_object_hypothesis)
      opts.onPairAnalyzed?.({
        aId, bId,
        aLabel: subjectA.forCandidates.label, bLabel: subjectB.forCandidates.label,
        result, persistable: persist,
      })

      if (persist) {
        persistableCount++
        if (sourceSet.has(aId)) bump(aId, 'persistable')
        if (sourceSet.has(bId)) bump(bId, 'persistable')
        persistable.push({
          aId, bId,
          aLabel: subjectA.forCandidates.label, bLabel: subjectB.forCandidates.label,
          verdict: result.verdict, recommendation: result.recommendation,
          sameObjectHypothesis: result.same_object_hypothesis, score: result.score, reason: result.reason,
        })
        if (!opts.dryRun) {
          const saved = await upsertSuggestion(supabase, opts.siteId, aId, bId, result)
          if ('error' in saved) errorCount++
          else persistedCount++
        }
      }
    } catch (e) {
      errorCount++
      console.error(`[semantic-feed] pair error ${aId}↔${bId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    sourceCount: sourceIds.length,
    targetCount: planResult.targetIds.length,
    evaluatedPairCount: plan.evaluatedPairCount,
    capped: false,
    cap: planResult.cap,
    llmCallCount,
    persistableCount,
    persistedCount,
    errorCount,
    perSource: [...perSource.values()],
    persistable,
  }
}

/** Convenience : plan puis exécution (dry-run script, action manuelle). */
export async function runSemanticFeed(
  subjects: SimilarityContextSubject[],
  opts: SemanticFeedOptions,
): Promise<SemanticFeedSummary> {
  const planResult = await buildSemanticFeedPlan(subjects, opts)
  return executeSemanticFeedPlan(subjects, planResult, opts)
}
