import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueryRecord = {
  table: string
  select: string
  filters: Array<{ method: string; args: unknown[] }>
  orders: Array<{ column: string; options: Record<string, unknown> | undefined }>
}

let queryRecord: QueryRecord | null = null
let engagementRows: unknown[] = []
let queryError: Error | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      queryRecord = {
        table,
        select: '',
        filters: [],
        orders: [],
      }

      const query = {
        select(value: string) {
          queryRecord!.select = value
          return query
        },
        eq(column: string, value: unknown) {
          queryRecord!.filters.push({ method: 'eq', args: [column, value] })
          return query
        },
        order(column: string, options?: Record<string, unknown>) {
          queryRecord!.orders.push({ column, options })
          return query
        },
        then(resolve: (value: { data: unknown[]; error: Error | null }) => unknown) {
          return Promise.resolve(resolve({ data: engagementRows, error: queryError }))
        },
      }

      return query
    },
  }),
}))

import { listTenderEngagementProvenance } from '@/lib/db/tender-engagement-provenance'

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'engagement-1',
    tender_id: 'tender-1',
    source_ref: null,
    tender_document_id: null,
    page_number: null,
    tender_document: null,
    ...overrides,
  }
}

beforeEach(() => {
  queryRecord = null
  engagementRows = []
  queryError = null
})

describe('listTenderEngagementProvenance', () => {
  it('returns exact with persisted document id, filename, page, and derived state', async () => {
    engagementRows = [
      dbRow({
        tender_document_id: 'doc-1',
        page_number: 12,
        tender_document: { id: 'doc-1', filename: 'CCAP.pdf' },
      }),
    ]

    await expect(listTenderEngagementProvenance('tender-1')).resolves.toEqual([
      {
        engagementId: 'engagement-1',
        tenderId: 'tender-1',
        sourceRef: null,
        documentId: 'doc-1',
        filename: 'CCAP.pdf',
        pageNumber: 12,
        state: 'exact',
      },
    ])
  })

  it('returns document_only with the persisted document id and filename when page is null', async () => {
    engagementRows = [
      dbRow({
        tender_document_id: 'doc-1',
        page_number: null,
        tender_document: { id: 'doc-1', filename: 'CCAP.pdf' },
      }),
    ]

    await expect(listTenderEngagementProvenance('tender-1')).resolves.toEqual([
      {
        engagementId: 'engagement-1',
        tenderId: 'tender-1',
        sourceRef: null,
        documentId: 'doc-1',
        filename: 'CCAP.pdf',
        pageNumber: null,
        state: 'document_only',
      },
    ])
  })

  it('returns unavailable when no structured provenance is persisted', async () => {
    engagementRows = [dbRow()]

    await expect(listTenderEngagementProvenance('tender-1')).resolves.toEqual([
      {
        engagementId: 'engagement-1',
        tenderId: 'tender-1',
        sourceRef: null,
        documentId: null,
        filename: null,
        pageNumber: null,
        state: 'unavailable',
      },
    ])
  })

  it('keeps unavailable when only legacy source_ref.page is present', async () => {
    engagementRows = [
      dbRow({
        source_ref: { page: 8, section: '4.2' },
      }),
    ]

    await expect(listTenderEngagementProvenance('tender-1')).resolves.toEqual([
      {
        engagementId: 'engagement-1',
        tenderId: 'tender-1',
        sourceRef: { page: 8, section: '4.2' },
        documentId: null,
        filename: null,
        pageNumber: null,
        state: 'unavailable',
      },
    ])
  })

  it('queries engagements with the composite tender-document join and deterministic created_at/id ordering', async () => {
    await listTenderEngagementProvenance('tender-123')

    expect(queryRecord).toMatchObject({
      table: 'engagements',
      filters: [{ method: 'eq', args: ['tender_id', 'tender-123'] }],
      orders: [
        { column: 'created_at', options: { ascending: true } },
        { column: 'id', options: { ascending: true } },
      ],
    })
    expect(queryRecord?.select).toContain(
      'tender_document:tender_documents!engagements_tender_document_tender_id_fkey',
    )
  })

  it('propagates Supabase errors', async () => {
    queryError = new Error('database unavailable')

    await expect(listTenderEngagementProvenance('tender-1')).rejects.toThrow('database unavailable')
  })
})
