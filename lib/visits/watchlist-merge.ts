// Fusion des sélections humaines préparatoires avec les propositions automatiques.
//
// Règle de déduplication Phase 1 :
// - Chaque item humain porte un stable_key ('attention:csId', 'verify:csId', …).
// - Les propositions auto sont dédupliquées par source_ref (artifact ID).
// - Un item humain éclipse une proposition auto si elle a le même source_ref
//   que le stable_key de la sélection humaine, ou si le label normalisé correspond.
// - Les items humains passent en premier dans la liste finale (priorité visuelle).
// - source_kind = 'human_prep' : distingue "MemorIA a proposé" de "l'humain a choisi".
//
// Phase 2 : déduplication par canonical_subject_id entre les deux pools,
// une fois que les propositions auto portent cet identifiant.
//
// Aucune dépendance serveur — testable sans DB (projet unit).

import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import type { PrepItem } from '@/lib/db/visit-preparation'

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9àâéèêëîïôùûüç]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Convertit une sélection humaine préparatoire en proposition de watchlist.
 *  source_kind = 'human_prep' → traçabilité permanente dans visit_watchlist_item. */
export function prepItemToProposal(item: PrepItem): WatchlistProposal {
  return {
    label: item.label,
    source_kind: 'human_prep',
    source_ref: item.canonicalSubjectId ?? item.stableKey,
    priority: item.priority,
    reason: item.reason,
  }
}

/** Fusionne les sélections humaines et les propositions automatiques.
 *  - Items humains : tous conservés, source_kind = 'human_prep'.
 *  - Propositions auto : ajoutées seulement si elles ne doublonnent pas
 *    un item humain (par source_ref ou label normalisé).
 *  - Résultat : items humains en tête, auto après, max WATCHLIST_MAX total. */
export function mergeProposals(
  humanItems: PrepItem[],
  autoProposals: WatchlistProposal[],
  max = 7,
): WatchlistProposal[] {
  const result: WatchlistProposal[] = humanItems.map(prepItemToProposal)

  if (result.length >= max) return result.slice(0, max)

  // Index de déduplication : source_refs et labels normalisés déjà présents.
  const usedRefs = new Set(
    humanItems
      .flatMap((i) => [i.stableKey, i.sourceRef, i.canonicalSubjectId].filter(Boolean) as string[]),
  )
  const usedLabels = new Set(humanItems.map((i) => normalizeLabel(i.label)))

  for (const p of autoProposals) {
    if (result.length >= max) break

    const ref = p.source_ref ?? ''
    const lbl = normalizeLabel(p.label)

    if (ref && usedRefs.has(ref)) continue
    if (usedLabels.has(lbl)) continue

    result.push(p)
    if (ref) usedRefs.add(ref)
    usedLabels.add(lbl)
  }

  return result
}
