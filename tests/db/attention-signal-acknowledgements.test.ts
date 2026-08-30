// D3 §11 — markAttentionSignalSeen / getAttentionSignalAcks (mig 373)
//
// Cas couverts :
//  1. markAttentionSignalSeen puis getAttentionSignalAcks → la clé apparaît vue
//  2. double markAttentionSignalSeen (même org/site/user/signal_key) → une seule ligne stockée
//  3. isolation par utilisateur : un autre user_id sur le même site ne voit pas l'ack
//  4. isolation par site : même user_id sur un autre site ne voit pas l'ack (pas de collision)
//  5. site inconnu (organization_id introuvable) → no-op silencieux, pas de throw

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface AckRow {
  organization_id: string
  site_id: string
  user_id: string
  signal_key: string
  seen_at: string
}

const SITES: Record<string, { organization_id: string } | undefined> = {
  'site-1': { organization_id: 'org-1' },
  'site-2': { organization_id: 'org-2' },
}

let store: Map<string, AckRow>

function ackKey(row: Pick<AckRow, 'organization_id' | 'site_id' | 'user_id' | 'signal_key'>): string {
  return `${row.organization_id}|${row.site_id}|${row.user_id}|${row.signal_key}`
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'sites') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({ data: SITES[id] ?? null, error: null }),
            }),
          }),
        }
      }
      if (table === 'attention_signal_acknowledgements') {
        return {
          upsert: async (row: AckRow) => {
            store.set(ackKey(row), row)
            return { data: null, error: null }
          },
          select: () => ({
            eq: (col1: string, v1: string) => ({
              eq: (col2: string, v2: string) => {
                const filters: Record<string, string> = { [col1]: v1, [col2]: v2 }
                const rows = [...store.values()].filter(
                  (r) => (r as unknown as Record<string, string>)[col1] === filters[col1] &&
                    (r as unknown as Record<string, string>)[col2] === filters[col2],
                )
                return Promise.resolve({ data: rows.map((r) => ({ signal_key: r.signal_key })), error: null })
              },
            }),
          }),
        }
      }
      throw new Error(`table non mockée : ${table}`)
    },
  }),
}))

const { markAttentionSignalSeen, getAttentionSignalAcks } = await import('@/lib/db/attention-signal-acknowledgements')

beforeEach(() => {
  store = new Map()
})

describe('markAttentionSignalSeen / getAttentionSignalAcks', () => {
  it('markSeen puis lecture → la clé apparaît vue', async () => {
    await markAttentionSignalSeen({ siteId: 'site-1', userId: 'user-1', signalKey: 'cs-1:stagnant' })
    const acks = await getAttentionSignalAcks('site-1', 'user-1')
    expect(acks.has('cs-1:stagnant')).toBe(true)
  })

  it('double markSeen (même org/site/user/signal_key) → une seule ligne stockée', async () => {
    await markAttentionSignalSeen({ siteId: 'site-1', userId: 'user-1', signalKey: 'cs-1:stagnant' })
    await markAttentionSignalSeen({ siteId: 'site-1', userId: 'user-1', signalKey: 'cs-1:stagnant' })
    expect(store.size).toBe(1)
  })

  it('isolation par utilisateur : un autre user_id sur le même site ne voit pas l’ack', async () => {
    await markAttentionSignalSeen({ siteId: 'site-1', userId: 'user-1', signalKey: 'cs-1:stagnant' })
    const acks = await getAttentionSignalAcks('site-1', 'user-2')
    expect(acks.has('cs-1:stagnant')).toBe(false)
  })

  it('isolation par site : même user_id sur un autre site ne voit pas l’ack (aucune collision)', async () => {
    await markAttentionSignalSeen({ siteId: 'site-1', userId: 'user-1', signalKey: 'cs-1:stagnant' })
    const acks = await getAttentionSignalAcks('site-2', 'user-1')
    expect(acks.has('cs-1:stagnant')).toBe(false)
  })

  it('site inconnu → no-op silencieux, pas de throw', async () => {
    await expect(
      markAttentionSignalSeen({ siteId: 'site-inconnu', userId: 'user-1', signalKey: 'cs-1:stagnant' }),
    ).resolves.toBeUndefined()
    expect(store.size).toBe(0)
  })
})
