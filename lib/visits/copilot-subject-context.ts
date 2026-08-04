// Transformation d'un CanonicalSubjectLife en contexte LLM compact.
//
// Règles :
//   - Seuls les liens CONFIRMED sont inclus (suggested exclus en 3A)
//   - Les gaps (PV sans mention) sont exclus de la timeline
//   - Les descriptions sont tronquées à 300 chars
//   - Max 20 occurrences retournées (toujours les plus récentes)

import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'

export interface SubjectOccurrenceContext {
  date: string
  /** 'historical_pdf' pour les PV importés, 'field_visit' pour les visites terrain. */
  sourceKind: 'historical_pdf' | 'field_visit'
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

export interface SubjectDetailContext {
  /** UUID du canonical_subject — utilisé comme citedId */
  id: string
  label: string
  pvCount: number
  firstSeenAt: string | null
  lastSeenAt: string | null
  currentStatus: string | null
  /** Occurrences non-gap, les plus récentes en premier (max 20) */
  occurrences: SubjectOccurrenceContext[]
  /** Actions, décisions, réserves, échéances liées */
  materializedEvents: SubjectMaterializedContext[]
  /** Uniquement les liens confirmés */
  confirmedLinks: SubjectConfirmedLinkContext[]
}

const MAX_OCCURRENCES = 20
const MAX_DESCRIPTION_LENGTH = 300

const VISIT_STATUS_LABELS: Record<string, string> = {
  field_checked:  'vérifié sur le terrain',
  still_open:     'toujours ouvert',
  not_applicable: 'sans objet lors de la visite',
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
): SubjectDetailContext {
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
      documentStatus: o.documentStatus ?? visitStatusLabel(o.visitStatus),
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

  return {
    id: life.canonicalSubjectId,
    label: life.label,
    pvCount: life.pvCount,
    firstSeenAt: life.firstSeenAt,
    lastSeenAt: life.lastSeenAt,
    currentStatus: life.currentStatus,
    occurrences,
    materializedEvents,
    confirmedLinks,
  }
}
