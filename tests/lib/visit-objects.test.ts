// P0 · Point 6 — read-model « Objets issus de cette visite » (GO Vincent).
// Provenance STRUCTURELLE uniquement (FK vers le report), aucune heuristique.
// Ces tests verrouillent : les deux chemins d'action (report_id + capture),
// la déduplication, la conservation d'une action clôturée, les 3 autres
// populations, l'absence d'invention sur FK nulle, l'exclusion des propositions,
// et les CTA de navigation (fiche précise vs espace métier).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mini-DB : chaque .from(table) rend un builder qui accumule les filtres
// (eq/in/is) et les applique au dataset de la table quand la requête est awaitée.
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  fromCalls: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      h.fromCalls.push(table)
      const rows = h.tables[table] ?? []
      const eqs: Array<[string, unknown]> = []
      const ins: Array<[string, unknown[]]> = []
      const isNull: string[] = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain },
        in: (c: string, v: unknown[]) => { ins.push([c, v]); return chain },
        is: (c: string) => { isNull.push(c); return chain },
        order: () => chain,
        then: (resolve: (r: { data: unknown[] }) => void) => {
          let out = rows
          for (const [c, v] of eqs) out = out.filter((r) => r[c] === v)
          for (const [c, vs] of ins) out = out.filter((r) => vs.includes(r[c]))
          for (const c of isNull) out = out.filter((r) => r[c] == null)
          resolve({ data: out })
        },
      }
      return chain
    },
  }),
}))

const { buildVisitObjects } = await import('@/lib/db/visit-objects')

const R = 'report-1'
const S = 'site-1'

beforeEach(() => {
  h.fromCalls = []
  h.tables = {
    visit_capture: [
      { id: 'cap-1', report_id: R, site_id: S },
      { id: 'cap-x', report_id: 'other', site_id: S },
    ],
    site_actions: [
      { id: 'act-direct', title: 'Transmettre le rapport G3', status: 'open', created_at: '2026-08-20T08:00:00Z', site_id: S, report_id: R, source_capture_id: null },
      { id: 'act-capture', title: 'Refaire le contrôle électrique', status: 'done', created_at: '2026-08-21T08:00:00Z', site_id: S, report_id: null, source_capture_id: 'cap-1' },
      { id: 'act-both', title: 'Faire signer le registre', status: 'planned', created_at: '2026-08-22T08:00:00Z', site_id: S, report_id: R, source_capture_id: 'cap-1' },
      { id: 'act-other', title: 'Action autre visite', status: 'open', created_at: '2026-08-23T08:00:00Z', site_id: S, report_id: 'other', source_capture_id: null },
    ],
    site_reserve: [
      { id: 'res-1', label: 'Contrôle électrique en retard', status: 'open', created_at: '2026-08-20T00:00:00Z', site_id: S, report_id: R },
      { id: 'res-null', label: 'Réserve sans report', status: 'open', created_at: '2026-08-20T00:00:00Z', site_id: S, report_id: null },
      { id: 'res-other', label: 'Réserve autre visite', status: 'open', created_at: '2026-08-20T00:00:00Z', site_id: S, report_id: 'other' },
    ],
    site_deadlines: [
      { id: 'dl-1', title: 'Nettoyage du conduit avant novembre', status: 'to_plan', created_at: '2026-08-20T00:00:00Z', site_id: S, report_id: R },
    ],
    site_knowledge_entries: [
      { id: 'kn-1', title: 'Accès livraison par la rue arrière', kind: 'durable_knowledge', status: 'active', deleted_at: null, confirmed_at: '2026-08-20T00:00:00Z', site_id: S, source_report_id: R },
      { id: 'kn-archived', title: 'Ancienne info', kind: 'current_information', status: 'archived', deleted_at: null, confirmed_at: '2026-08-20T00:00:00Z', site_id: S, source_report_id: R },
      { id: 'kn-null', title: 'Connaissance sans report', kind: 'durable_knowledge', status: 'active', deleted_at: null, confirmed_at: '2026-08-20T00:00:00Z', site_id: S, source_report_id: null },
    ],
  }
})

describe('buildVisitObjects — actions (deux relations, dédup, tous statuts)', () => {
  it('unit report_id direct + capture, déduplique, conserve une action clôturée, exclut les autres visites', async () => {
    const o = await buildVisitObjects(R, S)
    const ids = o.actions.map((a) => a.id)
    expect(ids).toEqual(['act-direct', 'act-capture', 'act-both']) // triés par created_at
    expect(ids.filter((i) => i === 'act-both')).toHaveLength(1)     // dédup (report_id ∧ capture)
    expect(ids).not.toContain('act-other')                          // autre report exclu
    const captured = o.actions.find((a) => a.id === 'act-capture')!
    expect(captured.statusLabel).toBe('Terminée')                  // clôturée CONSERVÉE
  })

  it('navigation précise : action → fiche + « Voir la fiche »', async () => {
    const o = await buildVisitObjects(R, S)
    const a = o.actions[0]
    expect(a.href).toBe(`/m/site/${S}/action/act-direct`)
    expect(a.precise).toBe(true)
    expect(a.ctaLabel).toBe('Voir la fiche')
  })
})

describe('buildVisitObjects — réserves / échéances / connaissances', () => {
  it('réserve liée uniquement (FK nulle ou autre visite ignorée), CTA espace honnête', async () => {
    const o = await buildVisitObjects(R, S)
    expect(o.reserves.map((r) => r.id)).toEqual(['res-1'])
    expect(o.reserves[0].href).toBe(`/m/site/${S}/reserves`)
    expect(o.reserves[0].precise).toBe(false)
    expect(o.reserves[0].ctaLabel).toBe('Voir les réserves')
    expect(o.reserves[0].statusLabel).toBe('Ouverte')
  })

  it('échéance liée → surface planning', async () => {
    const o = await buildVisitObjects(R, S)
    expect(o.deadlines.map((d) => d.id)).toEqual(['dl-1'])
    expect(o.deadlines[0].href).toBe('/m/planning')
    expect(o.deadlines[0].ctaLabel).toBe('Voir le planning')
    expect(o.deadlines[0].statusLabel).toBe('À planifier')
  })

  it('connaissance RETENUE (active) liée ; archivée et FK nulle exclues → Patrimoine', async () => {
    const o = await buildVisitObjects(R, S)
    expect(o.knowledge.map((k) => k.id)).toEqual(['kn-1'])
    expect(o.knowledge[0].href).toBe(`/m/site/${S}/patrimoine`)
    expect(o.knowledge[0].ctaLabel).toBe('Voir le patrimoine')
  })
})

describe('buildVisitObjects — invariants doctrine', () => {
  it('n’interroge JAMAIS une table de propositions (proposition ≠ objet produit)', async () => {
    await buildVisitObjects(R, S)
    const queried = new Set(h.fromCalls)
    expect(queried).toEqual(new Set(['visit_capture', 'site_actions', 'site_reserve', 'site_deadlines', 'site_knowledge_entries']))
    expect([...queried].some((t) => /proposal|pending/i.test(t))).toBe(false)
  })

  it('visite sans objet → isEmpty, toutes populations vides', async () => {
    const o = await buildVisitObjects('report-vide', S)
    expect(o.isEmpty).toBe(true)
    expect(o.actions).toHaveLength(0)
    expect(o.reserves).toHaveLength(0)
    expect(o.deadlines).toHaveLength(0)
    expect(o.knowledge).toHaveLength(0)
  })
})
