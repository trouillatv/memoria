import { describe, it, expect, vi, beforeEach } from 'vitest'

// /EQUIPES V2 (Batch E) — invariant Vincent « unauthored-photo-never-attributed ».
// listTeamRecentPhotos (lib/db/team-profile.ts) résout l'auteur d'une photo
// STRICTEMENT via la colonne `taken_by` — jamais déduit (ex. du chef d'équipe,
// du créateur de l'intervention, ou du premier membre listé). Une photo sans
// `taken_by` doit rester "Auteur non renseigné" (authorName: null) au lieu
// d'inventer un responsable.

vi.mock('server-only', () => ({}))

let interventionRows: Array<Record<string, unknown>> = []
let photoRows: Array<Record<string, unknown>> = []
let userRows: Array<Record<string, unknown>> = []
const usersInCalls: string[][] = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }, onIn?: (col: string, vals: unknown[]) => void) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order', 'limit', 'is']) b[m] = self
  b.in = (col: string, vals: unknown[]) => {
    onIn?.(col, vals)
    return self()
  }
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'interventions') return makeBuilder(() => ({ data: interventionRows, error: null }))
      if (table === 'intervention_photos') return makeBuilder(() => ({ data: photoRows, error: null }))
      if (table === 'users') {
        return makeBuilder(
          () => ({ data: userRows, error: null }),
          (col, vals) => { if (col === 'id') usersInCalls.push(vals as string[]) },
        )
      }
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

vi.mock('@/lib/storage/intervention-photos', () => ({
  getSignedPhotoUrlsThumb: async (paths: string[]) => new Map(paths.map((p) => [p, `signed://${p}`])),
}))

vi.mock('@/lib/db/teams', () => ({
  getTeamDependencies: async () => ({ futureInterventions: 0, rotationSlots: 0, rotationCycleCount: 0, rotationSiteNames: [] }),
}))

import { listTeamRecentPhotos } from '@/lib/db/team-profile'

function interventionRow(id: string) {
  return {
    id,
    scheduled_for: '2026-09-01T00:00:00Z',
    status: 'completed',
    planned_start: null,
    planned_end: null,
    mission: { name: 'Nettoyage', site: { id: 's-1', name: 'Site Test', contract: null, client: null } },
  }
}

beforeEach(() => {
  interventionRows = [interventionRow('i-1')]
  photoRows = []
  userRows = []
  usersInCalls.length = 0
})

describe('listTeamRecentPhotos — auteur RÉEL uniquement (taken_by), jamais déduit', () => {
  it('taken_by absent → authorName null, AUCUNE requête users n’est déclenchée pour cette photo', async () => {
    photoRows = [
      { id: 'p-1', caption: null, taken_at: '2026-09-01T10:00:00Z', intervention_id: 'i-1', storage_path: 'a.jpg', taken_by: null },
    ]
    const out = await listTeamRecentPhotos('t-1')
    expect(out).toHaveLength(1)
    expect(out[0].authorName).toBeNull()
    // Aucun id à résoudre → authorIds vide → pas d'appel .in('id', ...) sur users.
    expect(usersInCalls).toHaveLength(0)
  })

  it('taken_by renseigné et résolu → nom réel affiché', async () => {
    photoRows = [
      { id: 'p-1', caption: null, taken_at: '2026-09-01T10:00:00Z', intervention_id: 'i-1', storage_path: 'a.jpg', taken_by: 'u-1' },
    ]
    userRows = [{ id: 'u-1', full_name: 'Marie Curie', email: 'marie@ex.fr' }]
    const out = await listTeamRecentPhotos('t-1')
    expect(out[0].authorName).toBe('Marie Curie')
    expect(usersInCalls).toEqual([['u-1']])
  })

  it('taken_by pointe vers un user introuvable → authorName null, JAMAIS un nom inventé', async () => {
    photoRows = [
      { id: 'p-1', caption: null, taken_at: '2026-09-01T10:00:00Z', intervention_id: 'i-1', storage_path: 'a.jpg', taken_by: 'u-orphan' },
    ]
    userRows = [] // le user n'existe plus / n'est pas retourné
    const out = await listTeamRecentPhotos('t-1')
    expect(out[0].authorName).toBeNull()
  })

  it('mélange de photos avec et sans auteur — jamais de propagation d’un auteur vers l’autre photo', async () => {
    photoRows = [
      { id: 'p-1', caption: null, taken_at: '2026-09-02T00:00:00Z', intervention_id: 'i-1', storage_path: 'a.jpg', taken_by: 'u-1' },
      { id: 'p-2', caption: null, taken_at: '2026-09-01T00:00:00Z', intervention_id: 'i-1', storage_path: 'b.jpg', taken_by: null },
    ]
    userRows = [{ id: 'u-1', full_name: 'Marie Curie', email: 'marie@ex.fr' }]
    const out = await listTeamRecentPhotos('t-1')
    const byId = new Map(out.map((p) => [p.id, p]))
    expect(byId.get('p-1')?.authorName).toBe('Marie Curie')
    expect(byId.get('p-2')?.authorName).toBeNull()
  })
})
