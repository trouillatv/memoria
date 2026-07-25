import { describe, expect, it } from 'vitest'
import type { EngagementProvenanceState } from '@/types/db'

import {
  deriveEngagementProvenanceState,
  deriveEngagementProvenanceReadRow,
  resolveTenderDocumentReference,
} from '@/lib/tenders/engagement-provenance'

type TenderDocument = { id: string; filename: string }

const doc = (id: string, filename: string): TenderDocument => ({ id, filename })

describe('deriveEngagementProvenanceState', () => {
  it('returns exact when a document and page are known', () => {
    expect(deriveEngagementProvenanceState({ tenderDocumentId: 'doc-1', pageNumber: 12 })).toBe('exact')
  })

  it('returns document_only when only the document is known', () => {
    expect(deriveEngagementProvenanceState({ tenderDocumentId: 'doc-1', pageNumber: null })).toBe('document_only')
  })

  it('returns unavailable when neither provenance field is known', () => {
    expect(deriveEngagementProvenanceState({ tenderDocumentId: null, pageNumber: null })).toBe('unavailable')
  })

  it('rejects the impossible page-without-document state', () => {
    expect(() => deriveEngagementProvenanceState({ tenderDocumentId: null, pageNumber: 12 })).toThrow()
  })
})

describe('deriveEngagementProvenanceReadRow', () => {
  const baseRow = {
    engagementId: 'engagement-1',
    tenderId: 'tender-1',
    sourceRef: null,
  }

  it('returns exact with the structured document, filename, page, and state', () => {
    const state: EngagementProvenanceState = 'exact'
    const sourceRef = { section: '4.2' }
    expect(
      deriveEngagementProvenanceReadRow({
        ...baseRow,
        sourceRef,
        tenderDocumentId: 'doc-1',
        pageNumber: 12,
        document: { id: 'doc-1', filename: 'CCAP.pdf' },
      }),
    ).toMatchObject({
      engagementId: 'engagement-1',
      tenderId: 'tender-1',
      sourceRef,
      documentId: 'doc-1',
      filename: 'CCAP.pdf',
      pageNumber: 12,
      state,
    })
  })

  it('returns document_only when the structured page is null', () => {
    const sourceRef = { section: '5.1' }
    expect(
      deriveEngagementProvenanceReadRow({
        ...baseRow,
        sourceRef,
        tenderDocumentId: 'doc-1',
        pageNumber: null,
        document: { id: 'doc-1', filename: 'CCAP.pdf' },
      }),
    ).toMatchObject({
      engagementId: 'engagement-1',
      tenderId: 'tender-1',
      sourceRef,
      documentId: 'doc-1',
      filename: 'CCAP.pdf',
      pageNumber: null,
      state: 'document_only',
    })
  })

  it('returns unavailable when a structured document has no joined document', () => {
    expect(
      deriveEngagementProvenanceReadRow({
        ...baseRow,
        tenderDocumentId: 'doc-1',
        pageNumber: 12,
        document: null,
      }),
    ).toMatchObject({
      engagementId: 'engagement-1',
      tenderId: 'tender-1',
      sourceRef: null,
      documentId: null,
      filename: null,
      pageNumber: null,
      state: 'unavailable',
    })
  })

  it('returns unavailable when the joined document id mismatches', () => {
    expect(
      deriveEngagementProvenanceReadRow({
        ...baseRow,
        tenderDocumentId: 'doc-1',
        pageNumber: null,
        document: { id: 'doc-2', filename: 'other.pdf' },
      }),
    ).toMatchObject({
      engagementId: 'engagement-1',
      tenderId: 'tender-1',
      sourceRef: null,
      documentId: null,
      filename: null,
      pageNumber: null,
      state: 'unavailable',
    })
  })

  it('returns unavailable when only legacy source_ref.page is present', () => {
    expect(
      deriveEngagementProvenanceReadRow({
        ...baseRow,
        sourceRef: { page: 12 },
        tenderDocumentId: null,
        pageNumber: null,
        document: null,
      }),
    ).toMatchObject({
      engagementId: 'engagement-1',
      tenderId: 'tender-1',
      sourceRef: { page: 12 },
      documentId: null,
      filename: null,
      pageNumber: null,
      state: 'unavailable',
    })
  })
})

describe('resolveTenderDocumentReference', () => {
  it('resolves an exact filename match', () => {
    expect(resolveTenderDocumentReference('CCAP.pdf', [doc('d1', 'CCAP.pdf')])).toEqual({ documentId: 'd1' })
  })

  it('matches case and whitespace differences after canonical normalization', () => {
    expect(resolveTenderDocumentReference('  ccap.pdf  ', [doc('d1', 'CCAP.pdf')])).toEqual({ documentId: 'd1' })
    expect(resolveTenderDocumentReference('C\u0043AP.pdf', [doc('d1', 'CCAP.pdf')])).toEqual({ documentId: 'd1' })
  })

  it('returns null when no document matches', () => {
    expect(resolveTenderDocumentReference('missing.pdf', [doc('d1', 'CCAP.pdf')])).toBeNull()
  })

  it('returns null when canonical normalization produces multiple candidates', () => {
    expect(resolveTenderDocumentReference('CCAP.pdf', [
      doc('d1', 'CCAP.pdf'),
      doc('d2', 'CCAP.PDF'),
    ])).toBeNull()
  })

  it('normalizes Unicode filenames without applying approximate matching', () => {
    expect(resolveTenderDocumentReference('cafe\u0301.pdf', [doc('d1', 'CAFÉ.pdf')])).toEqual({ documentId: 'd1' })
    expect(resolveTenderDocumentReference('CCAP-final.pdf', [doc('d1', 'CCAP.pdf')])).toBeNull()
  })
})
