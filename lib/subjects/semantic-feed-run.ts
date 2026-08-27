import 'server-only'

// P-UI-R2c — Orchestrateur de la VOIE SÉMANTIQUE vers canonical_subject_similarity_suggestion.
//
// Complète le workflow humain de rapprochement pour les paires que la voie
// lexicale (generateCandidates) ne produit pas. Réutilise le MÊME juge
// (analyzeSubjectPair), la MÊME persistance (upsertSuggestion) et le MÊME gate
// que le cœur P-UI-R2b (shouldPersistSemanticSuggestion) — aucun second moteur,
// aucune nouvelle table, aucune nouvelle UI.
//
// Sélection des paires = buildSemanticFeedPairs (pur) : sources touchées × cibles
// actives, exclusions strictes, cap dur. Ici on ajoute le coût réel : contexte
// d'occurrence + appels LLM bornés + persistance gatée.
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
import { buildSemanticFeedPairs, SEMANTIC_FEED_MAX_PAIRS } from './semantic-feed-candidates'

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

export async function runSemanticFeed(
  subjects: SimilarityContextSubject[],
  opts: SemanticFeedOptions,
): Promise<SemanticFeedSummary> {
  const supabase = createAdminClient()
  const cap = opts.cap ?? SEMANTIC_FEED_MAX_PAIRS
  const rejectedPairs = opts.rejectedPairs ?? new Set<string>()

  const byId = new Map(subjects.map((s) => [s.forCandidates.id, s]))
  const targetIds = subjects.map((s) => s.forCandidates.id)
  const sourceSet = new Set(opts.touchedSubjectIds.filter((id) => byId.has(id)))
  const sourceIds = [...sourceSet]

  const emptySummary = (evaluatedPairCount: number, capped: boolean): SemanticFeedSummary => ({
    sourceCount: sourceIds.length,
    targetCount: targetIds.length,
    evaluatedPairCount,
    capped,
    cap,
    llmCallCount: 0,
    persistableCount: 0,
    persistedCount: 0,
    errorCount: 0,
    perSource: sourceIds.map((id) => ({ subjectId: id, label: byId.get(id)!.forCandidates.label, evaluated: 0, llmCalls: 0, persistable: 0 })),
    persistable: [],
  })

  if (sourceIds.length === 0 || targetIds.length < 2) return emptySummary(0, false)

  // ── Exclusions : lexical-couvert ∪ rejeté ∪ pending ∪ accepté ────────────────
  const excludedPairKeys = new Set<string>(rejectedPairs)

  // Paires déjà produites par la voie lexicale : elles suivent leur propre chemin.
  for (const c of generateCandidates(subjects.map((s) => s.forCandidates), rejectedPairs)) {
    excludedPairKeys.add(normalizePairKey(c.a.id, c.b.id))
  }

  // Paires déjà pending / acceptées / rejetées en base : ni doublon, ni re-analyse coûteuse.
  const { data: existing } = await supabase
    .from('canonical_subject_similarity_suggestion')
    .select('subject_a_id, subject_b_id, status')
    .eq('site_id', opts.siteId)
    .in('status', ['pending', 'accepted_merge', 'accepted_link', 'rejected'])
  for (const r of (existing ?? []) as Array<{ subject_a_id: string; subject_b_id: string }>) {
    excludedPairKeys.add(normalizePairKey(r.subject_a_id, r.subject_b_id))
  }

  // ── Plan de paires (pur) ─────────────────────────────────────────────────────
  const plan = buildSemanticFeedPairs({ sourceIds, targetIds, excludedPairKeys, cap })
  if (plan.capped) {
    console.log(`[semantic-feed] site=${opts.siteId} SKIP capped : ${plan.evaluatedPairCount} paires > cap ${cap}`)
    return emptySummary(plan.evaluatedPairCount, true)
  }
  if (plan.pairs.length === 0) return emptySummary(0, false)

  // ── Contexte d'occurrence (compact) pour les extrémités réellement candidates ─
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
    targetCount: targetIds.length,
    evaluatedPairCount: plan.evaluatedPairCount,
    capped: false,
    cap,
    llmCallCount,
    persistableCount,
    persistedCount,
    errorCount,
    perSource: [...perSource.values()],
    persistable,
  }
}
