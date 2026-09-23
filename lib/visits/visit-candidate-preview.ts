import 'server-only'

// READ-MODEL PARTAGÉ (WOW-2D) — la population machine de la liste de visite.
//
// Une seule chaîne, deux consommateurs : le seed (startVisitAction) ET le Briefing
// mobile. Ce que David voit dans le Briefing machine est EXACTEMENT ce qui sera
// seedé au démarrage, avant l'ajout de son plan humain (human_prep).
//
// Chaîne (identique au seed WOW-2C) :
//   buildSiteMemorySignals
//   → buildWatchlistProposals (sans plafond)
//   → mémoire WOW-2A′ (filterSettledNotApplicable, legacy `not_applicable` uniquement)
//   → deriveVisitCandidates (WOW-2B, ordre historique)
//   → top WATCHLIST_MAX
//
// Doctrine Plan de visite Lot B (revue Vincent) : la disparition à N+1 d'une
// source « Ne plus suivre » vient EXCLUSIVEMENT de la mutation de l'objet métier
// lui-même (action → cancelled, décision → caduque, obligation → non_applicable),
// déjà appliquée par l'orchestrateur AVANT l'écriture watchlist. Ces états sont
// ce que filtrent nativement detectOverdueActions (status='open') et
// detectUnappliedDecisions (statut='actee') dans site-memory-signals.ts — aucun
// filtre supplémentaire ici. `dismissed_permanently` sur visit_watchlist_item
// reste une TRACE HISTORIQUE (pour le récit du CR) : il n'est JAMAIS relu comme
// mémoire de sélection N+1. Le rejouer comme filtre indépendant recréerait le bug
// que Lot B corrige : une source réouverte par un humain (statut métier courant
// redevenu éligible) resterait masquée pour toujours par un ancien verdict figé.
// Même règle pour `not_applicable_visit` : un pur constat de visite, jamais une
// mémoire de sélection — il doit rester reproposable à N+1 sans condition.
//
// Aucun recalcul local de verificationMode (dérivé de source_kind), aucun parsing
// de label, aucun LLM, aucun rankVisitCandidates. human_prep n'entre PAS ici : il
// est fusionné en aval par mergeProposals, jamais dans la population machine.

import type { VisitMotive } from '@/types/db'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { buildWatchlistProposals, WATCHLIST_MAX } from '@/lib/visits/watchlist-proposals'
import { filterSettledNotApplicable, proposalsNeedingFreshness } from '@/lib/visits/watchlist-not-applicable-memory'
import { loadNotApplicableVerdicts, loadSourceChangedAt } from '@/lib/db/watchlist-not-applicable'
import { deriveVisitCandidates, type ObjectVisitCandidate, type VerificationMode } from '@/lib/visits/visit-candidates'

/**
 * Population machine des candidats de visite (top WATCHLIST_MAX), object-first.
 * `motive` null = contexte de préparation (le motif n'est pas encore choisi) → mêmes
 * kinds que le suivi par défaut. Le seed passe le motif réel ; à motif égal, la
 * sortie est identique — c'est la garantie « preview == seed ».
 */
export async function buildVisitCandidatePreview(
  siteId: string,
  motive: VisitMotive | null,
): Promise<ObjectVisitCandidate[]> {
  const [signals, verdicts] = await Promise.all([
    buildSiteMemorySignals(siteId),
    loadNotApplicableVerdicts(siteId).catch(() => []),
  ])
  const proposals = buildWatchlistProposals(signals, motive, Number.MAX_SAFE_INTEGER)
  const changedAt = await loadSourceChangedAt(
    proposalsNeedingFreshness(proposals, motive, verdicts),
  ).catch(() => new Map<string, string | null>())
  const kept = filterSettledNotApplicable(proposals, motive, verdicts, changedAt)
  return deriveVisitCandidates(kept).slice(0, WATCHLIST_MAX)
}

/** Deux registres de visite, dans l'ordre historique intra-mode (PAS un nouveau
 *  ranking global) : « À constater sur place » (field_check) / « À demander·confirmer »
 *  (ask_confirm). Fonction PURE — testable sans DB. */
export function partitionByVerificationMode(
  candidates: ObjectVisitCandidate[],
): Record<VerificationMode, ObjectVisitCandidate[]> {
  const out: Record<VerificationMode, ObjectVisitCandidate[]> = { field_check: [], ask_confirm: [] }
  for (const c of candidates) out[c.verificationMode].push(c)
  return out
}
