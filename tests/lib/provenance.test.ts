import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── « POURQUOI ? » — LA PREUVE CIBLÉE ────────────────────────────────────────
// Ce que le read model doit garantir :
//   · fail-closed : un objet d'un autre tenant → null (le service-role bypasse
//     la RLS, la garde vit ici) ;
//   · statut + date de détection + source + CITATION CIBLÉE + lien ;
//   · la citation est RETROUVÉE dans le mémo (la phrase la plus proche de ce qui
//     a été extrait), JAMAIS tout le mémo ;
//   · sans source traçable, null — pas de bouton qui ment.

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: () => {}, revalidatePath: () => {} }))

let mockOrgIds: string[] = ['org-1']
vi.mock('@/lib/auth/memberships', () => ({ getOrgIdsOfUser: async () => mockOrgIds }))

// La base simulée, table par table.
let objRow: Record<string, unknown> | null = null
let siteRow: Record<string, unknown> | null = null
let propRow: Record<string, unknown> | null = null
let reportRow: Record<string, unknown> | null = null
let userRow: Record<string, unknown> | null = null
let capRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const single = async () => {
        if (table === 'sites') return { data: siteRow }
        if (table === 'site_knowledge_proposals') return { data: propRow }
        if (table === 'site_reports') return { data: reportRow }
        if (table === 'users') return { data: userRow }
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
  mockOrgIds = ['org-1']
  objRow = { id: 'e2', title: 'Vérification des lignes et consignations', site_id: 's-1', report_id: 'r-1', status: 'planned' }
  siteRow = { id: 's-1', name: 'Lycée PETRO ATTITI', organization_id: 'org-1' }
  propRow = { id: 'p-1', source_capture_ids: ['c-9'], report_id: 'r-1', status: 'confirmed', created_at: '2026-07-15T02:07:33Z', title: 'Vérification lignes/consignations', body: null }
  reportRow = { id: 'r-1', started_at: '2026-07-15T02:07:33Z' }
  userRow = { full_name: 'Guillaume' }
  // Le mémo contient DEUX phrases : une hors sujet, une qui a justifié l'extraction.
  capRows = [{ id: 'c-9', kind: 'vocal', body: 'On a bien avancé sur le gros œuvre aujourd’hui. Les électriciens vont vérifier les lignes et les consignations dans une semaine et demie.' }]
})

describe('getProvenance', () => {
  it('statut · détecté le · source · citation CIBLÉE · lien', async () => {
    const chain = await getProvenance('deadline', 'e2')
    expect(chain).not.toBeNull()
    expect(chain!.status).toBe('confirmed')
    expect(chain!.detectedAt).toBe('2026-07-15T02:07:33Z')
    expect(chain!.sourceLabel).toContain('15 juillet')
    expect(chain!.origin?.href).toBe('/sites/s-1/visites/r-1')
    expect(chain!.objectLabel).toBe('Vérification des lignes et consignations')
  })

  it('cite UNIQUEMENT la phrase pertinente — jamais tout le mémo', async () => {
    const chain = await getProvenance('deadline', 'e2')
    expect(chain!.citations).toHaveLength(1)
    expect(chain!.citations[0].text).toContain('vérifier les lignes')
    expect(chain!.citations[0].source).toBe('Mémo vocal')
    // La phrase hors sujet (« gros œuvre ») ne doit PAS être citée.
    expect(chain!.citations[0].text).not.toContain('gros œuvre')
  })

  it('au maximum 2 citations', async () => {
    capRows = [{
      id: 'c-9', kind: 'note',
      body: 'Vérifier les lignes avant lundi. Confirmer les consignations avec le chef. Contexte sans rapport ici. Prévoir la vérification des consignations en fin de semaine.',
    }]
    const chain = await getProvenance('deadline', 'e2')
    expect(chain!.citations.length).toBeGreaterThan(0)
    expect(chain!.citations.length).toBeLessThanOrEqual(2)
  })

  it('conserve le statut rejeté — traçabilité', async () => {
    propRow = { ...(propRow as object), status: 'dismissed' }
    const chain = await getProvenance('deadline', 'e2')
    expect(chain!.status).toBe('dismissed')
  })

  it('refuse un objet d’un AUTRE tenant — fail-closed', async () => {
    siteRow = { id: 's-1', name: 'Autre', organization_id: 'org-AUTRE' }
    expect(await getProvenance('deadline', 'e2')).toBeNull()
  })

  it('refuse sans organisation — fail-closed', async () => {
    mockOrgIds = []
    expect(await getProvenance('deadline', 'e2')).toBeNull()
  })

  it('sans source traçable, null — pas de bouton qui ment', async () => {
    // Objet saisi à la main : ni report_id, ni proposition derrière lui.
    objRow = { id: 'a-9', title: 'Action manuelle', site_id: 's-1', report_id: null }
    propRow = null
    capRows = []
    expect(await getProvenance('action', 'a-9')).toBeNull()
  })

  it('échéance active → aucune fin de vie (lifecycle null)', async () => {
    const chain = await getProvenance('deadline', 'e2')
    expect(chain!.lifecycle).toBeNull()
  })

  it('échéance annulée → fin de vie tracée (statut / motif / qui)', async () => {
    objRow = {
      id: 'e2', title: 'Vérification des lignes', site_id: 's-1', report_id: 'r-1',
      status: 'cancelled', cancelled_at: '2026-07-28T01:00:00Z', cancelled_by: 'u-1',
      cancel_reason: 'not_needed', cancel_comment: null, superseded_by: null,
    }
    const chain = await getProvenance('deadline', 'e2')
    expect(chain!.lifecycle).not.toBeNull()
    expect(chain!.lifecycle!.status).toBe('cancelled')
    expect(chain!.lifecycle!.reasonLabel).toBe('Plus nécessaire')
    expect(chain!.lifecycle!.byName).toBe('Guillaume')
  })

  it('une décision lit « titre », pas « title »', async () => {
    objRow = { id: 'd-1', titre: 'Les accès seront communiqués ultérieurement', site_id: 's-1', report_id: 'r-1' }
    const chain = await getProvenance('decision', 'd-1')
    expect(chain!.objectLabel).toBe('Les accès seront communiqués ultérieurement')
    expect(chain!.objectKind).toBe('Décision')
  })
})
