// Transformation d'un CanonicalSubjectLife en contexte LLM compact.
//
// Règles :
//   - Seuls les liens CONFIRMED sont inclus (suggested exclus en 3A)
//   - Les gaps (PV sans mention) sont exclus de la timeline
//   - Les descriptions sont tronquées à 300 chars
//   - Max 20 occurrences retournées (toujours les plus récentes)

import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

export interface SubjectOccurrenceContext {
  date: string
  /** 'historical_pdf' pour les PV importés, 'field_visit' pour les visites terrain, 'meeting' pour les réunions. */
  sourceKind: 'historical_pdf' | 'field_visit' | 'meeting'
  transition: string | null
  description: string | null
  /** Statut normalisé. Pour les PDF: documentStatus. Pour le terrain: visitStatus. */
  documentStatus: string | null
}

export interface SubjectMaterializedContext {
  type: string    // site_action | site_decision | site_reserve | site_deadline
  title: string
  status: string | null
  date: string | null
}

export interface SubjectConfirmedLinkContext {
  id: string
  label: string   // label du sujet lié (opposé)
  direction: 'outgoing' | 'incoming'
  linkType: string
}

export interface SubjectTerrainObjectContext {
  type: 'action' | 'deadline'
  id: string
  title: string
  status: string | null
  createdAt: string
}

/**
 * P1-4C2E2 — vérité C2A d'UN objet métier durable (CBO action) du sujet. `computedCurrentState` est
 * l'état courant AUTORITATIF calculé par MemorIA ; le LLM l'EXPLIQUE, il ne le recalcule ni ne le
 * remplace jamais depuis un statut brut. Granularité distincte de l'état SUJET (etatCourant / P0-2).
 */
export interface SubjectBusinessObjectContext {
  label: string
  computedCurrentState: CboComputedCurrentState
  stateBasis: string[]
  conflicts: string[]
  documentaryDivergences: string[]
}

export interface SubjectDetailContext {
  /** UUID du canonical_subject — utilisé comme citedId */
  id: string
  label: string
  pvCount: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  /**
   * P0-2B — SEULE vérité d'état courant autorisée pour le LLM (open|resolved|reopened|unknown).
   * Déterministe (deriveCanonicalCurrentState). Le LLM l'EXPLIQUE, il ne la recalcule ni ne la
   * contredit jamais depuis `documentStatus`/`occurrences`.
   */
  etatCourant: CanonicalDisplayState
  /** P0-2B — open OU objet actif rattaché. Rattaché à etatCourant, ne pas redéduire. */
  provenOpen: boolean
  /**
   * Statut brut historique (document_status/visit_status de la dernière occurrence).
   * NE PAS l'utiliser comme état courant — uniquement pour décrire une preuve/occurrence.
   */
  currentStatus: string | null
  /** Occurrences non-gap, les plus récentes en premier (max 20) */
  occurrences: SubjectOccurrenceContext[]
  /** Actions, décisions, réserves, échéances liées */
  materializedEvents: SubjectMaterializedContext[]
  /** Uniquement les liens confirmés */
  confirmedLinks: SubjectConfirmedLinkContext[]
  /** Date de la dernière évolution métier prouvée (transition open↔resolved ou objet terrain créé après firstSeen). */
  lastMeaningfulChangeAt: string | null
  /** Vrai si le sujet n'a pas évolué depuis ≥ 30 jours avec ≥ 2 répétitions consécutives sans changement. */
  isStagnant: boolean
  /** Nombre de jours entre lastMeaningfulChangeAt et lastSeenAt. Null si non calculable. */
  stagnationDays: number | null
  /** Actions et échéances terrain liées à ce sujet via canonical_subject_id. */
  terrainObjects: SubjectTerrainObjectContext[]
  /**
   * P1-4C2E2 — objets métier durables (CBO action) du sujet avec leur état courant AUTORITATIF C2A.
   * Le LLM utilise `computedCurrentState` tel quel ; les preuves/historique l'EXPLIQUENT, ne le
   * recalculent jamais. Distinct de `etatCourant` (état du SUJET). Vide si aucun CBO exploitable.
   */
  businessObjects: SubjectBusinessObjectContext[]
}

