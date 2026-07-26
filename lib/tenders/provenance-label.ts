import type { EngagementProvenanceState, EngagementSourceType } from '@/types/db'

// Libellé humain UNIQUE de la source d'un engagement, dérivé de la provenance
// structurée persistée. Le même contrat partout (audit, curation, synthèse IA).
//
// Deux natures de source, jamais confondues :
//   📘 Exigence AO        → une clause d'une pièce (le document est CONNU) :
//        exact          → « 📘 Exigence AO — CCTP.pdf — page 12 »
//        document_only  → « 📘 Exigence AO — CCTP.pdf — page non localisée »
//   ✍️ Proposé (mémoire)  → un engagement rédigé par MemorIA dans le mémoire
//        technique : jamais rattaché à une pièce, aucun avertissement de source.
//
// Module pur (aucune dépendance serveur) : importable côté client.

export interface ProvenanceLabelInput {
  state: EngagementProvenanceState
  filename: string | null
  pageNumber: number | null
  /** Nature de la source. Absent/null = enregistrement historique → libellé neutre. */
  sourceType?: EngagementSourceType | null
}

export function provenanceSourceLabel({ state, filename, pageNumber, sourceType }: ProvenanceLabelInput): string {
  // Proposition du mémoire technique : ce n'est PAS une exigence d'AO et ce n'est
  // rattaché à aucune pièce. On ne présente jamais ça comme « source non localisée ».
  if (sourceType === 'memoire_engagement') return '✍️ Proposé dans le mémoire technique'

  // Exigence d'AO : le document est connu → on le NOMME, jamais « source non
  // localisée ». Le préfixe « Exigence AO » n'est posé que si le type est
  // explicite (rétrocompat : anciens enregistrements → libellé neutre, sans régression).
  const prefix = sourceType === 'ao_clause' ? '📘 Exigence AO — ' : ''
  if (state === 'exact') return `${prefix}${filename} — page ${pageNumber}`
  if (state === 'document_only') return `${prefix}${filename} — page non localisée`
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
