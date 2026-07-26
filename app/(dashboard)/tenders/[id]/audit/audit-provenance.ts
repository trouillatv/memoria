// Contrat consommateur de l'audit documentaire multipièces (tranche UI 2026-07-25).
// L'UI ne REND que la provenance structurée persistée (read model) — elle ne
// reconstruit JAMAIS l'identité d'une source depuis source_ref.page, la
// similarité de nom de fichier, l'ordre des pièces ou toute autre inférence.
//
// Trois états, trois comportements :
//   exact          → sélectionner la pièce ET ouvrir la page vérifiée
//   document_only  → sélectionner la pièce SANS forcer de page
//   unavailable    → ne rien changer + « Source non localisée »

import type { EngagementProvenanceState, EngagementSourceType } from '@/types/db'
import { provenanceSourceLabel as sourceLabel } from '@/lib/tenders/provenance-label'

/** Une pièce du dossier telle que l'audit la consomme (URL signée côté serveur). */
export interface AuditDocumentItem {
  id: string
  filename: string
  /** URL signée de consultation — null si la pièce n'a pas de fichier lisible. */
  url: string | null
}

/** La provenance structurée d'un engagement, telle que persistée. */
export interface AuditProvenance {
  state: EngagementProvenanceState
  documentId: string | null
  pageNumber: number | null
  filename: string | null
  /** Exigence d'AO vs proposition du mémoire technique. Absent = historique. */
  sourceType?: EngagementSourceType | null
}

/** Ce que le lecteur PDF affiche : quelle pièce, et à quelle page (null = entière). */
export interface AuditSelection {
  documentId: string | null
  pageNumber: number | null
}

/**
 * Sélection d'ouverture : la première pièce comme simple CIBLE DE CONSULTATION.
 * Ce n'est jamais une provenance démontrée — aucune page, aucune prétention de
 * source. Dossier vide → aucune sélection (état vide).
 */
export function initialAuditSelection(documents: ReadonlyArray<AuditDocumentItem>): AuditSelection {
  return { documentId: documents[0]?.id ?? null, pageNumber: null }
}

/**
 * Navigation depuis un état de provenance — sans rien inventer.
 * `unavailable` laisse le lecteur EXACTEMENT où il est : jamais de repli par
 * récence, ordre ou nom de fichier.
 */
export function applyProvenanceSelection(
  current: AuditSelection,
  provenance: AuditProvenance,
): AuditSelection {
  if (provenance.state === 'exact') {
    return { documentId: provenance.documentId, pageNumber: provenance.pageNumber }
  }
  if (provenance.state === 'document_only') {
    return { documentId: provenance.documentId, pageNumber: null }
  }
  return current
}

/** Libellé humain de la source — le vrai contrat : Document → Page → État.
 *  Format partagé avec la curation (source unique dans provenance-label). */
export function provenanceSourceLabel(provenance: AuditProvenance): string {
  return sourceLabel(provenance)
}

/** Forme courte pour la liste des engagements (badge de ligne). */
export function provenancePageBadge(provenance: AuditProvenance): string {
  if (provenance.sourceType === 'memoire_engagement') return '✍️ mémoire'
  if (provenance.state === 'exact') return `p.${provenance.pageNumber}`
  if (provenance.state === 'document_only') return 'page non localisée'
  return 'source non localisée'
}
