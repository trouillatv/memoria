import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX 5 (revue ChatGPT/Vincent, cd30aa2d) — un référent non-null DOIT être membre
// ACTIF de l'équipe (team_members, left_at IS NULL) ; retirer un membre qui est
// le référent courant ne doit JAMAIS laisser teams.referent_user_id orphelin.
//
// Unit-testé avec un client Supabase en mémoire (pas de vraie base) : les tests
// réels équivalents existent dans tests/lib/teams.test.ts (style intégration),
// mais ce fichier-ci reste exécutable indépendamment de l'infrastructure de
// fixture `createContract`/`requireOrganizationMembership` (cf. rapport HARD
// STOP — cette dernière exige une session HTTP réelle via `cookies()` et ne
// peut pas tourner hors d'une requête Next.js, un problème préexistant et hors
// périmètre de FIX 5).

vi.mock('server-only', () => ({}))

let membersState: Record<string, boolean> = {}
let teamsState: Record<string, { referent_user_id: string | null }> = {}

function teamMembersChain() {
  let mode: 'select' | 'update' | null = null
  const filters: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {
    select() {
      mode = 'select'
      return chain
    },
    update() {
      mode = 'update'
      return chain
    },
    eq(col: string, val: unknown) {
      filters[col] = val
      return chain
    },
    is(col: string, val: unknown) {
      filters[col] = val
      return chain
    },
    maybeSingle() {
      const key = `${filters.team_id}:${filters.user_id}`
      const active = membersState[key] === true
      return Promise.resolve({ data: active ? { id: `tm-${key}` } : null, error: null })
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      if (mode === 'update') {
        const key = `${filters.team_id}:${filters.user_id}`
        membersState[key] = false
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    },
  }
  return chain
}

function teamsChain() {
  let mode: 'select' | 'update' | null = null
  const filters: Record<string, unknown> = {}
  let payload: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {
    select() {
      mode = 'select'
      return chain
    },
    update(p: Record<string, unknown>) {
      mode = 'update'
      payload = p
      return chain
    },
    eq(col: string, val: unknown) {
      filters[col] = val
      return chain
    },
    maybeSingle() {
      const row = teamsState[filters.id as string]
      return Promise.resolve({ data: row ?? null, error: null })
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      if (mode === 'update') {
        const id = filters.id as string
        const row = teamsState[id] ?? { referent_user_id: null }
        teamsState[id] = { ...row, ...payload }
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    },
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'team_members') return teamMembersChain()
      if (table === 'teams') return teamsChain()
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { setTeamReferent, removeMemberFromTeam } from '@/lib/db/teams'

beforeEach(() => {
  membersState = {}
  teamsState = {}
})

describe('FIX 5 — setTeamReferent : référent = membre actif obligatoire', () => {
  it('membre actif → OK, referent_user_id mis à jour', async () => {
    membersState['t-1:u-1'] = true
    teamsState['t-1'] = { referent_user_id: null }

    await setTeamReferent({ teamId: 't-1', userId: 'u-1' })

    expect(teamsState['t-1'].referent_user_id).toBe('u-1')
  })

  it('utilisateur hors équipe (aucun membership) → refusé', async () => {
    teamsState['t-1'] = { referent_user_id: null }

    await expect(setTeamReferent({ teamId: 't-1', userId: 'u-2' })).rejects.toThrow()
    expect(teamsState['t-1'].referent_user_id).toBeNull()
  })

  it('ancien membre (left_at NOT NULL) → refusé', async () => {
    membersState['t-1:u-1'] = false
    teamsState['t-1'] = { referent_user_id: null }

    await expect(setTeamReferent({ teamId: 't-1', userId: 'u-1' })).rejects.toThrow()
    expect(teamsState['t-1'].referent_user_id).toBeNull()
  })

  it('userId=null → retrait accepté sans vérification de membership', async () => {
    teamsState['t-1'] = { referent_user_id: 'u-1' }

    await setTeamReferent({ teamId: 't-1', userId: null })

    expect(teamsState['t-1'].referent_user_id).toBeNull()
  })
})

describe('FIX 5 — removeMemberFromTeam : jamais de referent_user_id orphelin', () => {
  it('retirer le référent efface referent_user_id (jamais orphelin)', async () => {
    membersState['t-1:u-1'] = true
    teamsState['t-1'] = { referent_user_id: 'u-1' }

    await removeMemberFromTeam('t-1', 'u-1')

    expect(teamsState['t-1'].referent_user_id).toBeNull()
  })

  it('retirer un membre qui n\'est PAS le référent laisse referent_user_id intact', async () => {
    membersState['t-1:u-1'] = true
    teamsState['t-1'] = { referent_user_id: 'u-2' }

    await removeMemberFromTeam('t-1', 'u-1')

    expect(teamsState['t-1'].referent_user_id).toBe('u-2')
  })
})
