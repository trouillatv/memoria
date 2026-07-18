// ── PROVENANCE D'UNE ACTION — logique PURE (Lot 4 · Slice 5) ─────────────────
// « D'où vient cette action ? » — UNIQUEMENT depuis des relations STRUCTURELLES
// (colonnes FK de site_actions), jamais depuis le titre, assigned_to ou un
// commentaire. Ce module ne fait que : (1) choisir la source primaire de façon
// déterministe, (2) porter les libellés. Le read model charge les objets et
// compose ; le composant ne fait qu'afficher.

export type ProvenanceType = 'visite' | 'reunion' | 'reserve' | 'sujet'

/** La colonne de provenance retenue comme PRIMAIRE. */
export type ProvenanceKind = 'reserve' | 'report' | 'capture' | 'subject'

export interface ActionFicheSource {
  type: ProvenanceType
  /** « Visite » · « Réunion » · « Réserve » · « Sujet ». */
  typeLabel: string
  /** Ligne principale (libellé réel de l'objet). */
  title: string
  /** Ligne secondaire (date/contexte), si disponible. */
  detail: string | null
  /** Route canonique réelle, ou null si l'objet n'est pas navigable précisément
   *  ou a disparu. */
  href: string | null
  linkLabel: string
  /** false = une relation existait mais l'objet est introuvable/supprimé →
   *  « Origine indisponible » (jamais masqué silencieusement). */
  available: boolean
}

/** Contexte SECONDAIRE : la réunion/visite où l'action est née, quand la source
 *  primaire est autre (réserve, sujet, capture). Vient d'une colonne de l'action
 *  (report_id) — pas d'un nouveau graphe. */
export interface ActionFicheContext {
  label: string
  href: string | null
}

export const PROVENANCE_TYPE_LABEL: Record<ProvenanceType, string> = {
  visite: 'Visite', reunion: 'Réunion', reserve: 'Réserve', sujet: 'Sujet',
}
export const PROVENANCE_LINK_LABEL: Record<ProvenanceType, string> = {
  visite: 'Voir la visite', reunion: 'Voir le compte rendu',
  reserve: 'Voir la réserve', sujet: 'Voir le sujet',
}

/**
 * Source PRIMAIRE, déterministe : la CAUSE DIRECTE d'abord. Une action corrective
 * (reserve_id) désigne d'abord sa réserve ; sinon la réunion/visite d'origine
 * (report_id) ; sinon la capture terrain (source_capture_id → sa visite) ; sinon
 * le sujet rattaché. Aucune colonne remplie → pas de provenance.
 */
export function primaryProvenanceKind(cols: {
  reserveId: string | null
  reportId: string | null
  sourceCaptureId: string | null
  subjectId: string | null
}): ProvenanceKind | null {
  if (cols.reserveId) return 'reserve'
  if (cols.reportId) return 'report'
  if (cols.sourceCaptureId) return 'capture'
  if (cols.subjectId) return 'subject'
  return null
}
