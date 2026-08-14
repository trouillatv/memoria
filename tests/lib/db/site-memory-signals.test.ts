import { beforeEach, describe, expect, it, vi } from 'vitest'

// due_date_status distingue une date CONFIRMÉE par un humain (explicit) d'une date
// DÉDUITE par l'IA (estimated / null). Règle LOT4 : une date non confirmée ne doit
// jamais alimenter « X actions en retard » ni le compteur de congestion par acteur
// (retour Guillaume 2026-08-14). Contrairement à site-attention-items.ts et
// canonical-attention.ts, ce fichier filtre au niveau de la requête Supabase — le
// mock ci-dessous applique donc RÉELLEMENT les filtres enregistrés, pour prouver
// que la ligne non confirmée est effectivement exclue, pas seulement que le bon
// filtre a été demandé.

type Row = Record<string, unknown>

let rowsByTable: Record<string, Row[]> = {}

function applyFilter(rows: Row[], method: string, args: unknown[]): Row[] {
  const [col, ...rest] = args as [string, ...unknown[]]
  switch (method) {
    case 'eq':
      return rows.filter((r) => r[col] === rest[0])
    case 'not': {
      const [op, val] = rest
      if (op === 'is' && val === null) return rows.filter((r) => r[col] !== null && r[col] !== undefined)
      return rows.filter((r) => r[col] !== val)
    }
    case 'lte':
      return rows.filter((r) => (r[col] as string) <= (rest[0] as string))
    case 'gte':
      return rows.filter((r) => (r[col] as string) >= (rest[0] as string))
    case 'in':
      return rows.filter((r) => (rest[0] as unknown[]).includes(r[col]))
    default:
      return rows
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      let rows = rowsByTable[table] ?? []
      const query = {
        select() {
          return query
        },
        eq(col: string, val: unknown) {
          rows = applyFilter(rows, 'eq', [col, val])
          return query
        },
        not(col: string, op: string, val: unknown) {
          rows = applyFilter(rows, 'not', [col, op, val])
          return query
        },
        lte(col: string, val: unknown) {
          rows = applyFilter(rows, 'lte', [col, val])
          return query
        },
        gte(col: string, val: unknown) {
          rows = applyFilter(rows, 'gte', [col, val])
          return query
        },
        in(col: string, val: unknown[]) {
          rows = applyFilter(rows, 'in', [col, val])
          return query
        },
        order(col: string, opts?: { ascending?: boolean }) {
          rows = [...rows].sort((a, b) => {
            const av = a[col] as string
            const bv = b[col] as string
            const cmp = av < bv ? -1 : av > bv ? 1 : 0
            return opts?.ascending === false ? -cmp : cmp
          })
          return query
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: rows, error: null }))
        },
      }
      return query
    },
  }),
}))

import { detectActorCongestion, detectOverdueActions } from '@/lib/db/site-memory-signals'

const SITE_ID = 'site-1'
const TODAY = '2026-08-15'

beforeEach(() => {
  rowsByTable = { site_actions: [] }
})

describe('detectOverdueActions', () => {
  it('due_date_status=explicit et date passée → compte dans « X actions en retard »', async () => {
    rowsByTable.site_actions = [
      { id: 'a-explicit', title: 'Action confirmée', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'explicit', status: 'open', created_at: '2026-07-01', site_id: SITE_ID },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.title).toBe('1 action en retard')
    expect(signal!.items).toHaveLength(1)
    expect(signal!.items[0].id).toBe('a-explicit')
  })

  it('due_date_status=estimated et date passée → ne contribue jamais au compteur', async () => {
    rowsByTable.site_actions = [
      { id: 'a-estimated', title: 'Action estimée', assigned_to: 'Entreprise Y', due_date: '2026-08-01', due_date_status: 'estimated', status: 'open', created_at: '2026-07-01', site_id: SITE_ID },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal).toBeNull()
  })

  it('mélange confirmé/non confirmé → seule la ligne confirmée est comptée', async () => {
    rowsByTable.site_actions = [
      { id: 'a-explicit', title: 'Action confirmée', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'explicit', status: 'open', created_at: '2026-07-01', site_id: SITE_ID },
      { id: 'a-estimated', title: 'Action estimée', assigned_to: 'Entreprise Y', due_date: '2026-08-01', due_date_status: 'estimated', status: 'open', created_at: '2026-07-01', site_id: SITE_ID },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal!.title).toBe('1 action en retard')
    expect(signal!.items.map((i) => i.id)).toEqual(['a-explicit'])
  })
})

describe('detectActorCongestion', () => {
  it('le compteur « en retard » par acteur ne compte que les échéances confirmées', async () => {
    rowsByTable.site_actions = [
      { id: '1', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'explicit', status: 'open', site_id: SITE_ID },
      { id: '2', assigned_to: 'Entreprise X', due_date: '2026-08-05', due_date_status: 'estimated', status: 'open', site_id: SITE_ID },
    ]

    const signal = await detectActorCongestion(SITE_ID, 2, 0.5, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items).toHaveLength(1)
    expect(signal!.items[0].meta).toContain('1 en retard')
    expect(signal!.items[0].meta).not.toContain('2 en retard')
  })

  it('aucune échéance confirmée en retard → pas de mention « en retard » dans le meta', async () => {
    rowsByTable.site_actions = [
      { id: '1', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'estimated', status: 'open', site_id: SITE_ID },
      { id: '2', assigned_to: 'Entreprise X', due_date: '2026-08-05', due_date_status: 'estimated', status: 'open', site_id: SITE_ID },
    ]

    const signal = await detectActorCongestion(SITE_ID, 2, 0.5, TODAY)

    expect(signal!.items[0].meta).not.toContain('en retard')
  })
})
