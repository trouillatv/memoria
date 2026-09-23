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
    case 'is':
      return rows.filter((r) => r[col] === rest[0])
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
        is(col: string, val: unknown) {
          rows = applyFilter(rows, 'is', [col, val])
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

import { detectActorCongestion, detectOverdueActions, detectUnappliedDecisions } from '@/lib/db/site-memory-signals'

const SITE_ID = 'site-1'
const TODAY = '2026-08-15'

beforeEach(() => {
  rowsByTable = { site_actions: [], site_decisions: [] }
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

  it('action réouverte après fusion technique (status=open, superseded_by resté non-null) reste comptée — pas de masquage silencieux (mig 413)', async () => {
    rowsByTable.site_actions = [
      { id: 'a-reopened', title: 'Action réouverte', assigned_to: 'Entreprise Z', due_date: '2026-08-01', due_date_status: 'explicit', status: 'open', created_at: '2026-07-01', site_id: SITE_ID, superseded_by: 'a-old-durable' },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items.map((i) => i.id)).toEqual(['a-reopened'])
  })

  // Plan de visite Lot B (revue Vincent) : « Ne plus suivre » sur une action passe
  // par fn_cancel_action → status='cancelled'. La disparition à N+1 doit venir
  // UNIQUEMENT de ce statut — jamais d'une mémoire séparée du verdict watchlist.
  it('action « ne plus suivre » (status=cancelled) → absente du Plan à N+1', async () => {
    rowsByTable.site_actions = [
      { id: 'a-dismissed', title: 'Action écartée', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'explicit', status: 'cancelled', created_at: '2026-07-01', site_id: SITE_ID },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal).toBeNull()
  })

  it('action « ne plus suivre » réactivée par un humain (fn_reopen_action → status=open) redevient éligible au Plan', async () => {
    // Même id que l'action ci-dessus : seul le statut change, comme le ferait
    // fn_reopen_action en base. Aucune lecture de visit_watchlist_item ici —
    // ce détecteur ignore structurellement tout historique de verdict watchlist.
    rowsByTable.site_actions = [
      { id: 'a-dismissed', title: 'Action écartée', assigned_to: 'Entreprise X', due_date: '2026-08-01', due_date_status: 'explicit', status: 'open', created_at: '2026-07-01', site_id: SITE_ID },
    ]

    const signal = await detectOverdueActions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items.map((i) => i.id)).toEqual(['a-dismissed'])
  })
})

describe('detectUnappliedDecisions', () => {
  const acteeStale = (over: Row) => ({
    id: 'd-1', titre: 'Décision test', sujet: null, statut: 'actee', echeance: null,
    date_decision: '2026-06-01', // > 30 j avant TODAY (2026-08-15)
    superseded_by: null, pertinence_terrain: null, site_id: SITE_ID, ...over,
  })

  it('décision remplacée (superseded_by non-null) → absente du Plan (mig 319)', async () => {
    rowsByTable.site_decisions = [acteeStale({ id: 'd-remplacee', superseded_by: 'd-nouvelle' })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).toBeNull()
  })

  it("décision de mémoire uniquement (pertinence_terrain='memoire_seule') → absente du Plan (mig 431)", async () => {
    rowsByTable.site_decisions = [acteeStale({ id: 'd-memoire', pertinence_terrain: 'memoire_seule' })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).toBeNull()
  })

  it("décision à vérifier sur le terrain (pertinence_terrain='a_verifier') → présente", async () => {
    rowsByTable.site_decisions = [acteeStale({ id: 'd-a-verifier', pertinence_terrain: 'a_verifier' })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items.map((i) => i.id)).toEqual(['d-a-verifier'])
  })

  it('décision existante jamais classifiée (pertinence_terrain=NULL, legacy_unknown) → reste présente, comportement inchangé (non-régression anti-masquage)', async () => {
    rowsByTable.site_decisions = [acteeStale({ id: 'd-legacy', pertinence_terrain: null })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items.map((i) => i.id)).toEqual(['d-legacy'])
  })

  it('mix remplacée + mémoire + à vérifier + legacy → seules à vérifier et legacy restent', async () => {
    rowsByTable.site_decisions = [
      acteeStale({ id: 'd-remplacee', superseded_by: 'd-nouvelle' }),
      acteeStale({ id: 'd-memoire', pertinence_terrain: 'memoire_seule' }),
      acteeStale({ id: 'd-a-verifier', pertinence_terrain: 'a_verifier' }),
      acteeStale({ id: 'd-legacy', pertinence_terrain: null }),
    ]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal!.items.map((i) => i.id).sort()).toEqual(['d-a-verifier', 'd-legacy'])
  })

  // Plan de visite Lot B (revue Vincent) : « Ne plus suivre » sur une décision
  // passe par updateSiteDecision(statut='caduque'). La disparition à N+1 doit
  // venir UNIQUEMENT de ce statut — jamais d'une mémoire séparée du verdict
  // watchlist (même doctrine que pour les actions ci-dessus).
  it('décision « ne plus suivre » (statut=caduque) → absente du Plan à N+1', async () => {
    rowsByTable.site_decisions = [acteeStale({ id: 'd-dismissed', statut: 'caduque' })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).toBeNull()
  })

  it('décision « ne plus suivre » réactivée par un humain (statut=actee) redevient éligible au Plan', async () => {
    // Même id, seul le statut change — comme le ferait updateSiteDecision en base.
    // Aucune lecture de visit_watchlist_item ici : ce détecteur ignore
    // structurellement tout historique de verdict watchlist, dont dismissed_permanently.
    rowsByTable.site_decisions = [acteeStale({ id: 'd-dismissed', statut: 'actee' })]

    const signal = await detectUnappliedDecisions(SITE_ID, TODAY)

    expect(signal).not.toBeNull()
    expect(signal!.items.map((i) => i.id)).toEqual(['d-dismissed'])
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
