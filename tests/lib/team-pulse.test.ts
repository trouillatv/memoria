import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX C (revue ChatGPT/Vincent, 08e355e2) — le pulse global doit :
//   1. restreindre TOUTES les populations « en équipe » (team_members ET
//      team_field_members) aux équipes ACTIVES (active=true, non supprimées) ;
//   2. compter « sans équipe » sur les DEUX populations (users ET contacts
//      terrain), jamais fusionnées par nom/email — deux tables, deux identités.

vi.mock('server-only', () => ({}))

let orgIds: string[] = ['org-1']
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

vi.mock('@/lib/storage/intervention-photos', () => ({
  getSignedPhotoUrlsThumb: async () => new Map(),
}))

let orphanUsers: Array<{ id: string; full_name: string | null; email: string; role: string }> = []
const listOrphanUsersMock = vi.fn(async () => orphanUsers)
vi.mock('@/lib/db/teams', () => ({
  listOrphanUsers: () => listOrphanUsersMock(),
  getTeamDependencies: async () => ({
    futureInterventions: 0,
    rotationSlots: 0,
    rotationCycleCount: 0,
    rotationSiteNames: [],
  }),
}))

type TeamRow = { id: string; active: boolean; deleted_at: string | null; organization_id: string }
type MemberRow = { user_id: string; team_id: string; left_at: string | null }
type FieldMemberRow = { contact_id: string; team_id: string; left_at: string | null }
type ContactRow = { id: string; organization_id: string; deleted_at: string | null }

let teamRows: TeamRow[] = []
let memberRows: MemberRow[] = []
let fieldMemberRows: FieldMemberRow[] = []
let contactRows: ContactRow[] = []

function makeTable(getRows: () => Array<Record<string, unknown>>) {
  return () => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = []
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return builder
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
        return builder
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return builder
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) >= (val as string))
        return builder
      },
      order: () => builder,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: getRows().filter((r) => filters.every((f) => f(r))), error: null }).then(
          resolve,
          reject,
        ),
    }
    return builder
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'teams') return makeTable(() => teamRows)()
      if (table === 'team_members') return makeTable(() => memberRows)()
      if (table === 'team_field_members') return makeTable(() => fieldMemberRows)()
      if (table === 'company_contacts') return makeTable(() => contactRows)()
      if (table === 'interventions') return makeTable(() => [])()
      if (table === 'intervention_photos') return makeTable(() => [])()
      return makeTable(() => [])()
    },
  }),
}))

import { getTeamsGlobalPulse } from '@/lib/db/team-pulse'

beforeEach(() => {
  orgIds = ['org-1']
  orphanUsers = []
  teamRows = []
  memberRows = []
  fieldMemberRows = []
  contactRows = []
  listOrphanUsersMock.mockClear()
})

describe('getTeamsGlobalPulse — FIX C (revue ChatGPT/Vincent, 08e355e2)', () => {
  it('user en équipe active → compté en équipe, jamais orphelin', async () => {
    teamRows = [{ id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' }]
    memberRows = [{ user_id: 'u-1', team_id: 't-1', left_at: null }]
    orphanUsers = []

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(1)
    expect(pulse.personsWithoutTeamCount).toBe(0)
  })

  it('contact en équipe active → compté en équipe, jamais orphelin', async () => {
    teamRows = [{ id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' }]
    fieldMemberRows = [{ contact_id: 'c-1', team_id: 't-1', left_at: null }]
    contactRows = [{ id: 'c-1', organization_id: 'org-1', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(1)
    expect(pulse.personsWithoutTeamCount).toBe(0)
  })

  it('contact dont l\'unique membership est dans une équipe INACTIVE → sans équipe', async () => {
    teamRows = [{ id: 't-1', active: false, deleted_at: null, organization_id: 'org-1' }]
    fieldMemberRows = [{ contact_id: 'c-1', team_id: 't-1', left_at: null }]
    contactRows = [{ id: 'c-1', organization_id: 'org-1', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(0)
    expect(pulse.personsWithoutTeamCount).toBe(1)
  })

  it('contact dont l\'unique équipe est SUPPRIMÉE (deleted_at) → sans équipe, équipe ignorée', async () => {
    // Une équipe supprimée n'apparaît même pas dans teamRows (la requête réelle
    // filtre .is('deleted_at', null)) — le field_member pointe vers une équipe
    // qui n'existe plus côté "vues actives".
    teamRows = []
    fieldMemberRows = [{ contact_id: 'c-1', team_id: 't-deleted', left_at: null }]
    contactRows = [{ id: 'c-1', organization_id: 'org-1', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(0)
    expect(pulse.personsWithoutTeamCount).toBe(1)
  })

  it('contact avec 2 memberships actifs dans 2 équipes actives → compté une seule fois', async () => {
    teamRows = [
      { id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' },
      { id: 't-2', active: true, deleted_at: null, organization_id: 'org-1' },
    ]
    fieldMemberRows = [
      { contact_id: 'c-1', team_id: 't-1', left_at: null },
      { contact_id: 'c-1', team_id: 't-2', left_at: null },
    ]
    contactRows = [{ id: 'c-1', organization_id: 'org-1', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(1)
    expect(pulse.personsWithoutTeamCount).toBe(0)
  })

  it('contact d\'une autre organisation n\'est jamais compté', async () => {
    teamRows = [{ id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' }]
    contactRows = [{ id: 'c-other-org', organization_id: 'org-2', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activePersonsInTeamsCount).toBe(0)
    expect(pulse.personsWithoutTeamCount).toBe(0)
  })

  it('user orphelin (mock listOrphanUsers) + contact orphelin → additionnés, jamais fusionnés', async () => {
    teamRows = [{ id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' }]
    orphanUsers = [{ id: 'u-1', full_name: 'Jean', email: 'jean@test.com', role: 'chef_equipe' }]
    contactRows = [{ id: 'c-1', organization_id: 'org-1', deleted_at: null }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.personsWithoutTeamCount).toBe(2)
    expect(listOrphanUsersMock).toHaveBeenCalledTimes(1)
  })

  it('orgIds vide → fail-closed, tous les compteurs à zéro', async () => {
    orgIds = []
    teamRows = [{ id: 't-1', active: true, deleted_at: null, organization_id: 'org-1' }]

    const pulse = await getTeamsGlobalPulse()

    expect(pulse.activeTeamsCount).toBe(0)
    expect(pulse.activePersonsInTeamsCount).toBe(0)
    expect(pulse.personsWithoutTeamCount).toBe(0)
  })
})
