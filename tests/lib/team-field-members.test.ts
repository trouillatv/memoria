import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── PERSONNE TERRAIN DANS L'ÉQUIPE (mig 219 + 244) ───────────────────────────
// Ce que le serveur garantit AVANT les triggers :
//   · fail-closed : équipe introuvable/sans org → refus (le service-role bypasse la RLS) ;
//   · l'organisation vient de l'ÉQUIPE (serveur), jamais du client ;
//   · l'entreprise passe par le geste canonique (findOrCreateCompanyByName, scopé org) ;
//   · un rattachement refusé ne laisse pas de contact ORPHELIN ;
//   · un agent créé depuis une équipe est classé is_internal_agent = true (mig 244) ;
//   · rattacher un existant refuse un contact d'une AUTRE organisation.

vi.mock('server-only', () => ({}))

// État configurable de la « base » simulée.
let teamRow: { organization_id: string } | null = { organization_id: 'org-demo' }
let membership: { ok: true } | { ok: false; error: string } = { ok: true }
let contactLookup: { id: string; organization_id: string; deleted_at: string | null } | null =
  { id: 'c-existing', organization_id: 'org-demo', deleted_at: null }
let searchRows: Array<Record<string, unknown>> = []
let edgeInsertError: { message: string } | null = null

vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: async () => membership,
}))

const findOrCreateCompanyByName = vi.fn(async (_orgId: string, _name: string) => 'company-1')
vi.mock('@/lib/db/companies', () => ({
  findOrCreateCompanyByName: (orgId: string, name: string) => findOrCreateCompanyByName(orgId, name),
}))

const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
const deletes: Array<{ table: string; id: string }> = []

// Query-builder chainable minimal : chaque filtre renvoie le builder ; il est
// « thenable » (pour les SELECT de liste) ET porte maybeSingle/single.
function makeSelect(table: string) {
  const rowResult = () => {
    if (table === 'teams') return { data: teamRow, error: null }
    if (table === 'company_contacts') return { data: contactLookup, error: null }
    return { data: null, error: null }
  }
  const listResult = () => ({ data: searchRows, error: null })
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'in', 'is', 'ilike', 'order', 'limit', 'neq', 'not']) b[m] = self
  b.maybeSingle = async () => rowResult()
  b.single = async () => rowResult()
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(listResult()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => makeSelect(table),
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        if (table === 'company_contacts') {
          return { select: () => ({ single: async () => ({ data: { id: 'contact-1' }, error: null }) }) }
        }
        return Promise.resolve({ error: edgeInsertError })
      },
      delete: () => ({
        eq: async (_col: string, id: string) => { deletes.push({ table, id }); return { error: null } },
      }),
    }),
  }),
}))

import { createFieldPersonInTeam, attachContactToTeam } from '@/lib/db/team-field-members'

beforeEach(() => {
  teamRow = { organization_id: 'org-demo' }
  membership = { ok: true }
  contactLookup = { id: 'c-existing', organization_id: 'org-demo', deleted_at: null }
  searchRows = []
  edgeInsertError = null
  inserts.length = 0
  deletes.length = 0
  findOrCreateCompanyByName.mockClear()
})

describe('createFieldPersonInTeam', () => {
  it('refuse si l’équipe est introuvable/sans org — fail-closed', async () => {
    teamRow = null
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts, 'aucune écriture sans org').toHaveLength(0)
  })

  it('l’organisation vient de l’ÉQUIPE, et l’agent est classé interne (mig 244)', async () => {
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', job: 'Électricien', createdBy: 'u-1' })
    expect(res).toEqual({ ok: true, contactId: 'contact-1' })
    const contact = inserts.find((i) => i.table === 'company_contacts')!
    const edge = inserts.find((i) => i.table === 'team_field_members')!
    expect(contact.payload.organization_id).toBe('org-demo')
    expect(edge.payload.organization_id).toBe('org-demo')
    expect(contact.payload.is_internal_agent).toBe(true)
    expect(contact.payload.company_id).toBeNull()
    expect(findOrCreateCompanyByName).not.toHaveBeenCalled()
  })

  it('email et téléphone facultatifs sont transmis, sans aucun flux compte', async () => {
    await createFieldPersonInTeam({
      teamId: 't-1', fullName: 'Jean Dupont', email: 'jean@ex.fr', phone: '0687', createdBy: 'u-1',
    })
    const contact = inserts.find((i) => i.table === 'company_contacts')!
    expect(contact.payload.email).toBe('jean@ex.fr')
    expect(contact.payload.phone).toBe('0687')
    // Rien n'écrit dans users / auth : seules company_contacts + team_field_members.
    expect(new Set(inserts.map((i) => i.table))).toEqual(new Set(['company_contacts', 'team_field_members']))
  })

  it('l’entreprise passe par le geste canonique, scopé org', async () => {
    await createFieldPersonInTeam({ teamId: 't-1', fullName: 'Jean Dupont', companyName: 'ETV', createdBy: 'u-1' })
    expect(findOrCreateCompanyByName).toHaveBeenCalledWith('org-demo', 'ETV')
    const contact = inserts.find((i) => i.table === 'company_contacts')!
    expect(contact.payload.company_id).toBe('company-1')
  })

  it('un rattachement refusé (doublon) ne laisse PAS de contact orphelin', async () => {
    edgeInsertError = { message: 'duplicate key value violates uq_team_field_members_active' }
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('déjà dans l’équipe')
    expect(deletes).toContainEqual({ table: 'company_contacts', id: 'contact-1' })
  })

  it('un refus du trigger tenant remonte en message clair, avec rollback', async () => {
    edgeInsertError = { message: 'team_field_members: équipe/contact/ligne doivent appartenir au même tenant' }
    const res = await createFieldPersonInTeam({ teamId: 't-autre', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('organisation')
    expect(deletes.length).toBe(1)
  })

  it('refuse un nom vide', async () => {
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: '   ', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it('refuse si l’appelant n’est pas membre de l’organisation de l’équipe', async () => {
    membership = { ok: false, error: 'Accès organisation refusé' }
    const res = await createFieldPersonInTeam({ teamId: 't-1', fullName: 'M. X', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })
})

describe('attachContactToTeam — rattacher un existant', () => {
  it('rattache une personne de la même organisation', async () => {
    const res = await attachContactToTeam({ teamId: 't-1', contactId: 'c-existing', createdBy: 'u-1' })
    expect(res).toEqual({ ok: true, contactId: 'c-existing' })
    expect(inserts.find((i) => i.table === 'team_field_members')).toBeTruthy()
  })

  it('REFUSE une personne d’une AUTRE organisation (anti-rattachement croisé)', async () => {
    contactLookup = { id: 'c-existing', organization_id: 'org-autre', deleted_at: null }
    const res = await attachContactToTeam({ teamId: 't-1', contactId: 'c-existing', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
    expect(inserts.find((i) => i.table === 'team_field_members')).toBeUndefined()
  })

  it('refuse une personne archivée', async () => {
    contactLookup = { id: 'c-existing', organization_id: 'org-demo', deleted_at: '2026-07-01T00:00:00Z' }
    const res = await attachContactToTeam({ teamId: 't-1', contactId: 'c-existing', createdBy: 'u-1' })
    expect(res.ok).toBe(false)
  })
})
