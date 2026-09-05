// PROJECTION TERRAIN V1 (WOW-2B) — primitive PURE, object-first.
//
// Un seul job : projeter la population OPÉRATIONNELLE object-first (les
// propositions déjà construites par buildWatchlistProposals ← buildSiteMemorySignals)
// en candidats de visite portant un MODE DE VÉRIFICATION déterministe :
//   - field_check  : quelque chose à CONSTATER / vérifier sur place ;
//   - ask_confirm  : quelque chose à DEMANDER / faire confirmer.
//
// Doctrine figée (Vincent 2026-09-05) :
//   • verificationMode répond « COMMENT ce point se traite-t-il pendant la visite ? ».
//     Il vient d'une POLITIQUE explicite par source_kind — aucun LLM, aucun mot-clé
//     métier, aucune classification par libellé.
//   • P2-2 (attentionCategory) répond « quelle ATTENTION mérite-t-il actuellement ? »,
//     P0-2 (displayState) « quel est son ÉTAT longitudinal ? », C2A (cboState)
//     « quel est le lifecycle DURABLE de l'objet lié ? ». Ces trois vérités peuvent
//     ENRICHIR et RANKER un candidat, mais ne transforment JAMAIS un ask_confirm en
//     field_check. `reopened` est un booster transversal, jamais un mode.
//   • Enrichissement = LECTURE de vérités calculées ailleurs. Absence de rattachement
//     canonique ⇒ enrichissements absents, jamais reconstruits ni fuzzy-matchés ici
//     (crucial pour décisions/obligations hors canon).
//
// Ce que ce lot ne fait PAS : pas de context_only, pas de silence documentaire (pas
// d'objet source → hors object-first, futur WOW-3), pas de site_watchpoints, pas de
// deadlines sujet-first. La porte reste ouverte à une future branche
// SubjectContextCandidate : c'est pourquoi VisitCandidate est une UNION discriminée
// et que `candidateKind` existe dès aujourd'hui, même avec un seul membre.

import type { WatchlistItemPriority } from '@/types/db'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import type { AttentionCategory } from '@/lib/knowledge/canonical-attention'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'

/** Comment David traite le point pendant la visite. Deux modes en V1 (WOW-2B). */
export type VerificationMode = 'field_check' | 'ask_confirm'

/**
 * Vérités canoniques d'un sujet rattaché — LUES, jamais recalculées ici.
 * Toutes optionnelles : un objet hors canon (décision, obligation) n'en porte aucune.
 */
export interface SubjectEnrichment {
  canonicalSubjectId: string
  /** P2-2 — attention métier actuelle. */
  attentionCategory?: AttentionCategory
  /** P0-2 — état longitudinal courant (open|resolved|reopened|unknown). */
  displayState?: CanonicalDisplayState
  /** C2A — état durable réduit de l'objet lié (enum riche du lifecycle CBO). */
  cboState?: string
}

/** Candidat opérationnel object-first : un objet réel que David peut contrôler ou
 *  faire confirmer. Identité = source_kind + source_ref (compatible mémoire WOW-2A′). */
export interface ObjectVisitCandidate {
  /** Discriminant d'union — laisse la place à une future branche SubjectContextCandidate. */
  candidateKind: 'object'
  sourceKind: string
  sourceRef: string
  label: string
  reason: string | null
  /** Mode déterministe issu de la politique — jamais modifié par l'enrichissement. */
  verificationMode: VerificationMode
  priority: WatchlistItemPriority
  // ── Enrichissements optionnels (absents si pas de rattachement canonique) ──
  canonicalSubjectId?: string
  attentionCategory?: AttentionCategory
  displayState?: CanonicalDisplayState
  cboState?: string
  /** Booster transversal : le sujet lié est réouvert (P0-2). Priorise/rend visible,
   *  ne change JAMAIS le verificationMode. Faux si pas d'enrichissement. */
  reopenedBoost: boolean
}

/** Union des candidats de visite. Un seul membre en WOW-2B ; la branche
 *  SubjectContextCandidate (silence documentaire, reopened sans objet) viendra en
 *  WOW-3 sans re-clé de l'identité object-first (donc sans casser WOW-2A′). */
