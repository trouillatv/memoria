import { describe, expect, it } from 'vitest'

import {
  deriveEngagementProvenanceState,
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
