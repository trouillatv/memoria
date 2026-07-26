import type { SourceRef, PromiseSubjectRef } from './operational-contract'
import type { PromiseCandidate } from './promise-detector'

export type StructuredPromiseRecord = {
  /** Identifiant persistant de la ligne source, jamais une position dans un texte. */
  id: string
  organizationId: string
  siteId: string
  kind: string
  title: string
  body: string | null
  source: SourceRef
  /** Objet persistant résoluble : quelle TABLE porte cette promesse (T2). */
  subject: PromiseSubjectRef
  occurredAt: string | null
  /** ISO avec fuseau déjà résolu par le read model. */
  dueAt: string | null
  confirmedAt: string | null
  confirmationSourceIds: string[]
  relatedProofSourceIds: string[]
  importance: PromiseCandidate['importance']
  blocking: boolean
}

function hasExplicitTimezone(value: string): boolean {
  return /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

/**
 * Transforme seulement des lignes déjà qualifiées et datées. Ce builder ne
 * tente pas de reconnaître une promesse dans `title` ou `body`.
 */
export function buildPromiseCandidates(records: StructuredPromiseRecord[]): PromiseCandidate[] {
  const seen = new Set<string>()
  const candidates: PromiseCandidate[] = []
  for (const record of records) {
    if (record.kind !== 'promise' || seen.has(record.id) || !record.title.trim()) continue
    if (record.dueAt !== null && !hasExplicitTimezone(record.dueAt)) continue
    seen.add(record.id)
    candidates.push({
      id: record.id,
      organizationId: record.organizationId,
      siteId: record.siteId,
      text: record.title.trim(),
      source: record.source,
      subject: record.subject,
      occurredAt: record.occurredAt,
      dueAt: record.dueAt,
      confirmedAt: record.confirmedAt,
      confirmationSourceIds: record.confirmationSourceIds,
      relatedProofSourceIds: record.relatedProofSourceIds,
      importance: record.importance,
      blocking: record.blocking,
    })
  }
  return candidates
}
