import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── LE GRAPHE DU CHANTIER ────────────────────────────────────────────────────
// Ce que le read model doit garantir :
//   · fail-closed : chantier d'un autre tenant → null ;
//   · les arêtes de provenance viennent des DONNÉES (report_id,
//     source_capture_ids → promoted_object_id), jamais d'une invention ;
//   · chaque arête porte son POURQUOI ;
//   · aucun nœud orphelin : un objet sans mémo se raccroche à sa visite.

vi.mock('server-only', () => ({}))

// M3-D — le graphe est RESSOURCE-scopé : l'accès vient de l'appartenance à l'org
// DU chantier (site.organization_id), plus de `getOrgId()`. Le fail-closed
// cross-tenant se joue donc sur `requireOrganizationMembership`.
let memberOrgs = new Set<string>(['org-1'])
vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: async (orgId: string) =>
    memberOrgs.has(orgId) ? { ok: true } : { ok: false, error: 'not-member' },
}))

vi.mock('@/lib/db/visit-captures', () => ({
  // Les miniatures signées : hors sujet pour ces tests — on renvoie vide.
  getVisitCapturePreviewUrls: async () => ({}),
}))

let siteRow: Record<string, unknown> | null = null
const tables: Record<string, Array<Record<string, unknown>>> = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self, eq: self, is: self, in: self, order: self,
        maybeSingle: async () => ({ data: siteRow }),
        limit: async () => ({ data: tables[table] ?? [] }),
        // visit_capture se termine sur .is('hidden_at', null) sans limit :
        then: (resolve: (v: { data: unknown }) => void) => resolve({ data: tables[table] ?? [] }),
      })
      return chain
    },
  }),
}))

import { getSiteGraph } from '@/lib/knowledge/site-graph'

beforeEach(() => {
  memberOrgs = new Set<string>(['org-1'])
  siteRow = { id: 's-1', name: 'Petro Attiti', organization_id: 'org-1' }
  tables.site_reports = [{ id: 'r-1', started_at: '2026-07-15T02:07:00Z' }]
  tables.visit_capture = [
    { id: 'c-1', kind: 'vocal', body: 'les électriciens vont vérifier les lignes…', report_id: 'r-1', attachment_id: null },
    { id: 'c-2', kind: 'photo', body: null, report_id: 'r-1', attachment_id: 'att-1' },
  ]
  tables.site_actions = [{ id: 'a-1', title: 'Contacter M. Milon', status: 'open', report_id: 'r-1', created_at: '2026-07-17T08:20:00Z' }]
  tables.site_deadlines = [{ id: 'e-1', title: 'Pose du coffret', status: 'to_plan', due_date: null, constraint_text: 'dans une semaine', report_id: 'r-1', created_at: '2026-07-17T08:20:00Z' }]
  tables.site_decisions = []
  tables.site_watchpoints = []
  tables.site_knowledge_proposals = [
    { id: 'p-1', kind: 'deadline', status: 'confirmed', title: 'Pose du coffret', report_id: 'r-1', source_capture_ids: ['c-1'], promoted_object_id: 'e-1' },
    { id: 'p-2', kind: 'stakeholder', status: 'proposed', title: 'Vincent Milon (PAVE)', report_id: 'r-1', source_capture_ids: ['c-1'], promoted_object_id: null },
  ]
})

describe('getSiteGraph', () => {
  it('construit chantier, visite, photos groupées, mémo avec extrait', async () => {
    const g = await getSiteGraph('s-1')
    expect(g).not.toBeNull()
    const ids = g!.nodes.map((n) => n.id)
    expect(ids).toContain('site')
    expect(ids).toContain('v_r-1')
    expect(ids).toContain('ph_r-1')
    expect(ids).toContain('m_c-1')
    const memo = g!.nodes.find((n) => n.id === 'm_c-1')!
    expect(memo.excerpt).toContain('les électriciens')
  })

  it('l’arête mémo→échéance vient de la proposition confirmée, avec son pourquoi', async () => {
    const g = await getSiteGraph('s-1')
    const e = g!.edges.find((x) => x.a === 'm_c-1' && x.b === 'e_e-1')
    expect(e, 'source_capture_ids → promoted_object_id').toBeDefined()
    expect(e!.why).toContain('transcription')
  })

  it('un acteur cité est relié au mémo qui le mentionne, badge à confirmer', async () => {
    const g = await getSiteGraph('s-1')
    const acteur = g!.nodes.find((n) => n.id === 'act_p-2')!
    expect(acteur.sub).toContain('à confirmer')
    expect(g!.edges.some((x) => x.a === 'm_c-1' && x.b === 'act_p-2')).toBe(true)
  })

  it('un objet sans mémo se raccroche à sa visite — jamais orphelin', async () => {
    // L'action n'a AUCUNE proposition : elle doit tomber sur la visite.
    const g = await getSiteGraph('s-1')
    expect(g!.edges.some((x) => x.a === 'v_r-1' && x.b === 'a_a-1')).toBe(true)
  })

  it('chaque nœud daté porte sa date d’apparition — le replay en dépend', async () => {
    const g = await getSiteGraph('s-1')
    expect(g!.nodes.find((n) => n.id === 'v_r-1')!.t).toBe('2026-07-15T02:07:00Z')
    expect(g!.nodes.find((n) => n.id === 'e_e-1')!.t).toBe('2026-07-17T08:20:00Z')
  })

  it('refuse un chantier d’un autre tenant — fail-closed', async () => {
    siteRow = { id: 's-1', name: 'Autre', organization_id: 'org-AUTRE' }
    expect(await getSiteGraph('s-1')).toBeNull()
  })
})
