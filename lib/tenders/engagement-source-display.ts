import type { EngagementSourceType } from '@/types/db'

// Presenter PARTAGÉ de la source d'un engagement — UNIQUE source de vérité pour :
// le badge, le libellé, l'icône, le document utilisé par le filtre, et l'état de
// localisation. Aucun composant ne doit reconstruire ces libellés séparément.
//
// Cinq états, jamais confondus (surtout : ne jamais présenter « source non
// localisée » quand le document est connu, ni pour le mémoire technique) :
//   ao_exact             📘 Exigence AO — CCTP.pdf — page 18
//   ao_document_only     📘 Exigence AO — CCTP.pdf — page non localisée
//   memoire              ✍️ Proposé dans le mémoire technique
//   document_unavailable 📘 Exigence AO — Document indisponible  (pièce supprimée)
//   unlocated            ⚠️ Source non localisée  (aucun document connu)

export type EngagementSourceKind =
  | 'ao_exact'
  | 'ao_document_only'
  | 'memoire'
  | 'unlocated'
  | 'document_unavailable'

export interface EngagementSourceInput {
  sourceType: EngagementSourceType | null
  /** tender_document_id BRUT de l'engagement (même si la pièce n'existe plus). */
  tenderDocumentId: string | null
  /** La pièce référencée existe-t-elle encore / est-elle accessible ? */
  documentExists: boolean
  /** Nom de la pièce si elle existe ; null sinon. */
  documentFilename: string | null
  page: number | null
}

// Valeurs de filtre DÉDIÉES (jamais un nom de document, qui peut être ambigu).
export const MEMOIRE_FILTER_VALUE = 'memoire'
export const UNLOCATED_FILTER_VALUE = 'unlocated'

export interface EngagementSourceDisplay {
  kind: EngagementSourceKind
  /** Pièce d'origine (id) — null pour mémoire / non localisé. */
  documentId: string | null
  /** Valeur STABLE pour le filtre : tenderDocumentId | 'memoire' | 'unlocated'. */
  filterValue: string
  /** Libellé de la source (pièce, « Mémoire technique », « Source non localisée »…). */
  documentLabel: string
  page: number | null
  /** Libellé complet prêt à afficher (avec icône). */
  label: string
}

/**
 * Classe la source d'un engagement. Logique déterministe, jamais de déduction
 * par correspondance de texte : le document vient de la donnée persistée.
 */
export function classifyEngagementSource(input: EngagementSourceInput): EngagementSourceKind {
  if (input.sourceType === 'memoire_engagement') return 'memoire'
  if (input.tenderDocumentId && input.documentExists && input.page != null) return 'ao_exact'
  if (input.tenderDocumentId && input.documentExists) return 'ao_document_only'
  if (input.tenderDocumentId && !input.documentExists) return 'document_unavailable'
  return 'unlocated'
}

export function engagementSourceDisplay(input: EngagementSourceInput): EngagementSourceDisplay {
  const kind = classifyEngagementSource(input)
  switch (kind) {
    case 'memoire':
      return {
        kind, documentId: null, filterValue: MEMOIRE_FILTER_VALUE,
        documentLabel: 'Mémoire technique', page: null,
        label: '✍️ Proposé dans le mémoire technique',
      }
    case 'ao_exact':
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: input.documentFilename!, page: input.page,
        label: `📘 Exigence AO — ${input.documentFilename} — page ${input.page}`,
      }
    case 'ao_document_only':
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: input.documentFilename!, page: null,
        label: `📘 Exigence AO — ${input.documentFilename} — page non localisée`,
      }
    case 'document_unavailable':
      // La pièce référencée n'existe plus : état DISTINCT d'une source jamais
      // localisée. On garde l'id (traçabilité) mais le filtre le range à part.
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: 'Document indisponible', page: null,
        label: '📘 Exigence AO — Document indisponible',
      }
    case 'unlocated':
    default:
      return {
        kind: 'unlocated', documentId: null, filterValue: UNLOCATED_FILTER_VALUE,
        documentLabel: 'Source non localisée', page: null,
        label: '⚠️ Source non localisée',
      }
  }
}
