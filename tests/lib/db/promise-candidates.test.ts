import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries: Array<{ table: string; select: string; filters: Array<{ method: string; args: unknown[] }> }> = []
let rowsByTable: Record<string, unknown[]> = {}
let queryError: Error | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const record = { table, select: '', filters: [] as Array<{ method: string; args: unknown[] }> }
      queries.push(record)
      const query = {
        select(value: string) {
          record.select = value
          return query
        },
        eq(methodValue: string, ...args: unknown[]) {
          record.filters.push({ method: 'eq', args: [methodValue, ...args] })
          return query
        },
        in(methodValue: string, ...args: unknown[]) {
          record.filters.push({ method: 'in', args: [methodValue, ...args] })
          return query
        },
        then(resolve: (value: { data: unknown[]; error: Error | null }) => unknown) {
          return Promise.resolve(resolve({ data: rowsByTable[table] ?? [], error: queryError }))
        },
      }
      return query
    },
  }),
}))

import { getStructuredPromiseRecords } from '@/lib/db/promise-candidates'

const orgId = 'org-1'
const siteId = 'site-1'

function captured(overrides: Record<string, unknown> = {}) {
  return {
    id: 'captured-1',
    organization_id: orgId,
    site_id: siteId,
    kind: 'promise',
    status: 'active',
    title: 'Le planning sera diffusé vendredi',
    body: 'Texte libre ignoré pour la qualification',
    source_type: 'visit',
    source_id: 'report-1',
    created_at: '2026-07-20T08:00:00.000Z',
    ...overrides,
  }
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    organization_id: orgId,
    site_id: siteId,
    kind: 'deadline',
    status: 'proposed',
    title: 'L’électricien interviendra le 30 juillet',
    body: 'Ne pas analyser ce texte',
    payload: { commitment: true, dueAt: '2026-07-30T12:00:00+11:00' },
    report_id: 'report-2',
    source_capture_ids: ['capture-2'],
    dedupe_key: 'stable-key',
    promoted_object_id: null,
    created_at: '2026-07-21T08:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  queries.length = 0
  rowsByTable = { captured_knowledge: [], site_knowledge_proposals: [] }
  queryError = null
})

describe('getStructuredPromiseRecords', () => {
  it('applique les filtres organisation et chantier avant le mapping', async () => {
    await getStructuredPromiseRecords([orgId], [siteId])

    expect(queries.map((query) => query.table)).toEqual(['captured_knowledge', 'site_knowledge_proposals'])
    for (const query of queries) {
      expect(query.filters).toContainEqual({ method: 'in', args: ['organization_id', [orgId]] })
      expect(query.filters).toContainEqual({ method: 'in', args: ['site_id', [siteId]] })
    }
  })

  it('mappe une promesse captured_knowledge avec une source visite traçable', async () => {
    rowsByTable.captured_knowledge = [captured()]

    const records = await getStructuredPromiseRecords([orgId])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'captured-1',
      organizationId: orgId,
      siteId,
      kind: 'promise',
      title: 'Le planning sera diffusé vendredi',
      occurredAt: '2026-07-20T08:00:00.000Z',
      dueAt: null,
      confirmationSourceIds: [],
      relatedProofSourceIds: [],
    })
    expect(records[0].source).toEqual({
      type: 'visit',
      id: 'report-1',
      href: `/sites/${siteId}/visites/report-1`,
      label: 'Visite report-1',
    })
  })

  it('exclut les captured inactives et les captured sans source', async () => {
    rowsByTable.captured_knowledge = [
      captured({ id: 'resolved', status: 'resolved' }),
      captured({ id: 'no-source', source_id: null }),
    ]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('ne restitue pas une ligne étrangère même si le mock renvoie des données hors filtre', async () => {
    rowsByTable.captured_knowledge = [captured({ organization_id: 'org-b' })]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('rejette une ligne captured sans identifiant persistant', async () => {
    rowsByTable.captured_knowledge = [captured({ id: null })]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('propage les erreurs Supabase', async () => {
    queryError = new Error('database unavailable')

    await expect(getStructuredPromiseRecords([orgId])).rejects.toThrow('database unavailable')
  })

  it('mappe une deadline explicitement qualifiée comme engagement avec dueAt timezone-aware', async () => {
    rowsByTable.site_knowledge_proposals = [proposal()]

    const records = await getStructuredPromiseRecords([orgId])

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'proposal-1',
      kind: 'promise',
      dueAt: '2026-07-30T12:00:00+11:00',
      occurredAt: '2026-07-21T08:00:00.000Z',
    })
    expect(records[0].source.href).toBe(`/sites/${siteId}/visites/report-2`)
  })

  it('exclut une deadline normale même si son texte ressemble à une promesse', async () => {
    rowsByTable.site_knowledge_proposals = [
      proposal({ payload: { dueAt: '2026-07-30T12:00:00+11:00' } }),
    ]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('conserve une promesse explicitement qualifiée sans échéance', async () => {
    rowsByTable.captured_knowledge = [captured()]

    const records = await getStructuredPromiseRecords([orgId])

    expect(records[0].dueAt).toBeNull()
  })

  it('rejette les dueAt date-only ou sans fuseau', async () => {
    rowsByTable.site_knowledge_proposals = [
      proposal({ id: 'date-only', payload: { commitment: true, dueAt: '2026-07-30' } }),
      proposal({ id: 'no-zone', payload: { commitment: true, dueAt: '2026-07-30T12:00:00' } }),
    ]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('exclut les propositions terminales ou promues', async () => {
    rowsByTable.site_knowledge_proposals = [
      proposal({ id: 'confirmed', status: 'confirmed' }),
      proposal({ id: 'fulfilled', status: 'fulfilled' }),
      proposal({ id: 'dismissed', status: 'dismissed' }),
      proposal({ id: 'superseded', status: 'superseded' }),
      proposal({ id: 'promoted', promoted_object_id: 'deadline-1' }),
    ]

    await expect(getStructuredPromiseRecords([orgId])).resolves.toEqual([])
  })

  it('déduplique par identité persistante de manière déterministe', async () => {
    rowsByTable.site_knowledge_proposals = [
      proposal({ id: 'proposal-a' }),
      proposal({ id: 'proposal-b', title: 'Version dupliquée' }),
    ]

    const records = await getStructuredPromiseRecords([orgId])

    expect(records).toHaveLength(1)
    expect(records[0].title).toBe('L’électricien interviendra le 30 juillet')
  })

  it('n’analyse ni le texte, ni les preuves liées, et ne produit aucune confirmation', async () => {
    rowsByTable.captured_knowledge = [captured({ source_capture_ids: ['capture-1'] })]
    rowsByTable.site_knowledge_proposals = [proposal({ source_capture_ids: ['capture-2'] })]

    const records = await getStructuredPromiseRecords([orgId])

    expect(records).toHaveLength(2)
    expect(records.every((record) => record.confirmedAt === null)).toBe(true)
    expect(records.every((record) => record.confirmationSourceIds.length === 0)).toBe(true)
    expect(records.every((record) => record.relatedProofSourceIds.length === 0)).toBe(true)
  })
})
