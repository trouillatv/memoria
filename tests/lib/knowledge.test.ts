import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock le client server pour pouvoir tester listAllTags sans Supabase
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { listAllTags } from '@/lib/db/knowledge'

describe('listAllTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dédoublonne et trie les tags alphabétiquement', async () => {
    const fakeData = [
      { tags: ['iso9001', 'ecolabel'] },
      { tags: ['iso9001', 'rgpd'] },
      { tags: null },
      { tags: ['ecolabel', 'environnement'] },
    ]
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          is: () => ({
            not: () => Promise.resolve({ data: fakeData, error: null }),
          }),
        }),
      }),
    } as never)

    const tags = await listAllTags()
    expect(tags).toEqual(['ecolabel', 'environnement', 'iso9001', 'rgpd'])
  })

  it('retourne tableau vide quand aucun item avec tags', async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          is: () => ({
            not: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    } as never)
    const tags = await listAllTags()
    expect(tags).toEqual([])
  })
})