export type VisitCandidate = ObjectVisitCandidate

/**
 * POLITIQUE V1 — source_kind → mode de vérification. Explicite, déterministe, sans IA.
 * Ne couvre QUE la population A opérationnelle. Un source_kind absent d'ici n'est pas
 * deviné : le candidat n'est pas produit (pas de mode inventé).
 */
export const VISIT_MODE_POLICY: Readonly<Record<string, VerificationMode>> = {
  proof_window_closing: 'field_check', // preuve/constat terrain explicitement demandé
  reserve_open: 'field_check',         // réserve à constater sur place
  action_overdue: 'ask_confirm',       // l'objet A formule « où en est-on ? »
  decision_unapplied: 'ask_confirm',   // décision à faire confirmer
  obligation_neglected: 'ask_confirm', // prescription/obligation à faire confirmer
}

/**
 * Projette la population opérationnelle object-first en candidats de visite typés.
 *
 * `enrichment` porte, par clé d'identité (`watchlistSourceKey`), les vérités
 * canoniques du sujet rattaché. Clé absente = pas de rattachement = candidat nu
 * (jamais reconstruit). L'enrichissement ne décide jamais du mode.
 */
export function deriveVisitCandidates(
  proposals: WatchlistProposal[],
  enrichment: ReadonlyMap<string, SubjectEnrichment> = new Map(),
): ObjectVisitCandidate[] {
  const out: ObjectVisitCandidate[] = []
  for (const p of proposals) {
    if (!p.source_ref) continue // sans identité de source, pas un candidat object-first
    const mode = VISIT_MODE_POLICY[p.source_kind]
    if (!mode) continue // source_kind hors politique : on n'invente pas de mode
    const key = watchlistSourceKey(p.source_kind, p.source_ref)
    const enr = enrichment.get(key)
    const candidate: ObjectVisitCandidate = {
      candidateKind: 'object',
      sourceKind: p.source_kind,
      sourceRef: p.source_ref,
      label: p.label,
      reason: p.reason,
      verificationMode: mode,
      priority: p.priority,
      reopenedBoost: enr?.displayState === 'reopened',
    }
    // Enrichissements posés uniquement s'ils existent — jamais de valeur fabriquée.
    if (enr) {
      candidate.canonicalSubjectId = enr.canonicalSubjectId
      if (enr.attentionCategory) candidate.attentionCategory = enr.attentionCategory
      if (enr.displayState) candidate.displayState = enr.displayState
      if (enr.cboState) candidate.cboState = enr.cboState
    }
    out.push(candidate)
  }
  return out
}

/** Rang de mode pour un tri stable : le constat physique d'abord (on est sur place). */
const MODE_RANK: Record<VerificationMode, number> = { field_check: 0, ask_confirm: 1 }
/** Rang de priorité déterministe (mêmes valeurs que la watchlist). */
const PRIORITY_RANK: Record<WatchlistItemPriority, number> = { critical: 0, important: 1, normal: 2 }
/** Rang d'attention P2-2 : act_now d'abord ; absente = neutre (entre watch et dormant). */
const CATEGORY_RANK: Record<AttentionCategory, number> = {
  act_now: 0, watch: 1, dormant: 2, documentary_silence: 3,
}
const CATEGORY_NEUTRAL = 1.5

/**
 * Ordre d'affichage déterministe. L'enrichissement RANKE (il ne reclasse pas le mode) :
 *   reopened d'abord (booster transversal) → mode (field_check avant ask_confirm)
 *   → attention P2-2 (act_now d'abord) → priorité source. Aucun accès horloge/aléa.
 */
export function rankVisitCandidates(candidates: ObjectVisitCandidate[]): ObjectVisitCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.reopenedBoost !== b.reopenedBoost) return a.reopenedBoost ? -1 : 1
    const m = MODE_RANK[a.verificationMode] - MODE_RANK[b.verificationMode]
    if (m !== 0) return m
    const ca = a.attentionCategory ? CATEGORY_RANK[a.attentionCategory] : CATEGORY_NEUTRAL
    const cb = b.attentionCategory ? CATEGORY_RANK[b.attentionCategory] : CATEGORY_NEUTRAL
    if (ca !== cb) return ca - cb
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  })
}
