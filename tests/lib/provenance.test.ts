import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── « POURQUOI ? » — LA CHAÎNE DE PROVENANCE ─────────────────────────────────
// Ce que le read model doit garantir :
//   · fail-closed : un objet d'un autre tenant → null (le service-role bypasse
//     la RLS, la garde vit ici) ;
//   · la chaîne remonte chantier → visite → mémo (mot pour mot) → objet ;
//   · sans provenance réelle, null — l'écran ne rend pas un bouton qui ne
//     tiendra pas sa promesse ;
//   · l'extrait vient de la CAPTURE désignée par la proposition (backref
//     promoted_object_id), jamais d'une paraphrase.

vi.mock('server-only', () => ({}))

let mockOrgId: string | null = 'org-1'
vi.mock('@/lib/db/users', () => ({ getOrgId: async () => mockOrgId }))

// La base simulée, table par table.
let objRow: Record<string, unknown> | null = null
let siteRow: Record<string, unknown> | null = null
let propRow: Record<string, unknown> | null = null
let reportRow: Record<string, unknown> | null = null
let capRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const single = async () => {
        if (table === 'sites') return { data: siteRow }
        if (table === 'site_knowledge_proposals') return { data: propRow }
        if (table === 'site_reports') return { data: reportRow }
        return { data: objRow } // site_actions / site_deadlines / site_decisions
      }
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self, eq: self, is: self, not: self, in: self,
        maybeSingle: single,
        limit: async () => ({ data: capRows }),
      })
      return chain
    },
  }),
}))

import { getProvenance } from '@/lib/knowledge/provenance'

beforeEach(() => {
  mockOrgId = 'org-1'
  objRow = { id: 'e2', title: 'Pose d’un coffret électrique', site_id: 's-1', report_id: 'r-1' }
  siteRow = { id: 's-1', name: 'Lycée PETRO ATTITI', organization_id: 'org-1' }
  propRow = { id: 'p-1', source_capture_ids: ['c-9'], report_id: 'r-1' }
  reportRow = { id: 'r-1', started_at: '2026-07-15T02:07:33Z' }
  capRows = [{ id: 'c-9', kind: 'vocal', body: 'À noter important les électriciens vont vérifier les lignes électriques…' }]
})

describe('getProvenance', () => {
  it('remonte chantier → visite → mémo mot pour mot → objet', async () => {
    const chain = await getProvenance('deadline', 'e2')
    expect(chain).not.toBeNull()
    const kinds = chain!.steps.map((s) => s.kind)
    expect(kinds).toEqual(['site', 'visite', 'memo', 'objet'])
    expect(chain!.steps[0].label).toBe('Lycée PETRO ATTITI')
    expect(chain!.steps[1].label).toContain('15 juillet')
    // La preuve, mot pour mot — jamais une paraphrase.
    expect(chain!.steps[2].excerpt).toContain('les électriciens vont vérifier')
    expect(chain!.steps[3].label).toBe('Pose d’un coffret électrique')
  })

  it('refuse un objet d’un AUTRE tenant — fail-closed', async () => {
    siteRow = { id: 's-1', name: 'Autre', organization_id: 'org-AUTRE' }
    expect(await getProvenance('deadline', 'e2')).toBeNull()
  })

  it('refuse sans organisation — fail-closed', async () => {
    mockOrgId = null
    expect(await getProvenance('deadline', 'e2')).toBeNull()
  })

  it('sans provenance réelle, null — pas de bouton qui ment', async () => {
    // Objet saisi à la main : ni report_id, ni proposition derrière lui.
    objRow = { id: 'a-9', title: 'Action manuelle', site_id: 's-1', report_id: null }
    propRow = null
    capRows = []
    expect(await getProvenance('action', 'a-9')).toBeNull()
  })

  it('une décision lit « titre », pas « title »', async () => {
    objRow = { id: 'd-1', titre: 'Les accès seront communiqués ultérieurement', site_id: 's-1', report_id: 'r-1' }
    const chain = await getProvenance('decision', 'd-1')
    expect(chain!.steps.at(-1)!.label).toBe('Les accès seront communiqués ultérieurement')
  })
})
