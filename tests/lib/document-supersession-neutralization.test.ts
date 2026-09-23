import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1B2 revue FIX_REQUIRED (Vincent 2026-09-24, tâche 1) : « superseded » doit
// devenir historique pour de vrai — pas seulement une étiquette — sinon le
// contenu de l'ancienne version continue de ressurgir comme connaissance
// courante (knowledge_chunks, résonances site_reading_candidates).
// markDocumentSuperseded et softDeleteDocument partagent la même neutralisation
// (deactivateDocumentKnowledgeArtifacts), avec une tolérance à l'échec
// différente : stricte + compensation pour la supersession (jamais un document
// "superseded" qui fuite encore), best-effort pour la suppression (déjà
// marquée supprimée, un échec de nettoyage ne doit pas bloquer la suppression).

const DOC_ID = 'doc-v1'
const CANDIDATE_ID = 'candidate-1'

type UpdateCall = { payload: Record<string, unknown>; filters: Array<{ method: string; args: unknown[] }> }

let documentsUpdateCalls: UpdateCall[] = []
let documentsUpdateError: unknown = null
let chunksDeleteError: unknown = null
let chunksDeleteCalls: Array<{ filters: Array<[string, unknown]> }> = []
let candidatesSelectResult: { data: Array<{ id: string; source_ids: Array<{ type: string; id: string }> }>; error: unknown } = {
  data: [],
  error: null,
}
let candidatesUpdateError: unknown = null
let candidatesUpdateCalls: Array<{ payload: unknown; ids: string[] }> = []

function documentsTableMock() {
  return {
    update: (payload: Record<string, unknown>) => {
      const filters: Array<{ method: string; args: unknown[] }> = []
      const chain = {
        eq: (...args: unknown[]) => {
          filters.push({ method: 'eq', args })
          return chain
        },
        is: (...args: unknown[]) => {
          filters.push({ method: 'is', args })
          return chain
        },
        then: (resolve: (v: { error: unknown }) => void) => {
          documentsUpdateCalls.push({ payload, filters })
          resolve({ error: documentsUpdateError })
        },
      }
      return chain
    },
  }
}

function knowledgeChunksTableMock() {
  return {
    delete: () => {
      const filters: Array<[string, unknown]> = []
      const chain = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val])
          return chain
        },
        then: (resolve: (v: { error: unknown }) => void) => {
          chunksDeleteCalls.push({ filters })
          resolve({ error: chunksDeleteError })
        },
      }
      return chain
    },
  }
}

function siteReadingCandidatesTableMock() {
  return {
    select: () => ({
      like: () => ({
        eq: async () => candidatesSelectResult,
      }),
    }),
    update: (payload: unknown) => ({
      in: async (_col: string, ids: string[]) => {
        candidatesUpdateCalls.push({ payload, ids })
        return { error: candidatesUpdateError }
      },
    }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'documents') return documentsTableMock()
      if (table === 'knowledge_chunks') return knowledgeChunksTableMock()
      if (table === 'site_reading_candidates') return siteReadingCandidatesTableMock()
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const { markDocumentSuperseded, softDeleteDocument } = await import('@/lib/db/documents')

beforeEach(() => {
  vi.clearAllMocks()
  documentsUpdateCalls = []
  documentsUpdateError = null
  chunksDeleteError = null
  chunksDeleteCalls = []
  candidatesSelectResult = {
    data: [{ id: CANDIDATE_ID, source_ids: [{ type: 'document', id: DOC_ID }] }],
    error: null,
  }
  candidatesUpdateError = null
  candidatesUpdateCalls = []
})

describe('markDocumentSuperseded', () => {
  it('passe status=superseded, supprime les knowledge_chunks du document et bascule ses résonances en stale', async () => {
    await markDocumentSuperseded(DOC_ID)

    expect(documentsUpdateCalls).toHaveLength(1)
    expect(documentsUpdateCalls[0].payload).toMatchObject({ status: 'superseded' })
    expect(chunksDeleteCalls[0].filters).toEqual([
      ['source_domain', 'document'],
      ['source_id', DOC_ID],
    ])
    expect(candidatesUpdateCalls).toHaveLength(1)
    expect(candidatesUpdateCalls[0].ids).toEqual([CANDIDATE_ID])
    expect(candidatesUpdateCalls[0].payload).toMatchObject({ status: 'stale' })
  })

  it('ignore une résonance dont source_ids[0] pointe vers un autre document', async () => {
    candidatesSelectResult = {
      data: [{ id: 'other-candidate', source_ids: [{ type: 'document', id: 'autre-doc' }] }],
      error: null,
    }
    await markDocumentSuperseded(DOC_ID)
    expect(candidatesUpdateCalls).toHaveLength(0)
  })

  it('repasse le document à active et propage l’erreur si la neutralisation échoue (jamais de superseded qui fuite)', async () => {
    candidatesUpdateError = new Error('db down')

    await expect(markDocumentSuperseded(DOC_ID)).rejects.toThrow('db down')

    expect(documentsUpdateCalls).toHaveLength(2)
    expect(documentsUpdateCalls[0].payload).toMatchObject({ status: 'superseded' })
    expect(documentsUpdateCalls[1].payload).toMatchObject({ status: 'active' })
  })
})

describe('softDeleteDocument', () => {
  it('marque deleted_at et neutralise aussi les artefacts IA', async () => {
    await softDeleteDocument(DOC_ID)
    expect(documentsUpdateCalls).toHaveLength(1)
    expect(documentsUpdateCalls[0].payload).toHaveProperty('deleted_at')
    expect(candidatesUpdateCalls).toHaveLength(1)
  })

  it('ne bloque jamais la suppression si le nettoyage des artefacts échoue (best-effort)', async () => {
    candidatesUpdateError = new Error('db down')
    await expect(softDeleteDocument(DOC_ID)).resolves.toBeUndefined()
    // Contrairement à markDocumentSuperseded, aucune compensation : le document reste supprimé.
    expect(documentsUpdateCalls).toHaveLength(1)
  })
})