const MAX_OCCURRENCES = 20
const MAX_DESCRIPTION_LENGTH = 300

const VISIT_STATUS_LABELS: Record<string, string> = {
  field_checked:  'vérifié sur le terrain',
  still_open:     'toujours ouvert',
  not_applicable: 'sans objet lors de la visite',
  mentioned:      'évoqué en réunion',
}

function visitStatusLabel(status: string | null): string | null {
  if (!status) return null
  return VISIT_STATUS_LABELS[status] ?? status
}

function truncate(text: string | null, maxLength: number): string | null {
  if (!text) return null
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}

export function buildSubjectDetailForCopilot(
  life: CanonicalSubjectLife,
  cboEntries: CboReducedEntry[] = [],
): SubjectDetailContext {
  // P1-4C2E2 — projection d'affichage des CBO : uniquement l'état AUTORITATIF C2A + sa provenance.
  // Aucune donnée brute d'état ici (pas de site_actions.status / signal / document_status).
  const businessObjects: SubjectBusinessObjectContext[] = cboEntries.map((e) => ({
    label: e.label,
    computedCurrentState: e.reduced.computedCurrentState,
    stateBasis: e.reduced.stateBasis,
    conflicts: e.reduced.conflicts,
    documentaryDivergences: e.reduced.documentaryDivergences,
  }))
  // Occurrences non-gap, triées par date décroissante, limitées à MAX_OCCURRENCES
  const occurrences: SubjectOccurrenceContext[] = life.occurrences
    .filter((o) => !o.isGap)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .slice(0, MAX_OCCURRENCES)
    .map((o) => ({
      date: o.effectiveDate,
      sourceKind: o.sourceKind,
      transition: o.transition,
      description: truncate(o.description, MAX_DESCRIPTION_LENGTH),
      // PDF : documentStatus ; terrain : visitStatus (field_checked/still_open/not_applicable)
      documentStatus: o.sourceKind === 'historical_pdf'
        ? o.documentStatus
        : visitStatusLabel(o.visitStatus),
    }))

  // Événements matérialisés
  const materializedEvents: SubjectMaterializedContext[] = life.materializedEvents.map((e) => ({
    type: e.entityType,
    title: e.title,
    status: e.status,
    date: e.date,
  }))

  // Liens confirmés uniquement — les suggested ne sont pas des vérités
  const confirmedLinks: SubjectConfirmedLinkContext[] = life.links
    .filter((l) => l.status === 'confirmed')
    .map((l) => ({
      id: l.fromCanonicalSubjectId === life.canonicalSubjectId
        ? (l.toCanonicalSubjectId ?? '')
        : (l.fromCanonicalSubjectId ?? ''),
      label: l.direction === 'outgoing' ? l.toLabel : l.fromLabel,
      direction: l.direction,
      linkType: l.linkType,
    }))

  // Objets terrain liés (actions/échéances) — projection métier uniquement
  const terrainObjects: SubjectTerrainObjectContext[] = life.terrainObjects.map((t) => ({
    type: t.entityType === 'site_action' ? 'action' as const : 'deadline' as const,
    id: t.entityId,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt,
  }))

  return {
    id: life.canonicalSubjectId,
    label: life.label,
    pvCount: life.pvCount,
    firstSeenAt: life.firstSeenAt,
    lastSeenAt: life.lastSeenAt,
    etatCourant: life.displayState,
    provenOpen: life.provenOpen,
    currentStatus: life.currentStatus,
    occurrences,
    materializedEvents,
    confirmedLinks,
    lastMeaningfulChangeAt: life.lastMeaningfulChangeAt,
    isStagnant: life.isStagnant,
    stagnationDays: life.stagnationDays,
    terrainObjects,
    businessObjects,
  }
}
