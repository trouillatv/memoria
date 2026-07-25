import type { EngagementProvenanceState } from '@/types/db'

export type { EngagementProvenanceState } from '@/types/db'

export type TenderDocumentReferenceCandidate = {
  id: string
  filename: string
}

export type EngagementProvenanceReadInput = {
  engagementId: string
  tenderId: string
  sourceRef: Record<string, unknown> | null
  tenderDocumentId: string | null
  pageNumber: number | null
  document: { id: string; filename: string } | null
}

export type EngagementProvenanceReadRow = {
  engagementId: string
  tenderId: string
  sourceRef: Record<string, unknown> | null
  documentId: string | null
  filename: string | null
  pageNumber: number | null
  state: EngagementProvenanceState
}

type ProvenanceFields = {
  tenderDocumentId: string | null
  pageNumber: number | null
}

/**
 * Normalizes only the filename dimensions that are safe for exact matching:
 * Unicode compatibility form, case, and runs of whitespace.
 */
export function canonicalizeTenderFilename(filename: string): string {
  return filename.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ')
}

export function deriveEngagementProvenanceState({
  tenderDocumentId,
  pageNumber,
}: ProvenanceFields): EngagementProvenanceState {
  if (tenderDocumentId === null && pageNumber !== null) {
    throw new Error('An engagement provenance page requires a tender document')
  }

  if (tenderDocumentId === null) return 'unavailable'
  if (pageNumber === null) return 'document_only'
  return 'exact'
}

export function deriveEngagementProvenanceReadRow({
  engagementId,
  tenderId,
  sourceRef,
  tenderDocumentId,
  pageNumber,
  document,
}: EngagementProvenanceReadInput): EngagementProvenanceReadRow {
  const state = deriveEngagementProvenanceState({
    tenderDocumentId,
    pageNumber,
  })
  const joinedDocument = document?.id === tenderDocumentId ? document : null

  return {
    engagementId,
    tenderId,
    sourceRef,
    documentId: tenderDocumentId,
    filename: joinedDocument?.filename ?? null,
    pageNumber,
    state,
  }
}

export function resolveTenderDocumentReference(
  locatedFilename: string,
  documents: ReadonlyArray<TenderDocumentReferenceCandidate>,
): { documentId: string } | null {
  const canonicalReference = canonicalizeTenderFilename(locatedFilename)
  if (canonicalReference === '') return null

  const matches = documents.filter(
    (document) => canonicalizeTenderFilename(document.filename) === canonicalReference,
  )

  return matches.length === 1 ? { documentId: matches[0]!.id } : null
}
