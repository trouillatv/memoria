// MÉMOIRE DU VERDICT « SANS OBJET » (WOW-2A′) — fonction PURE.
//
// Un seul job : MemorIA ne repose pas à David une question qu'il a déjà
// explicitement déclarée « sans objet », tant que rien n'a changé et que le
// contexte de visite reste le même.
//
// Règle figée (Vincent 2026-09-05) :
//   Un objet déjà déclaré `not_applicable` n'est pas reproposé automatiquement
//   pour le même chantier + même objet source + même motif de visite, tant que
//   la source n'a pas matériellement changé.
//
// Ce que ce module n'est PAS : un moteur de contrôlabilité terrain. Il ne
// classe rien, ne juge pas ce qui « mérite » un contrôle, n'utilise aucun
// label ni mot-clé métier, aucune IA. Identité = source_kind + source_ref.
// Le canonical_subject éventuel est un enrichissement, jamais un prérequis.
//
// Les autres états restent INCHANGÉS par ce lot : `checked` ne supprime rien,
// `still_open` reste reproposable, `pending` n'est pas un verdict.

import type { VisitMotive } from '@/types/db'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'

/** Un verdict humain « sans objet » déjà rendu sur ce chantier. */
export interface NotApplicableVerdict {
  source_kind: string
  source_ref: string
  /** Motif de la visite pendant laquelle le verdict a été rendu. */
  visit_motive: VisitMotive | null
  /** Horodatage du verdict (updated_at de l'item — le geste humain). */
  decided_at: string
}

/** Clé d'identité d'un candidat : l'objet source, rien d'autre. */
export function watchlistSourceKey(sourceKind: string, sourceRef: string): string {
  return `${sourceKind}|${sourceRef}`
}

/** Familles dont un « sans objet » n'est JAMAIS mémorisé.
 *  `proof_window_closing` = fenêtre de preuve irréversible (priorité critical) :
 *  taire la question une seule fois à tort coûte une preuve définitivement perdue.
 *  Son source_ref est en outre ambigu entre deux tables (intervention | action),
 *  donc son identité n'est pas fiable — deux raisons de ne jamais le supprimer. */
const NEVER_SUPPRESSED: ReadonlySet<string> = new Set(['proof_window_closing'])

/** Dernier verdict « sans objet » par source, POUR CE MOTIF uniquement.
 *  Un changement de motif = nouveau contexte de visite : le verdict ne se propage pas. */
function lastVerdictBySource(
  motive: VisitMotive | null,
  verdicts: NotApplicableVerdict[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const v of verdicts) {
    if (!v.source_ref) continue
    if ((v.visit_motive ?? null) !== (motive ?? null)) continue
    const key = watchlistSourceKey(v.source_kind, v.source_ref)
    const previous = out.get(key)
    if (!previous || v.decided_at > previous) out.set(key, v.decided_at)
  }
  return out
}

/** Sources dont la fraîcheur doit être vérifiée : celles — et seulement celles —
 *  qu'un verdict « sans objet » du même motif pourrait faire taire. Évite de
 *  relire toute la base pour des candidats qui n'ont jamais été écartés. */
export function proposalsNeedingFreshness(
  proposals: WatchlistProposal[],
  motive: VisitMotive | null,
  verdicts: NotApplicableVerdict[],
): Array<{ source_kind: string; source_ref: string }> {
  const settled = lastVerdictBySource(motive, verdicts)
  if (settled.size === 0) return []
  return proposals
    .filter((p) => !!p.source_ref
      && !NEVER_SUPPRESSED.has(p.source_kind)
      && settled.has(watchlistSourceKey(p.source_kind, p.source_ref)))
    .map((p) => ({ source_kind: p.source_kind, source_ref: p.source_ref as string }))
}

/**
 * Retire des propositions automatiques celles déjà déclarées « sans objet »
 * pour le MÊME motif, sur une source qui n'a pas bougé depuis le verdict.
 *
 * `sourceChangedAt` porte la fraîcheur métier de chaque source :
 *   - clé ABSENTE       → source introuvable / famille non couverte → on redemande ;
 *   - valeur `null`     → source lue, aucune horloge de changement posée → inchangée ;
 *   - valeur ISO        → date du dernier changement matériel enregistré.
 * La direction d'échec est volontairement conservatrice : dans le doute, on
 * repropose (bruit) plutôt que de taire (perte).
 */
export function filterSettledNotApplicable(
  proposals: WatchlistProposal[],
  motive: VisitMotive | null,
  verdicts: NotApplicableVerdict[],
  sourceChangedAt: ReadonlyMap<string, string | null>,
): WatchlistProposal[] {
  if (proposals.length === 0 || verdicts.length === 0) return proposals

  const lastNotApplicable = lastVerdictBySource(motive, verdicts)
  if (lastNotApplicable.size === 0) return proposals

  return proposals.filter((p) => {
    if (!p.source_ref) return true // sans identité de source, aucune mémoire possible
    if (NEVER_SUPPRESSED.has(p.source_kind)) return true
    const key = watchlistSourceKey(p.source_kind, p.source_ref)
    const decidedAt = lastNotApplicable.get(key)
    if (!decidedAt) return true // jamais déclaré sans objet dans ce contexte
    if (!sourceChangedAt.has(key)) return true // fraîcheur inconnue → on redemande
    const changedAt = sourceChangedAt.get(key) ?? null
    if (changedAt === null) return false // aucune trace de changement → verdict tenu
    return changedAt > decidedAt // changement matériel postérieur → nouvel épisode
  })
}
