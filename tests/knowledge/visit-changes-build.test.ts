// P0 · Point 6 (convergence) — read-model PARTAGÉ buildVisitChanges (unique
// vérité desktop/mobile). Prouve les décisions d'arbitrage :
//   • actions : report_id direct ∪ source_capture_id→capture, dédup, tous statuts ;
//   • connaissances = site_knowledge_entries (retenues), JAMAIS captured_knowledge ;
//   • décisions / intervenants / vigilance / réserves / échéances liés au report ;
//   • une proposition pending (non promue) n'apparaît jamais comme objet.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VisitChangeGroup } from '@/lib/db/visit-narrative'

const h = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, fromCalls: [] as string[] }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      h.fromCalls.push(table)
      const rows = h.tables[table] ?? []
      const preds: Array<(r: Record<string, unknown>) => boolean> = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return chain },
        neq: (c: string, v: unknown) => { preds.push((r) => r[c] !== v); return chain },
        in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return chain },
        is: (c: string) => { preds.push((r) => r[c] == null); return chain },        // is(col, null)
        not: (c: string) => { preds.push((r) => r[c] != null); return chain },        // not(col, 'is', null)
        order: () => chain,
        then: (resolve: (r: { data: unknown[] }) => void) => resolve({ data: rows.filter((r) => preds.every((p) => p(r))) }),
      }
      return chain
    },
  }),
}))

const { buildVisitChanges } = await import('@/lib/db/visit-narrative')

const R = 'report-1'

function allIds(groups: VisitChangeGroup[], pop: keyof VisitChangeGroup): string[] {
  return groups.flatMap((g) => (g[pop] as Array<{ id: string }>).map((x) => x.id)).sort()
}

beforeEach(() => {
  h.fromCalls = []
  h.tables = {
    visit_capture: [{ id: 'cap-1', report_id: R }, { id: 'cap-x', report_id: 'other' }],
    site_actions: [
      { id: 'act-direct', title: 'AD', status: 'open', priority: null, subject_thread_id: 'th1', report_id: R, source_capture_id: null, deleted_at: null },
      { id: 'act-capture', title: 'AC', status: 'done', priority: null, subject_thread_id: null, report_id: null, source_capture_id: 'cap-1', deleted_at: null },
      { id: 'act-both', title: 'AB', status: 'planned', priority: null, subject_thread_id: null, report_id: R, source_capture_id: 'cap-1', deleted_at: null },
      { id: 'act-other', title: 'AO', status: 'open', priority: null, subject_thread_id: null, report_id: 'other', source_capture_id: null, deleted_at: null },
    ],
    site_knowledge_proposals: [
      { id: 'prop-pending', kind: 'reserve', promoted_object_id: null, promoted_object_type: null, canonical_subject_id: null, report_id: R, status: 'proposed' },
    ],
    subject_thread_identity: [{ subject_thread_id: 'th1', canonical_subject_id: 'cs1' }],
    canonical_subject: [{ id: 'cs1', label: 'Sujet 1' }],
    site_reserve: [{ id: 'res-1', label: 'R1', report_id: R }, { id: 'res-other', label: 'RO', report_id: 'other' }],
    site_deadlines: [{ id: 'dl-1', title: 'D1', due_date: null, report_id: R, deleted_at: null }],
    site_decisions: [{ id: 'dec-1', titre: 'Dec1', report_id: R }],
    site_knowledge_entries: [
      { id: 'kn-1', title: 'K1', kind: 'durable_knowledge', source_report_id: R, status: 'active', deleted_at: null },
      { id: 'kn-arch', title: 'KA', kind: 'current_information', source_report_id: R, status: 'archived', deleted_at: null },
      { id: 'kn-null', title: 'KN', kind: 'durable_knowledge', source_report_id: null, status: 'active', deleted_at: null },
    ],
    site_watchpoints: [{ id: 'w-1', title: 'W1', report_id: R, deleted_at: null }],
    site_intervenants: [{ id: 'iv-1', role: 'Entreprise', company_id: 'co-1', main_contact_id: null, source_report_id: R }],
    companies: [{ id: 'co-1', name: 'ACME', short_name: 'ACME' }],
    company_contacts: [],
    captured_knowledge: [{ id: 'cap-fact', title: 'Fait capté', kind: 'fact', source_id: R }],
  }
})

describe('buildVisitChanges — populations liées au report (unique vérité)', () => {
  it('actions : report_id direct ∪ capture, dédupliquées, clôturée conservée, autre visite exclue', async () => {
    const g = await buildVisitChanges(R)
    const ids = allIds(g, 'actions')
    expect(ids).toEqual(['act-both', 'act-capture', 'act-direct'])
    expect(ids).not.toContain('act-other')
  })

  it('réserve / échéance / décision / vigilance / intervenant liés au report', async () => {
    const g = await buildVisitChanges(R)
    expect(allIds(g, 'reserves')).toEqual(['res-1'])
    expect(allIds(g, 'deadlines')).toEqual(['dl-1'])
    expect(allIds(g, 'decisions')).toEqual(['dec-1'])
    expect(allIds(g, 'watchpoints')).toEqual(['w-1'])
    expect(allIds(g, 'stakeholders')).toEqual(['iv-1'])
  })

  it('connaissances = site_knowledge_entries RETENUES (active) ; archivée et FK nulle exclues', async () => {
    const g = await buildVisitChanges(R)
    expect(allIds(g, 'knowledge')).toEqual(['kn-1'])
  })

  it('captured_knowledge n’est JAMAIS interrogé (donnée d’extraction, pas un objet produit)', async () => {
    await buildVisitChanges(R)
    expect(h.fromCalls).toContain('site_knowledge_entries')
    expect(h.fromCalls).not.toContain('captured_knowledge')
  })

  it('une proposition pending (non promue) n’apparaît dans aucune population', async () => {
    const g = await buildVisitChanges(R)
    const every = (['actions', 'reserves', 'deadlines', 'decisions', 'watchpoints', 'stakeholders', 'knowledge'] as const)
      .flatMap((p) => allIds(g, p))
    expect(every).not.toContain('prop-pending')
    expect(every).not.toContain('cap-fact')
  })
})
