// P0 — DELETED HISTORICAL SOURCE (2026-09-17).
//
// listPendingSuggestionsForSite alimente la vue globale "Sujets à rapprocher" (résolution
// humaine). Une suggestion issue d'un run dont le document source a été supprimé
// (documents.deleted_at) ne doit plus jamais y apparaître : ni dans les métadonnées
// enrichies (label canonique), ni dans le tableau final retourné.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}

function makeAdmin(tables: Tables) {
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
      order: () => api,
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

import { listPendingSuggestionsForSite } from '@/lib/db/subject-suggestions'

const SITE_ID = 'site-dumbea-mall'

function seed(): Tables {
  return {
    canonical_subject_suggestion: [
      {
        id: 'sugg-ghost',
        subject_thread_id: 'thread-ghost',
        extraction_run_id: 'run-ghost',
        source_proposal_id: null,
        proposal_label: 'Sujet issu du PV supprimé',
        proposal_family: 'famille-x',
        candidate_canonical_subject_id: 'cs-ghost',
        model_confidence: 0.9,
        reasoning: null,
        shadow_decision: 'would_suggest',
        resolution: 'pending',
        resolver_version: 'v1',
        resolved_at: null,
        resolved_by: null,
        site_id: SITE_ID,
      },
      {
        id: 'sugg-survivor',
        subject_thread_id: 'thread-survivor',
        extraction_run_id: 'run-survivor',
        source_proposal_id: null,
        proposal_label: 'Sujet issu du PV actif',
        proposal_family: 'famille-y',
        candidate_canonical_subject_id: 'cs-survivor',
        model_confidence: 0.8,
        reasoning: null,
        shadow_decision: 'would_suggest',
        resolution: 'pending',
        resolver_version: 'v1',
        resolved_at: null,
        resolved_by: null,
        site_id: SITE_ID,
      },
    ],
    document_extraction_run: [
      {
        id: 'run-ghost',
        created_at: '2026-09-01T00:00:00Z',
        documents: { filename: 'pv-ghost.pdf', effective_date: '2026-09-01', deleted_at: '2026-09-16T00:00:00Z' },
      },
      {
        id: 'run-survivor',
        created_at: '2026-09-05T00:00:00Z',
        documents: { filename: 'pv-survivor.pdf', effective_date: '2026-09-05', deleted_at: null },
      },
    ],
    canonical_subject: [
      { id: 'cs-ghost', label: 'Sujet fantôme' },
      { id: 'cs-survivor', label: 'Sujet survivant' },
    ],
  }
}

beforeEach(() => {
  TABLES = seed()
})

describe('listPendingSuggestionsForSite — exclusion du document source supprimé (P0 2026-09-17)', () => {
  it('exclut la suggestion dont le run référence un document supprimé, garde le reste', async () => {
    const result = await listPendingSuggestionsForSite(SITE_ID)
    expect(result.map((r) => r.id)).toEqual(['sugg-survivor'])
  })

  it('la suggestion restante est correctement enrichie (label + origine)', async () => {
    const result = await listPendingSuggestionsForSite(SITE_ID)
    expect(result[0].candidate_label).toBe('Sujet survivant')
    expect(result[0].origin_label).toBe('pv-survivor.pdf')
  })
})
