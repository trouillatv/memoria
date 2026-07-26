import type { EngagementProvenanceState } from '@/types/db'

// Libellé humain UNIQUE de la source d'un engagement, dérivé de la provenance
// structurée persistée. Le même contrat partout (audit, curation) :
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
