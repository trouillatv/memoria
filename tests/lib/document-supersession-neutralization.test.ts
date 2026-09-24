import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1B2 revue FIX_REQUIRED (Vincent 2026-09-24, correction 2) : « superseded »
// doit devenir historique pour de vrai — pas seulement une étiquette — sinon
// le contenu de l'ancienne version continue de ressurgir comme connaissance
// courante (knowledge_chunks, résonances site_reading_candidates).
//
// L'ancienne implémentation de markDocumentSuperseded enchaînait status=
// 'superseded' -> DELETE knowledge_chunks (irréversible) -> stale des
// résonances, avec une compensation applicative (revert du statut) en cas
// d'échec de la dernière étape. Ce revert ne pouvait jamais restaurer les
// knowledge_chunks déjà supprimés : un document "restauré" actif perdait
// alors définitivement sa connaissance indexée — exactement l'état partiel
// que la compensation devait empêcher.
//
// fn_supersede_document (migration 434) exécute désormais les trois étapes
// dans une seule fonction SQL (une seule transaction Postgres) : si une étape
// échoue, TOUT est annulé côté base — markDocumentSuperseded n'a plus qu'à
// appeler ce RPC et propager une éventuelle erreur, sans compensation
// applicative (elle n'a plus lieu d'être : soit tout est appliqué, soit rien
// ne l'est, garanti par Postgres).
//
// softDeleteDocument reste inchangé : il continue d'utiliser
// deactivateDocumentKnowledgeArtifacts en best-effort (un document déjà
// marqué supprimé ne doit jamais voir sa suppression bloquée par un échec de
// nettoyage des artefacts IA).

const DOC_ID = 'doc-v1'
const CANDIDATE_ID = 'candidate-1'

type UpdateCall = { payload: Record<string, unknown>; filters: Array<{ method: string; args: unknown[] }> }

let documentsUpdateCalls: UpdateCall[] = []
let chunksDeleteCalls: Array<{ filters: Array<[string, unknown]> }> = []
let candidatesSelectResult: { data: Array<{ id: string; source_ids: Array<{ type: string; id: string }> }>; error: unknown } = {
  data: [],
  error: null,
}
let candidatesUpdateCalls: Array<{ payload: unknown; ids: string[] }> = []
let candidatesUpdateError: unknown = null

let rpcCalls: Array<{ fn: string; args: unknown }> = []
let rpcError: unknown = null

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
          resolve({ error: null })
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
          resolve({ error: null })
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
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return { error: rpcError }
    },
  }),
}))

const { markDocumentSuperseded, softDeleteDocument } = await import('@/lib/db/documents')

beforeEach(() => {
  vi.clearAllMocks()
  documentsUpdateCalls = []
  chunksDeleteCalls = []
  candidatesSelectResult = {
    data: [{ id: CANDIDATE_ID, source_ids: [{ type: 'document', id: DOC_ID }] }],
    error: null,
  }
  candidatesUpdateError = null
  candidatesUpdateCalls = []
  rpcCalls = []
  rpcError = null
})

describe('markDocumentSuperseded', () => {
  it('appelle fn_supersede_document (RPC atomique) avec le bon document_id, sans aucun appel direct aux tables', async () => {
    await markDocumentSuperseded(DOC_ID)

    expect(rpcCalls).toEqual([{ fn: 'fn_supersede_document', args: { p_document_id: DOC_ID } }])
    // La neutralisation (stale des résonances, delete des knowledge_chunks,
    // passage à superseded) vit désormais entièrement dans la transaction SQL
    // du RPC : markDocumentSuperseded ne doit plus jamais toucher ces tables
    // directement depuis le JS.
    expect(documentsUpdateCalls).toHaveLength(0)
    expect(chunksDeleteCalls).toHaveLength(0)
    expect(candidatesUpdateCalls).toHaveLength(0)
  })

  it('propage l’erreur si le RPC échoue, sans tenter de compensation applicative (la transaction SQL a déjà tout annulé)', async () => {
    rpcError = new Error('db down')

    await expect(markDocumentSuperseded(DOC_ID)).rejects.toThrow('db down')

    // Aucune compensation JS n'est nécessaire ni tentée : Postgres a annulé
    // toute la transaction fn_supersede_document. L'ancienne version reste
    // donc réellement dans le même état exploitable qu'avant l'appel — status
    // toujours 'active', knowledge_chunks toujours présents, résonances
    // toujours 'active' — sans qu'aucun appel direct depuis markDocumentSuperseded
    // n'ait pu créer un état intermédiaire.
    expect(documentsUpdateCalls).toHaveLength(0)
    expect(chunksDeleteCalls).toHaveLength(0)
    expect(candidatesUpdateCalls).toHaveLength(0)
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
