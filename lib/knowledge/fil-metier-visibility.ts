// P2-1 — sélection VISIBLE du Fil métier : fonction de PRÉSENTATION pure, fondée exclusivement sur les
// métadonnées déjà produites par le workflow (transition pv-history + date métier + dernière évolution).
// AUCUN score, AUCUN slice(N), AUCUNE nouvelle classification métier. Partagée desktop + mobile.
//
// Un groupe (= un PV/source) est VISIBLE ssi :
//   - c'est le DERNIER PV (date métier max des occurrences réelles), OU
//   - il porte ≥1 transition SIGNIFICATIVE (réouvert/aggravé/nouveau/réapparu/résolu), OU
//   - il porte la dernière évolution métier (lastMeaningfulChangeAt).
// Sinon → historique repliable. Aucune occurrence n'est supprimée.

/** Transitions métier significatives (HistoryTransition, pv-history). `maintenu`/`non_mentionné`/null
 *  = répétition/absence → repliable (jamais « significatif »). */
export const FIL_SIGNIFICANT_TRANSITIONS: ReadonlySet<string> = new Set(['nouveau', 'réouvert', 'aggravé', 'réapparu', 'résolu'])

export interface FilGroupLike {
  date: string
  occs: ReadonlyArray<{ isGap: boolean; transition: string | null }>
}

/** Date métier max parmi les groupes portant une occurrence réelle (le « dernier PV »). '' si aucun. */
export function filMaxDate(groups: ReadonlyArray<FilGroupLike>): string {
  return groups.reduce((mx, g) => (g.occs.some((o) => !o.isGap) && g.date > mx ? g.date : mx), '')
}

/** Un groupe est-il dans la zone visible ? (présentation pure, métadonnées existantes). */
export function isFilGroupVisible(group: FilGroupLike, maxDate: string, lastMeaningfulChangeAt: string | null): boolean {
  const hasReal = group.occs.some((o) => !o.isGap)
  if (group.date === maxDate && hasReal) return true
  if (group.occs.some((o) => !o.isGap && o.transition != null && FIL_SIGNIFICANT_TRANSITIONS.has(o.transition))) return true
  if (lastMeaningfulChangeAt != null && group.date === lastMeaningfulChangeAt && hasReal) return true
  return false
}

/** Partitionne les groupes (déjà construits, ordre chronologique conservé) en visibles / historique. */
export function partitionFilGroups<G extends FilGroupLike>(
  groups: ReadonlyArray<G>,
  lastMeaningfulChangeAt: string | null,
): { visible: G[]; history: G[] } {
  const maxDate = filMaxDate(groups)
  const visible: G[] = []
  const history: G[] = []
  for (const g of groups) (isFilGroupVisible(g, maxDate, lastMeaningfulChangeAt) ? visible : history).push(g)
  return { visible, history }
}
