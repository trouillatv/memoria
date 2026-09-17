// P0 — DELETED HISTORICAL SOURCE (2026-09-17).
//
// Doctrine unique testée ici : une source active = le document source existe ET
// documents.deleted_at IS NULL. Ces primitives sont le SEUL point où cette règle
// est codée — tout consommateur (getMaterializedRunIdsForSite, reconciliation-sweep,
// runHistoricalImportPostProcessing) délègue ici plutôt que de réimplémenter le
// prédicat. Piège couvert explicitement : site_reports.deleted_at n'est PAS la
// bonne colonne (jamais renseignée quand le document source est supprimé) — ces
// tests portent uniquement sur documents.deleted_at.

import { describe, it, expect } from 'vitest'
import {
  getDeletedDocumentIds,
  isSourceDocumentDeleted,
  isExtractionRunSourceDeleted,
  filterEligibleBySourceDocument,
} from '@/lib/documents/historical-source-eligibility'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

function makeFakeClient(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const run = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
    const api = {
      select: () => api,
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      in: (f: string, values: unknown[]) => (filters.push((r) => values.includes(r[f])), api),
      not: (f: string, op: string, v: null) => {
        if (op === 'is' && v === null) filters.push((r) => (r[f] ?? null) !== null)
        return api
      },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) } as never
}

describe('getDeletedDocumentIds', () => {
  it('retourne un ensemble vide sans requête pour une liste vide', async () => {
    const client = makeFakeClient({ documents: [] })
    expect(await getDeletedDocumentIds(client, [])).toEqual(new Set())
    expect(await getDeletedDocumentIds(client, [null, undefined])).toEqual(new Set())
  })

  it('ne retient que les documents réellement supprimés parmi ceux fournis', async () => {
    const client = makeFakeClient({
      documents: [
        { id: 'doc-active', deleted_at: null },
        { id: 'doc-deleted', deleted_at: '2026-09-16T00:00:00Z' },
        { id: 'doc-not-in-list', deleted_at: '2026-09-16T00:00:00Z' },
      ],
    })
    const result = await getDeletedDocumentIds(client, ['doc-active', 'doc-deleted'])
    expect(result).toEqual(new Set(['doc-deleted']))
  })
})

describe('isSourceDocumentDeleted', () => {
  it('un document actif est éligible', async () => {
    const client = makeFakeClient({ documents: [{ id: 'doc-active', deleted_at: null }] })
    expect(await isSourceDocumentDeleted(client, 'doc-active')).toBe(false)
  })

  it('un document soft-deleted est inéligible', async () => {
    const client = makeFakeClient({ documents: [{ id: 'doc-deleted', deleted_at: '2026-09-16T00:00:00Z' }] })
    expect(await isSourceDocumentDeleted(client, 'doc-deleted')).toBe(true)
  })

  it('un id absent (visite terrain, pas d\'import) est toujours éligible', async () => {
    const client = makeFakeClient({ documents: [] })
    expect(await isSourceDocumentDeleted(client, null)).toBe(false)
    expect(await isSourceDocumentDeleted(client, undefined)).toBe(false)
  })
})

describe('isExtractionRunSourceDeleted', () => {
  it('résout document_extraction_run.document_id puis délègue à isSourceDocumentDeleted', async () => {
    const client = makeFakeClient({
      document_extraction_run: [{ id: 'run-ghost', document_id: 'doc-deleted' }],
      documents: [{ id: 'doc-deleted', deleted_at: '2026-09-16T00:00:00Z' }],
    })
    expect(await isExtractionRunSourceDeleted(client, 'run-ghost')).toBe(true)
  })

  it('un run sans document_id (visite terrain) est toujours éligible', async () => {
    const client = makeFakeClient({
      document_extraction_run: [{ id: 'run-field', document_id: null }],
      documents: [],
    })
    expect(await isExtractionRunSourceDeleted(client, 'run-field')).toBe(false)
  })
})

describe('filterEligibleBySourceDocument', () => {
  it('exclut les lignes dont le document source est supprimé, garde les autres', async () => {
    const client = makeFakeClient({
      documents: [{ id: 'doc-deleted', deleted_at: '2026-09-16T00:00:00Z' }],
    })
    const rows = [
      { id: 'report-ghost', source_document_id: 'doc-deleted' },
      { id: 'report-survivor', source_document_id: 'doc-active' },
      { id: 'report-field-visit', source_document_id: null },
    ]
    const result = await filterEligibleBySourceDocument(client, rows)
    expect(result.map((r) => r.id)).toEqual(['report-survivor', 'report-field-visit'])
  })
})
