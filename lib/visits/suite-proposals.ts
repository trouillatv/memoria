// Mappage PUR entre les suites de visite (action / reserve / surveiller) et les
// propositions persistées de site_report_proposals — le MÊME stockage que les
// réunions (décision produit : un seul pipeline, un seul comportement à
// apprendre). La table n'a pas de types 'reserve'/'surveiller' : on projette sur
// les types réunion les plus proches et la VÉRITÉ du kind vit dans payload.kind.
// Aucune dépendance serveur ici : testable en CI (projet unit).

import type { DetectedSuite } from '@/services/ai/visit-suites'

export type VisitSuiteKind = 'action' | 'reserve' | 'surveiller'

/** Projection visite → type réunion (contrainte CHECK de mig 099). */
const KIND_TO_TYPE: Record<VisitSuiteKind, 'action' | 'anomaly' | 'vigilance'> = {
  action: 'action',
  reserve: 'anomaly',
  surveiller: 'vigilance',
}

export interface VisitProposalPayload {
  /** Discriminant : présent ⇔ proposition née d'une VISITE (pas d'une réunion). */
  kind: VisitSuiteKind
  capture_id: string
  /** Extrait du vocal/de la note source, pour le contexte à l'écran. */
  excerpt: string | null
}

export interface VisitProposalRow {
  type: 'action' | 'anomaly' | 'vigilance'
  /** Contenu VisitProposalPayload — typé large pour coller au contrat jsonb de
   *  bulkInsertProposals ; les lecteurs passent par proposalVisitKind & co. */
  payload: Record<string, unknown>
  short_label: string
  rationale: null
  category: null
  corps_etat: null
  assigned_to: null
  site_id: string
  ai_confidence: null
}

export function truncateExcerpt(src: string): string {
  const s = src.trim()
  return s.length > 120 ? s.slice(0, 119).trimEnd() + '…' : s
}

/** Suites détectées par l'IA → lignes à insérer dans site_report_proposals. */
export function toProposalRows(
  detected: DetectedSuite[],
  siteId: string,
  bodyById: Map<string, string>,
): VisitProposalRow[] {
  return detected.map((d) => ({
    type: KIND_TO_TYPE[d.kind],
    payload: {
      kind: d.kind,
      capture_id: d.sourceId,
      excerpt: truncateExcerpt(bodyById.get(d.sourceId) ?? '') || null,
    },
    short_label: d.text,
    rationale: null,
    category: null,
    corps_etat: null,
    assigned_to: null,
    site_id: siteId,
    ai_confidence: null,
  }))
}

/** Relit le kind visite depuis une proposition persistée ; null si la
 *  proposition ne vient pas d'une visite (payload sans kind). */
export function proposalVisitKind(payload: unknown): VisitSuiteKind | null {
  if (!payload || typeof payload !== 'object') return null
  const k = (payload as Record<string, unknown>).kind
  return k === 'action' || k === 'reserve' || k === 'surveiller' ? k : null
}

export function proposalCaptureId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const c = (payload as Record<string, unknown>).capture_id
  return typeof c === 'string' && c.length > 0 ? c : null
}

export function proposalExcerpt(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const e = (payload as Record<string, unknown>).excerpt
  return typeof e === 'string' && e.length > 0 ? e : null
}
