// Phase 6E.4D — récapitulatif après clarification : "Qu'est-ce que je viens d'aider MemorIA à
// comprendre ?" Construit exclusivement à partir des actions RÉELLEMENT confirmées (ok:true) par
// les server actions 6E.4A déjà existantes pendant la session en cours — jamais recalculé depuis
// la file pending restante, jamais un second moteur de détection.
//
// Doctrine Vincent (mandat 6E.4D) : le recap décrit l'ACTE de clarification, jamais une vérité
// métier supplémentaire non prouvée. Interdits : "problème résolu", "réserve levée", "Point
// supprimé", "MemorIA a corrigé…". Les libellés métier (`labels`) ne sont jamais fabriqués ici :
// l'appelant (NeedsYouCards.tsx) ne transmet que le texte déjà montré à l'utilisateur avant
// confirmation (le même que ImpactPreview) — `null` quand aucun libellé réel n'existe.

import { MEMORIA_NEEDS_YOU_CATEGORY_ORDER, type MemoriaNeedsYouCategory } from './tracked-point-needs-you-categories'

export type MemoriaNeedsYouRecapEntry = {
  category: MemoriaNeedsYouCategory
  label: string | null
}

export type MemoriaNeedsYouRecapLine = {
  category: MemoriaNeedsYouCategory
  count: number
  text: string
}

export type MemoriaNeedsYouRecap = {
  totalCount: number
  lines: MemoriaNeedsYouRecapLine[]
  labels: string[]
}

// Bornée volontairement (mandat : "quelques libellés métier utiles", pas une liste exhaustive) —
// jamais présentée comme la totalité des suivis touchés.
const MAX_LABELS = 5

function recapLineText(category: MemoriaNeedsYouCategory, count: number): string {
  switch (category) {
    case 'duplicate_points':
      return count === 1 ? '1 suivi réuni' : `${count} suivis réunis`
    case 'attach_information':
      return count === 1 ? '1 information rattachée à un suivi' : `${count} informations rattachées à un suivi`
    case 'confirm_trackability':
      return count === 1
        ? '1 nouvelle situation reconnue comme suivi distinct'
        : `${count} nouvelles situations reconnues comme suivis distincts`
    case 'assign_resolution':
      return count === 1 ? '1 résolution rattachée à un suivi existant' : `${count} résolutions rattachées à des suivis existants`
    case 'clarify_evidence':
      return count === 1 ? '1 preuve clarifiée' : `${count} preuves clarifiées`
  }
}

export function buildMemoriaNeedsYouRecap(entries: MemoriaNeedsYouRecapEntry[]): MemoriaNeedsYouRecap {
  const counts: Record<MemoriaNeedsYouCategory, number> = {
    duplicate_points: 0,
    attach_information: 0,
    confirm_trackability: 0,
    assign_resolution: 0,
    clarify_evidence: 0,
  }
  const labels: string[] = []
  const seenLabels = new Set<string>()
  for (const entry of entries) {
    counts[entry.category]++
    if (entry.label && !seenLabels.has(entry.label) && labels.length < MAX_LABELS) {
      seenLabels.add(entry.label)
      labels.push(entry.label)
    }
  }

  const lines = MEMORIA_NEEDS_YOU_CATEGORY_ORDER.filter((c) => counts[c] > 0).map((c) => ({
    category: c,
    count: counts[c],
    text: recapLineText(c, counts[c]),
  }))

  return { totalCount: entries.length, lines, labels }
}
