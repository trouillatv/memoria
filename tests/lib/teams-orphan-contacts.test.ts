import { describe, it, expect, beforeEach, vi } from 'vitest'

// /EQUIPES V2 (Lot visuel 2026-10-01) — listOrphanContacts() est le pendant
// terrain de listOrphanUsers() (cf. tests/lib/teams-orphan-users.test.ts) :
// même doctrine de filtre (équipe active + left_at IS NULL), mais sur
// team_field_members/company_contacts plutôt que team_members/users. Les
// deux populations restent disjointes — ce test ne vérifie que la population
// contacts terrain.

vi.mock('server-only', () => ({}))

let orgIds: string[] = ['org-1']
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

let contactRows: Array<{
  id: string
  full_name: string
  function: string | null
  company_id: string | null
  is_internal_agent: boolean
}> = []
let teamRows: Array<{ id: string }> = []
let fieldMemberRows: Array<{ contact_id: string }> = []
let companyRows: Array<{ id: string; name: string }> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'company_contacts') return makeBuilder(() => ({ data: contactRows, error: null }))
      if (table === 'teams') return makeBuilder(() => ({ data: teamRows, error: null }))
      if (table === 'team_field_members') return makeBuilder(() => ({ data: fieldMemberRows, error: null }))
      if (table === 'companies') return makeBuilder(() => ({ data: companyRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import { listOrphanContacts } from '@/lib/db/teams'

beforeEach(() => {
  orgIds = ['org-1']
  contactRows = []
  teamRows = []
  fieldMemberRows = []
  companyRows = []
})

describe('listOrphanContacts — pendant terrain de listOrphanUsers', () => {
  it('contact rattaché (left_at IS NULL) à une équipe active → pas orphelin', async () => {
    contactRows = [{ id: 'c-1', full_name: 'Marie', function: 'Agent', company_id: null, is_internal_agent: false }]
    teamRows = [{ id: 'team-1' }]
    fieldMemberRows = [{ contact_id: 'c-1' }]

    const out = await listOrphanContacts()

    expect(out).toEqual([])
  })

  it('contact sans rattachement à une équipe active → orphelin', async () => {
    contactRows = [{ id: 'c-1', full_name: 'Marie', function: 'Agent', company_id: null, is_internal_agent: false }]
    teamRows = [{ id: 'team-1' }]
    fieldMemberRows = []

    const out = await listOrphanContacts()

    expect(out.map((c) => c.id)).toEqual(['c-1'])
  })

  it('aucune équipe active dans l\'org → tous les contacts restent orphelins', async () => {
    contactRows = [{ id: 'c-1', full_name: 'Marie', function: 'Agent', company_id: null, is_internal_agent: false }]
    teamRows = []
    fieldMemberRows = []

    const out = await listOrphanContacts()

    expect(out.map((c) => c.id)).toEqual(['c-1'])
  })

  it('résout le nom de l\'entreprise via company_id', async () => {
    contactRows = [
      { id: 'c-1', full_name: 'Marie', function: 'Agent', company_id: 'co-1', is_internal_agent: false },
    ]
    teamRows = []
    fieldMemberRows = []
    companyRows = [{ id: 'co-1', name: 'Clim Exp\'Air' }]

    const out = await listOrphanContacts()

    expect(out).toEqual([
      { id: 'c-1', fullName: 'Marie', job: 'Agent', companyName: 'Clim Exp\'Air', isInternalAgent: false },
    ])
  })

  it('orgIds vide → fail-closed, aucun orphelin', async () => {
    orgIds = []
    contactRows = [{ id: 'c-1', full_name: 'Marie', function: 'Agent', company_id: null, is_internal_agent: false }]

    const out = await listOrphanContacts()

    expect(out).toEqual([])
  })
})
