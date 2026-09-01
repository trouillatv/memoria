// ── PROVENANCE D'UNE ACTION — logique PURE (Lot 4 · Slice 5) ─────────────────
// « D'où vient cette action ? » — UNIQUEMENT depuis des relations STRUCTURELLES
// (colonnes FK de site_actions), jamais depuis le titre, assigned_to ou un
// commentaire. Ce module ne fait que : (1) choisir la source primaire de façon
// déterministe, (2) porter les libellés. Le read model charge les objets et
// compose ; le composant ne fait qu'afficher.

import { isImportedDocumentOrigin, isTerrainVisitOrigin } from '@/lib/field/visit-origins'

export type ProvenanceType = 'visite' | 'reunion' | 'pv' | 'reserve' | 'sujet'

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
  /** Route canonique réelle (DESKTOP), ou null si l'objet n'est pas navigable
   *  précisément ou a disparu. */
  href: string | null
  /** Route MOBILE `/m` réelle, ou null si aucune surface `/m` fiable (on préfère
   *  un lien absent à un renvoi desktop). Calculé par `mobileSourceHref`. */
  mobileHref: string | null
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
  visite: 'Visite', reunion: 'Réunion', pv: 'PV · document historique',
  reserve: 'Réserve', sujet: 'Sujet',
}
export const PROVENANCE_LINK_LABEL: Record<ProvenanceType, string> = {
  visite: 'Voir la visite', reunion: 'Voir le compte rendu', pv: 'Voir le document',
  reserve: 'Voir la réserve', sujet: 'Voir le sujet',
}

/**
 * Type de provenance d'un `site_reports`, depuis `origin` SEUL (structurel) :
 * `import` = PV/CR historique importé (source documentaire) → `pv` ; origine
 * terrain (planned/spontaneous/qr/gps) → `visite` ; `null` = réunion. Corrige
 * la confusion historique « toute origine non-nulle = visite » qui étiquetait un
 * PV importé comme « Visite » (doctrine p05-verite-imports-vs-visites).
 */
export function reportProvenanceType(origin: string | null): ProvenanceType {
  if (isImportedDocumentOrigin(origin)) return 'pv'
  if (isTerrainVisitOrigin(origin)) return 'visite'
  return 'reunion'
}

/**
 * Route MOBILE réelle (/m) d'une source, ou `null` si aucune surface `/m` fiable
 * n'existe. Doctrine Vincent (2026-09-01) : sur mobile, mieux vaut perdre un clic
 * qu'envoyer l'utilisateur vers une surface desktop. Jamais de `/sites/...` ici.
 */
export function mobileSourceHref(
  type: ProvenanceType,
  ids: { siteId: string; reportId: string | null },
): string | null {
  switch (type) {
    // « Voir la visite/réunion » → la PAGE PRINCIPALE de la visite (l'objet), pas
    // son sous-espace d'édition (/cr) : depuis là on va au CR, aux photos, etc.
    case 'reunion': return ids.reportId ? `/m/reunion/${ids.reportId}` : null
    // Un PV importé matérialise un `site_report` (origin='import') servi par la MÊME
    // page visite mobile que le terrain (`/m/visite/[reportId]`, getVisit exige
    // origin non-null → import passe). Renvoyer null ici était une anomalie UX : la
    // cible existe et est démontrée par `report_id`. Point 7A (2026-09-01).
    case 'visite':
    case 'pv': return ids.reportId ? `/m/visite/${ids.reportId}` : null
    case 'reserve': return `/m/site/${ids.siteId}/reserves`
    case 'sujet': return null // subjects.id ≠ canonicalSubjectId : pas de route /m
  }
}

/**
 * Route DESKTOP canonique d'une source — UNE seule règle de destination, pour
 * supprimer les chemins concurrents (`/reunion` ici, `/visites` ailleurs pour le
 * même objet). Une visite terrain ET un PV importé sont servis par LA page visite
 * canonique (`/sites/[siteId]/visites/[reportId]`, doctrine « Voir la visite
 * source ») ; seule une réunion (origin=null) a sa fiche dédiée. `null` si la
 * source n'est pas navigable précisément (le sujet porte un subjectId, pas un
 * reportId : l'appelant compose sa propre route).
 */
export function desktopSourceHref(
  type: ProvenanceType,
  ids: { siteId: string; reportId: string | null },
): string | null {
  switch (type) {
    case 'reunion': return ids.reportId ? `/sites/${ids.siteId}/reunion/${ids.reportId}` : null
    case 'visite':
    case 'pv': return ids.reportId ? `/sites/${ids.siteId}/visites/${ids.reportId}` : null
    case 'reserve': return `/sites/${ids.siteId}/reserves`
    case 'sujet': return null
  }
}

/**
 * Ligne COMPACTE de provenance pour une carte — déterministe (type + date), le
 * titre complet restant réservé à la fiche. `manual` = création MemorIA sans
 * source documentaire (« Créée manuellement »). Une action sans provenance
 * démontrable N'A PAS de ligne : l'appelant ne construit rien dans ce cas.
 */
export function cardProvenanceLine(
  input:
    | { kind: 'source'; type: ProvenanceType; dateLabel: string | null; name?: string | null }
    | { kind: 'manual' },
): string {
  if (input.kind === 'manual') return 'Créée manuellement'
  const { type, dateLabel, name } = input
  const d = dateLabel ? ` du ${dateLabel}` : ''
  switch (type) {
    case 'pv': return `Issue du PV${d}`
    case 'visite': return `Issue de la visite${d}`
    case 'reunion': return `Issue du CR de réunion${d}`
    case 'reserve': return `Issue de la réserve${d}`
    case 'sujet': return name ? `Issue du sujet : ${name}` : 'Issue d’un sujet'
  }
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
