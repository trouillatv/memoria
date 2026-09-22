// @vitest-environment node
/**
 * P0 Unicité des runs historiques — POST /api/extraction/historical-pv
 *
 * Invariant : pour un document donné, un run déjà exploitable (ready_for_review,
 * partially_materialized, materialized) est réutilisé au lieu d'en recréer un —
 * sauf intention explicite de « Réanalyser » (force: true). Un run non finalisé
 * (pending/processing) n'est jamais doublé.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const getUser = vi.fn()
const getUserRoleById = vi.fn()
const getLatestExtractionRunForDocument = vi.fn()
const createExtractionRun = vi.fn()
const after = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: () => getUser() },
  }),
}))

vi.mock('@/lib/db/users', () => ({
  getUserRoleById: (...args: unknown[]) => getUserRoleById(...args),
}))

vi.mock('@/lib/db/document-extractions', () => ({
  getLatestExtractionRunForDocument: (...args: unknown[]) => getLatestExtractionRunForDocument(...args),
  createExtractionRun: (...args: unknown[]) => createExtractionRun(...args),
  READY_STATUSES: new Set(['ready_for_review', 'partially_materialized', 'materialized']),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const qb: Record<string, unknown> = {}
      qb.select = () => qb
      qb.eq = () => qb
      qb.is = () => qb
      if (table === 'documents') {
        qb.maybeSingle = async () => ({
          data: { organization_id: 'org-1', document_type: 'historical_visit_report' },
          error: null,
        })
      } else {
        qb.maybeSingle = async () => ({ data: { target_id: 'site-1' }, error: null })
      }
      return qb
    },
  }),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (...args: unknown[]) => after(...args) }
})

const DOCUMENT_ID = 'doc-1'

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/extraction/historical-pv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/extraction/historical-pv — unicité des runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    getUserRoleById.mockResolvedValue('manager')
    createExtractionRun.mockResolvedValue('run-new')
  })

  it('premier déclenchement standard (aucun run existant) — crée un run', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue(null)
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ ok: true, runId: 'run-new' })
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
  })

  it('relance pendant processing — 409, aucun nouveau run créé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'processing' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const data = await res.json()

    expect(res.status).toBe(409)
    expect(data).toMatchObject({ ok: false, runId: 'run-1' })
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('relance pendant pending — 409, aucun nouveau run créé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'pending' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))

    expect(res.status).toBe(409)
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('relance pendant ready_for_review — run réutilisé, aucun nouveau run créé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'ready_for_review' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ ok: true, runId: 'run-1', reused: true })
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('relance pendant partially_materialized — run réutilisé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'partially_materialized' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const data = await res.json()

    expect(data).toMatchObject({ ok: true, runId: 'run-1', reused: true })
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('relance pendant materialized — run réutilisé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'materialized' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const data = await res.json()

    expect(data).toMatchObject({ ok: true, runId: 'run-1', reused: true })
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('force: true sur un run exploitable — intention explicite « Réanalyser », nouveau run créé', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'ready_for_review' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID, force: true }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ ok: true, runId: 'run-new' })
    expect(data.reused).toBeUndefined()
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
  })

  it('force: true n\'a aucun effet pendant processing — toujours 409 (garde en vol prioritaire)', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'processing' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res = await POST(makeRequest({ documentId: DOCUMENT_ID, force: true }))

    expect(res.status).toBe(409)
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('double déclenchement standard successif sur un run ready_for_review — un seul run au total', async () => {
    getLatestExtractionRunForDocument.mockResolvedValue({ id: 'run-1', status: 'ready_for_review' })
    const { POST } = await import('@/app/api/extraction/historical-pv/route')

    const res1 = await POST(makeRequest({ documentId: DOCUMENT_ID }))
    const res2 = await POST(makeRequest({ documentId: DOCUMENT_ID }))

    expect((await res1.json()).runId).toBe('run-1')
    expect((await res2.json()).runId).toBe('run-1')
    expect(createExtractionRun).not.toHaveBeenCalled()
  })
})
