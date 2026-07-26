import type { EngagementProvenanceState } from '@/types/db'

// Libellé humain UNIQUE de la source d'un engagement, dérivé de la provenance
// structurée persistée. Le même contrat partout (audit, curation, synthèse IA) :
//   exact          → « CCAP.pdf — page 12 »
//   document_only  → « CCAP.pdf — page non localisée »
//   unavailable    → « Source non localisée »
// Module pur (aucune dépendance serveur) : importable côté client.

export interface ProvenanceLabelInput {
  state: EngagementProvenanceState
  filename: string | null
  pageNumber: number | null
}

export function provenanceSourceLabel({ state, filename, pageNumber }: ProvenanceLabelInput): string {
  if (state === 'exact') return `${filename} — page ${pageNumber}`
  if (state === 'document_only') return `${filename} — page non localisée`
  return 'Source non localisée'
}

// Dérive le MÊME état à trois valeurs pour une source de la synthèse IA
// (type Source : document + page posés côté serveur, verified = match fiable).
// « Une page inventée est pire que pas de page » : une source non vérifiée ne
// présente JAMAIS sa page comme un fait — la pièce reste (si connue), la page
// tombe. Pas de pièce démontrée → source non localisée.
export function deriveSynthesisSourceState({ document, page, verified }: {
  document?: string | null
  page?: number | null
  verified?: boolean
}): EngagementProvenanceState {
  if (!document) return 'unavailable'
  if (verified === false || page == null) return 'document_only'
  return 'exact'
}
