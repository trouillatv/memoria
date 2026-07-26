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
  /** Icône de la source (📘 AO / ✍️ mémoire / ⚠️ non localisé). */
  icon: string
  /** Libellé complet prêt à afficher (icône + source). */
  label: string
}

const ICON: Record<EngagementSourceKind, string> = {
  ao_exact: '📘',
  ao_document_only: '📘',
  document_unavailable: '📘',
  memoire: '✍️',
  unlocated: '⚠️',
}

export const ALL_FILTER_VALUE = 'all'

export interface DocumentFilterOption {
  value: string
  label: string
  count: number
}

function filterRank(kind: EngagementSourceKind): number {
  if (kind === 'memoire') return 2
  if (kind === 'document_unavailable') return 3
  if (kind === 'unlocated') return 4
  return 1 // pièces d'AO
}

/**
 * Options du filtre document, avec compteurs, à partir des sources affichées.
 * « Tous » d'abord ; les pièces d'AO ; puis mémoire, document indisponible et
 * enfin non localisé. Une entrée n'existe que si elle a au moins un engagement —
 * en particulier « Source non localisée » ne s'affiche JAMAIS à zéro (le filtre
 * ne masque pas le problème : il ne le montre que s'il existe réellement).
 */
export function buildDocumentFilterOptions(
  displays: ReadonlyArray<EngagementSourceDisplay>,
): DocumentFilterOption[] {
  const groups = new Map<string, { icon: string; documentLabel: string; count: number; kind: EngagementSourceKind }>()
  for (const d of displays) {
    const g = groups.get(d.filterValue)
    if (g) g.count += 1
    else groups.set(d.filterValue, { icon: d.icon, documentLabel: d.documentLabel, count: 1, kind: d.kind })
  }
  const options: DocumentFilterOption[] = [
    { value: ALL_FILTER_VALUE, label: `Tous les documents (${displays.length})`, count: displays.length },
  ]
  const ordered = [...groups.entries()].sort(([, a], [, b]) => filterRank(a.kind) - filterRank(b.kind))
  for (const [value, g] of ordered) {
    options.push({
      value,
      label: `${g.icon} ${g.documentLabel} — ${g.count} engagement${g.count > 1 ? 's' : ''}`,
      count: g.count,
    })
  }
  return options
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
  const icon = ICON[kind]
  switch (kind) {
    case 'memoire':
      return {
        kind, documentId: null, filterValue: MEMOIRE_FILTER_VALUE,
        documentLabel: 'Mémoire technique', page: null,
        icon, label: '✍️ Proposé dans le mémoire technique',
      }
    case 'ao_exact':
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: input.documentFilename!, page: input.page,
        icon, label: `📘 Exigence AO — ${input.documentFilename} — page ${input.page}`,
      }
    case 'ao_document_only':
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: input.documentFilename!, page: null,
        icon, label: `📘 Exigence AO — ${input.documentFilename} — page non localisée`,
      }
    case 'document_unavailable':
      // La pièce référencée n'existe plus : état DISTINCT d'une source jamais
      // localisée. On garde l'id (traçabilité) mais le filtre le range à part.
      return {
        kind, documentId: input.tenderDocumentId, filterValue: input.tenderDocumentId!,
        documentLabel: 'Document indisponible', page: null,
        icon, label: '📘 Exigence AO — Document indisponible',
      }
    case 'unlocated':
    default:
      return {
        kind: 'unlocated', documentId: null, filterValue: UNLOCATED_FILTER_VALUE,
        documentLabel: 'Source non localisée', page: null,
        icon: ICON.unlocated, label: '⚠️ Source non localisée',
      }
  }
}
