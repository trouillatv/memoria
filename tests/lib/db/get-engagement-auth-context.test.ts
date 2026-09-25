// P0-3.2 (mandat Vincent 2026-09-25) — getEngagementAuthContext est LA seule
// source du site_id d'autorisation pour l'activation Porte B : preuve qu'elle
// filtre bien par id et ne renvoie que le contexte minimal, jamais un
// DbEngagement complet qu'un appelant pourrait être tenté de faire confiance
// à un champ fourni par le client.

import { beforeEach, describe, expect, it, vi } from 'vitest'

let queryFilters: Array<{ method: string; args: unknown[] }> = []
let queryData: unknown = null
let queryError: Error | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const query = {
        select(value: string) {
          queryFilters.push({ method: 'select', args: [value] })
          return query
        },
        eq(column: string, value: unknown) {
          queryFilters.push({ method: 'eq', args: [column, value] })
          return query
        },
        maybeSingle: () => Promise.resolve({ data: queryData, error: queryError }),
      }
      return query
    },
  }),
}))

import { getEngagementAuthContext } from '@/lib/db/engagements'

beforeEach(() => {
  queryFilters = []
  queryData = null
  queryError = null
})

describe('getEngagementAuthContext', () => {
  it('filtre par id et sélectionne uniquement id/site_id/tender_id/status', async () => {
    queryData = { id: 'eng-1', site_id: 'site-1', tender_id: null, status: 'curated' }

    await getEngagementAuthContext('eng-1')

    expect(queryFilters.find((f) => f.method === 'eq')?.args).toEqual(['id', 'eng-1'])
    expect(queryFilters.find((f) => f.method === 'select')?.args[0]).toBe('id, site_id, tender_id, status')
  })

  it('Engagement inexistant : renvoie null', async () => {
    queryData = null

    await expect(getEngagementAuthContext('eng-inconnu')).resolves.toBeNull()
  })

  it('propage les erreurs Supabase', async () => {
    queryError = new Error('database unavailable')

    await expect(getEngagementAuthContext('eng-1')).rejects.toThrow('database unavailable')
  })
})
