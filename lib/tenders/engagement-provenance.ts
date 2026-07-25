import type { EngagementProvenanceState } from '@/types/db'
import type { TenderPieceKind } from '@/types/db'
import { locateQuote } from '@/services/ai/source-validation'
import { buildTenderCorpus, tenderPieceLabel } from '@/lib/tenders/pieces'

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

export type VerifiedEngagementProvenanceInput = {
  sourceExcerpt: string
  documents: ReadonlyArray<{
    id: string
    filename: string
    kind: TenderPieceKind | null
    extractedText: string | null
  }>
}

type PreparedVerifiedDocument = {
  id: string
  filename: string
  extractedText: string
  corpus: string
  expectedLabel: string
  verifiedReference: { documentId: string } | null
}

export type VerifiedEngagementProvenanceResolver = (
  sourceExcerpt: string,
) => { tender_document_id: string | null; page_number: number | null }

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
  const hasMatchingDocument = document !== null && document.id === tenderDocumentId
  const safeTenderDocumentId = hasMatchingDocument ? tenderDocumentId : null
  const safePageNumber = hasMatchingDocument ? pageNumber : null
  const state = deriveEngagementProvenanceState({
    tenderDocumentId: safeTenderDocumentId,
    pageNumber: safePageNumber,
  })

  return {
    engagementId,
    tenderId,
    sourceRef,
    documentId: safeTenderDocumentId,
    filename: hasMatchingDocument ? document.filename : null,
    pageNumber: safePageNumber,
    state,
  }
}

function normalizeLocatedQuote(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase()
}

function pageMarkerBeforeQuote(
  text: string,
  normalizedNeedle: string,
): string | null {
  const normalizedText = normalizeLocatedQuote(text)
  const quoteIndex = normalizedText.indexOf(normalizedNeedle)
  if (quoteIndex < 0) return null

  const markerStart = normalizedText.lastIndexOf('[[page ', quoteIndex)
  if (markerStart < 0) return null

  const markerEnd = normalizedText.indexOf(']]', markerStart)
  if (markerEnd < 0 || markerEnd > quoteIndex) return null
  return normalizedText.slice(markerStart + '[[page '.length, markerEnd).trim()
}

export function createVerifiedEngagementProvenanceResolver({
  documents,
}: Omit<VerifiedEngagementProvenanceInput, 'sourceExcerpt'>): VerifiedEngagementProvenanceResolver {
  const preparedDocuments: PreparedVerifiedDocument[] = documents.flatMap((document) => {
    if (!document.extractedText?.trim()) return []

    return [{
      id: document.id,
      filename: document.filename,
      extractedText: document.extractedText,
      corpus: buildTenderCorpus(
        [{ kind: document.kind, filename: document.filename, text: document.extractedText }],
        Number.MAX_SAFE_INTEGER,
      ),
      expectedLabel: `${tenderPieceLabel(document.kind)} — ${document.filename}`,
      verifiedReference: resolveTenderDocumentReference(document.filename, documents),
    }]
  })

  return (sourceExcerpt) => {
    const normalizedNeedle = normalizeLocatedQuote(sourceExcerpt)
    if (normalizedNeedle === '') {
      return { tender_document_id: null, page_number: null }
    }

    const matches = preparedDocuments.flatMap((document) => {
      const located = locateQuote(document.corpus, normalizedNeedle)
      if (located.document !== document.expectedLabel) return []
      if (!document.verifiedReference || document.verifiedReference.documentId !== document.id) return []

      const markerValue = pageMarkerBeforeQuote(document.extractedText, normalizedNeedle)
      const pageNumber = located.page ?? (markerValue === null ? null : Number(markerValue))
      if (
        pageNumber !== null &&
        (!Number.isFinite(pageNumber) || !Number.isInteger(pageNumber) || pageNumber <= 0)
      ) return []

      return [{ tender_document_id: document.id, page_number: pageNumber }]
    })

    return matches.length === 1
      ? matches[0]!
      : { tender_document_id: null, page_number: null }
  }
}

export function resolveVerifiedEngagementProvenance({
  sourceExcerpt,
  documents,
}: VerifiedEngagementProvenanceInput): {
  tender_document_id: string | null
  page_number: number | null
} {
  return createVerifiedEngagementProvenanceResolver({ documents })(sourceExcerpt)
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
