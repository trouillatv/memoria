import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── PERSONNE TERRAIN DANS L'ÉQUIPE (mig 219) ─────────────────────────────────
// Ce que le serveur doit garantir AVANT même les triggers :
//   · fail-closed : sans organisation, on refuse (le service-role bypasse la RLS) ;
//   · l'organisation vient TOUJOURS du serveur — jamais du client ;
//   · l'entreprise passe par le geste canonique (findOrCreateCompanyByName,
//     scopé org) — une entreprise d'un autre tenant est inatteignable ;
//   · un rattachement refusé ne laisse pas de contact ORPHELIN.
// Les impossibilités base (tenant croisé, contact archivé, doublon actif) sont
// prouvées par les TRIGGERS de la mig 219 — vérifiées sur base réelle en recette.

vi.mock('server-only', () => ({}))

let mockOrgId: string | null = 'org-demo'
vi.mock('@/lib/db/users', () => ({
  getOrgId: async () => mockOrgId,
}))

const findOrCreateCompanyByName = vi.fn(async (orgId: string, name: string) => {
  void orgId; void name
  return 'company-1'
})
vi.mock('@/lib/db/companies', () => ({
  findOrCreateCompanyByName: (orgId: string, name: string) => findOrCreateCompanyByName(orgId, name),
}))

// Journal des écritures : ce que le module a réellement envoyé à la base.
const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
const deletes: Array<{ table: string; id: string }> = []
let edgeInsertError: { message: string } | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        if (table === 'company_contacts') {
          return {
            select: () => ({ single: async () => ({ data: { id: 'contact-1' }, error: null }) }),
          }
        }
        // team_field_members : insert direct (pas de .select() dans le module)
        return Promise.resolve({ error: edgeInsertError })
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deletes.push({ table, id })
          return { error: null }
        },
      }),
    }),
  }),
}))

import { createFieldPersonInTeam } from '@/lib/db/team-field-members'

beforeEach(() => {
  mockOrgId = 'org-demo'
  edgeInsertError = null
  inserts.length = 0
  deletes.length = 0
  findOrCreateCompanyByName.mockClear()
})

describe('createFieldPersonInTeam', () => {
  it('refuse sans organisation — fail-closed, le service-role bypasse la RLS', async () => {
    mockOrgId = null
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts, 'aucune écriture ne doit partir sans org').toHaveLength(0)
  })

  it('l’organisation vient du SERVEUR, jamais du client', async () => {
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', job: 'Électricien', createdBy: 'u-1' })
    expect(res).toEqual({ ok: true, contactId: 'contact-1' })
    const contact = inserts.find((i) => i.table === 'company_contacts')!
    const edge = inserts.find((i) => i.table === 'team_field_members')!
    expect(contact.payload.organization_id).toBe('org-demo')
    expect(edge.payload.organization_id).toBe('org-demo')
    // Sans entreprise donnée : company_id null, et AUCUNE société créée.
    expect(contact.payload.company_id).toBeNull()
    expect(findOrCreateCompanyByName).not.toHaveBeenCalled()
  })

  it('l’entreprise passe par le geste canonique, scopé org', async () => {
    await createFieldPersonInTeam({ teamId: 't-1', fullName: 'Jean Dupont', companyName: 'ETV', createdBy: 'u-1' })
    // Le scoping org rend une entreprise d'un autre tenant inatteignable.
    expect(findOrCreateCompanyByName).toHaveBeenCalledWith('org-demo', 'ETV')
    const contact = inserts.find((i) => i.table === 'company_contacts')!
    expect(contact.payload.company_id).toBe('company-1')
  })

  it('un rattachement refusé ne laisse PAS de contact orphelin', async () => {
    edgeInsertError = { message: 'duplicate key value violates uq_team_field_members_active' }
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('déjà dans l’équipe')
    // Le contact créé pour CE rattachement est supprimé — rien n'existe à moitié.
    expect(deletes).toContainEqual({ table: 'company_contacts', id: 'contact-1' })
  })

  it('un refus du trigger tenant remonte en message clair', async () => {
    edgeInsertError = { message: 'team_field_members: équipe, contact et ligne doivent appartenir au même tenant' }
    const res = await createFieldPersonInTeam({ teamId: 't-autre-org', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('organisation')
    expect(deletes.length, 'rollback du contact').toBe(1)
  })

  it('refuse un nom vide', async () => {
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: '   ', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })
})
