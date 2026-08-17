import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── P5-F2a — ARCHIVAGE ET SUPERSESSION ────────────────────────────────────────
// archiveKnowledgeEntry : geste humain explicite, jamais un TTL. Idempotent : un
// second clic ne doit ni surprendre ni lever d’erreur.
// supersedeKnowledgeEntry : l’idempotence Copilote (copilot_proposal_id) doit
// court-circuiter la RPC — la RPC elle-même n’a pas de garde de rejeu, c’est ce
// wrapper qui la porte.

vi.mock('server-only', () => ({}))

const invalidateSiteProjection = vi.fn()
vi.mock('@/lib/knowledge/invalidate', () => ({
  invalidateSiteProjection: (siteId: string) => invalidateSiteProjection(siteId),
}))

let maybeSingleResult: { data: unknown } = { data: null }
let listResult: { data: unknown } = { data: [] }
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
const eqCalls: Array<[string, unknown]> = []
const rpcCalls: Array<[string, unknown]> = []
const limitCalls: number[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => {
        const builder = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return builder
          },
          is: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return builder
          },
          order: () => builder,
          limit: (n: number) => {
            limitCalls.push(n)
            return builder
          },
          maybeSingle: async () => maybeSingleResult,
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(listResult).then(resolve, reject),
        }
        return builder
      },
      update: () => ({
        eq: (col1: string, val1: unknown) => {
          eqCalls.push([col1, val1])
          return {
            eq: (col2: string, val2: unknown) => {
              eqCalls.push([col2, val2])
              return {
                eq: (col3: string, val3: unknown) => {
                  eqCalls.push([col3, val3])
                  return Promise.resolve({ error: null })
                },
              }
            },
          }
        },
      }),
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push([fn, args])
      return Promise.resolve(rpcResult)
    },
  }),
}))

import { archiveKnowledgeEntry, supersedeKnowledgeEntry, listRecentCurrentInformationEntries } from '@/lib/db/site-memory-entries'

beforeEach(() => {
  invalidateSiteProjection.mockClear()
  eqCalls.length = 0
  rpcCalls.length = 0
  limitCalls.length = 0
  maybeSingleResult = { data: null }
  listResult = { data: [] }
  rpcResult = { data: null, error: null }
})

describe('archiveKnowledgeEntry', () => {
  it('scope la mise à jour à l’entrée, au chantier, et au statut actif', async () => {
    await archiveKnowledgeEntry('entry-1', 'site-1')
    expect(eqCalls).toEqual([
      ['id', 'entry-1'],
      ['site_id', 'site-1'],
      ['status', 'active'],
    ])
    expect(invalidateSiteProjection).toHaveBeenCalledWith('site-1')
  })

  it('un second archivage ne lève aucune erreur — idempotent', async () => {
    await expect(archiveKnowledgeEntry('entry-1', 'site-1')).resolves.toBeUndefined()
  })
})

describe('supersedeKnowledgeEntry', () => {
  const baseInput = {
    organizationId: 'org-1',
    siteId: 'site-1',
    oldEntryId: 'old-1',
    title: 'Nouveau titre',
    confirmedBy: 'user-1',
    copilotProposalId: 'prop-1',
  }

  it('rejoue sans appeler la RPC quand copilot_proposal_id existe déjà', async () => {
    maybeSingleResult = { data: { id: 'existing-entry' } }
    const res = await supersedeKnowledgeEntry(baseInput)
    expect(res).toEqual({ ok: true, newEntryId: 'existing-entry' })
    expect(rpcCalls).toHaveLength(0)
    expect(invalidateSiteProjection).not.toHaveBeenCalled()
  })

  it('appelle la RPC et retourne le nouvel id quand la supersession réussit', async () => {
    rpcResult = { data: 'new-entry-id', error: null }
    const res = await supersedeKnowledgeEntry(baseInput)
    expect(res).toEqual({ ok: true, newEntryId: 'new-entry-id' })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0][0]).toBe('supersede_knowledge_entry')
    expect(invalidateSiteProjection).toHaveBeenCalledWith('site-1')
  })

  it('propage l’erreur de la RPC sans invalider la projection', async () => {
    rpcResult = { data: null, error: { message: 'entrée déjà remplacée' } }
    const res = await supersedeKnowledgeEntry(baseInput)
    expect(res).toEqual({ ok: false, error: 'entrée déjà remplacée' })
    expect(invalidateSiteProjection).not.toHaveBeenCalled()
  })

  it('renvoie une erreur générique quand la RPC ne renvoie rien sans message', async () => {
    rpcResult = { data: null, error: null }
    const res = await supersedeKnowledgeEntry(baseInput)
    expect(res).toEqual({ ok: false, error: 'Supersession impossible.' })
  })
})

describe('listRecentCurrentInformationEntries', () => {
  it('scope à current_information actif, sans suppression, et limite à 5 par défaut', async () => {
    await listRecentCurrentInformationEntries('site-1')
    expect(eqCalls).toEqual([
      ['site_id', 'site-1'],
      ['kind', 'current_information'],
      ['status', 'active'],
      ['deleted_at', null],
    ])
    expect(limitCalls).toEqual([5])
  })

  it('respecte une limite explicite', async () => {
    await listRecentCurrentInformationEntries('site-1', 2)
    expect(limitCalls).toEqual([2])
  })

  it('ne présélectionne rien : retourne les candidats bruts, dans l’ordre reçu', async () => {
    listResult = {
      data: [
        { id: 'e1', kind: 'current_information', title: 'Titre 1', body: 'Corps 1', source_report_id: null, valid_from: '2026-08-01', confirmed_at: '2026-08-10T10:00:00Z' },
        { id: 'e2', kind: 'current_information', title: 'Titre 2', body: null, source_report_id: 'rep-1', valid_from: '2026-08-02', confirmed_at: '2026-08-05T10:00:00Z' },
      ],
    }
    const res = await listRecentCurrentInformationEntries('site-1')
    expect(res).toEqual([
      { id: 'e1', kind: 'current_information', title: 'Titre 1', body: 'Corps 1', sourceReportId: null, validFrom: '2026-08-01', confirmedAt: '2026-08-10T10:00:00Z' },
      { id: 'e2', kind: 'current_information', title: 'Titre 2', body: null, sourceReportId: 'rep-1', validFrom: '2026-08-02', confirmedAt: '2026-08-05T10:00:00Z' },
    ])
  })

  it('renvoie une liste vide quand aucune entrée active n’existe', async () => {
    listResult = { data: null }
    const res = await listRecentCurrentInformationEntries('site-1')
    expect(res).toEqual([])
  })
})
