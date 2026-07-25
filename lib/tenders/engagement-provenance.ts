export type EngagementProvenanceState = 'exact' | 'document_only' | 'unavailable'

export type TenderDocumentReferenceCandidate = {
  id: string
  filename: string
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
