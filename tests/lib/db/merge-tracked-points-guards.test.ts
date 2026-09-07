// Test d'INTÉGRATION (vraie Supabase) — Phase 6E.1C, migration 392.
//
// GO Vincent : « productisation safe » de merge_tracked_points/reject_point_identity_pair.
// HARD STOP avant toute deuxième fusion RÉELLE (données de production) — les fusions
// exécutées ici portent exclusivement sur des tracked_point synthétiques tagués, créés et
// détruits par ce fichier (même doctrine que tests/lib/db/tracked-point-pending-trace-
// constraints.test.ts, migration 390).
//
// Couvre la checklist Vincent (cf. en-tête de 392_merge_tracked_points_hardening.sql) :
// source=target, cross-site (cross-org couvert structurellement, cf. commentaire migration),
// source/target retired, source/target CONFLICTED, "cycle" (déjà merged), candidate_ids vide,
// candidate absente, déjà résolue, ne ciblant ni source ni target, d'un autre site, et le
// NOUVEAU guard 7bis (candidate ne correspondant pas réellement à la paire) — puis un chemin
// de succès et reject_point_identity_pair (introuvable, déjà résolue, site_id divergent entre
// lignes de la même paire, atomicité tout-ou-rien).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'

const TAG = `__test_6e1c_merge_guards_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let siteId2: string

async function makePoint(overrides: Record<string, unknown> = {}) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point')
    .insert({
      site_id: siteId,
      label: `${TAG} point`,
      founding_kind: 'manual',
      seed_source: 'manual',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeCandidate(overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_identity_candidate')
    .insert({
      site_id: siteId,
      subject_thread_id: randomUUID(),
      reason: 'test',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: client, error: cErr } = await db
    .from('clients')
    .insert({ name: `${TAG}client`, organization_id: orgId })
    .select('id').single()
  if (cErr) throw cErr
  clientId = (client as { id: string }).id

  const { data: site, error: sErr } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr) throw sErr
  siteId = (site as { id: string }).id

  const { data: site2, error: sErr2 } = await db
    .from('sites')
    .insert({ name: `${TAG}site2`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr2) throw sErr2
  siteId2 = (site2 as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('tracked_point_identity_candidate').delete().eq('site_id', siteId)
  await db.from('tracked_point_identity_candidate').delete().eq('site_id', siteId2)
  // tracked_point_member n'a pas de site_id : nettoyage via tracked_point_id après coup.
  const { data: pts } = await db.from('tracked_point').select('id').eq('site_id', siteId)
  const ptIds = ((pts ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (ptIds.length > 0) {
    await db.from('tracked_point_member').delete().in('tracked_point_id', ptIds)
  }
  // merged_into_id est FK RESTRICT : détacher les sources avant de supprimer les cibles.
  await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('site_id', siteId)
  await db.from('tracked_point').delete().eq('site_id', siteId)
  await db.from('tracked_point').delete().eq('site_id', siteId2)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('sites').delete().eq('id', siteId2)
  await db.from('clients').delete().eq('id', clientId)
})

describe('merge_tracked_points — guards (migration 392)', () => {
  it('refuse source = target', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: a, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/source = target/)
  })

  it('refuse candidate_ids vide', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/p_candidate_ids vide/)
  })

  it('refuse une fusion cross-site', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const { data: c, error: cErr } = await db
      .from('tracked_point')
      .insert({ site_id: siteId2, label: `${TAG} cross-site`, founding_kind: 'manual', seed_source: 'manual' })
      .select('id').single()
    if (cErr) throw cErr
    const b = (c as { id: string }).id
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/inter-chantier interdite/)
    await db.from('tracked_point').delete().eq('id', b)
  })

  it('refuse source retired', async () => {
    const db = createAdminClient()
    const a = await makePoint({ status: 'retired' })
    const b = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/source .* status=retired/)
  })

  it('refuse target retired', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint({ status: 'retired' })
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/target .* status=retired/)
  })

  it('refuse source CONFLICTED', async () => {
    const db = createAdminClient()
    const a = await makePoint({ identity_status: 'CONFLICTED' })
    const b = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/CONFLICTED/)
  })

  it('refuse target CONFLICTED', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint({ identity_status: 'CONFLICTED' })
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/CONFLICTED/)
  })

  it('refuse un "cycle" : source déjà merged_into_id vers un tiers (statut ≠ active)', async () => {
    const db = createAdminClient()
    const third = await makePoint()
    const a = await makePoint({ status: 'merged', merged_into_id: third })
    const b = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/source .* status=merged/)
    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', a)
  })

  it('refuse une candidate déjà résolue (status ≠ pending)', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const cand = await makeCandidate({
      candidate_point_id: a, status: 'accepted', resolved_at: new Date().toISOString(),
    })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/attendu pending/)
  })

  it('refuse une candidate dont candidate_point_id ne cible ni source ni target', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const other = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: other })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ne cible ni source ni target/)
  })

  it('refuse une candidate d\'un autre site', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a, site_id: siteId2 })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/site_id.*différent du site de fusion/)
  })

  it('7bis NOUVEAU (392) : refuse une candidate dont le thread n\'est rattaché à l\'autre extrémité par aucun mécanisme reconnu', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint() // aucune fondation ni membership ne relie un thread à b
    const cand = await makeCandidate({ candidate_point_id: a, subject_thread_id: randomUUID() })
    const { error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ne correspond pas à la paire/)
  })

  it('7bis : accepte une candidate dont le thread est le founding_reference (trackable_condition) de l\'autre extrémité', async () => {
    const db = createAdminClient()
    const threadX = randomUUID()
    const a = await makePoint()
    const b = await makePoint({ founding_kind: 'trackable_condition', founding_reference: threadX })
    const cand = await makeCandidate({ candidate_point_id: a, subject_thread_id: threadX })

    const { data, error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).toBeNull()
    const result = data as { source: string; target: string; candidatesAccepted: number }
    expect(result.source).toBe(a)
    expect(result.target).toBe(b)
    expect(result.candidatesAccepted).toBe(1)

    const { data: aAfter } = await db.from('tracked_point').select('status, merged_into_id').eq('id', a).single()
    expect((aAfter as { status: string; merged_into_id: string }).status).toBe('merged')
    expect((aAfter as { status: string; merged_into_id: string }).merged_into_id).toBe(b)

    const { data: candAfter } = await db.from('tracked_point_identity_candidate').select('status').eq('id', cand).single()
    expect((candAfter as { status: string }).status).toBe('accepted')

    // Rejeu : source n'est plus active → refusé, aucune double-écriture.
    const replay = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(replay.error).not.toBeNull()
    expect(replay.error!.message).toMatch(/status=merged/)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', a)
  })

  it('7bis : accepte une candidate dont le thread est un membership HARD actif de l\'autre extrémité', async () => {
    const db = createAdminClient()
    const threadY = randomUUID()
    const a = await makePoint()
    const b = await makePoint()
    await db.from('tracked_point_member').insert({
      tracked_point_id: b, subject_thread_id: threadY, scope: 'thread', resolution_source: 'manual',
    })
    const cand = await makeCandidate({ candidate_point_id: a, subject_thread_id: threadY })

    const { data, error } = await db.rpc('merge_tracked_points', { p_source_id: a, p_target_id: b, p_candidate_ids: [cand] })
    expect(error).toBeNull()
    const result = data as { candidatesAccepted: number }
    expect(result.candidatesAccepted).toBe(1)

    await db.from('tracked_point').update({ status: 'active', merged_into_id: null }).eq('id', a)
    await db.from('tracked_point_member').delete().eq('tracked_point_id', b).eq('subject_thread_id', threadY)
  })
})

describe('reject_point_identity_pair — guards (migration 392)', () => {
  it('refuse candidate_ids vide', async () => {
    const db = createAdminClient()
    const { error } = await db.rpc('reject_point_identity_pair', { p_candidate_ids: [], p_resolved_by: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/p_candidate_ids vide/)
  })

  it('refuse une candidate introuvable', async () => {
    const db = createAdminClient()
    const { error } = await db.rpc('reject_point_identity_pair', { p_candidate_ids: [randomUUID()], p_resolved_by: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/introuvable/)
  })

  it('refuse une candidate déjà résolue', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const cand = await makeCandidate({ candidate_point_id: a, status: 'rejected', resolved_at: new Date().toISOString() })
    const { error } = await db.rpc('reject_point_identity_pair', { p_candidate_ids: [cand], p_resolved_by: null })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/attendu pending/)
  })

  it('rejette exactement les deux lignes réciproques d\'une paire, tout-ou-rien', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const b = await makePoint()
    const candAtoB = await makeCandidate({ candidate_point_id: b, subject_thread_id: randomUUID() })
    const candBtoA = await makeCandidate({ candidate_point_id: a, subject_thread_id: randomUUID() })
    // Candidate d'une AUTRE paire dans la même composante — ne doit jamais être touchée.
    const untouched = await makeCandidate({ candidate_point_id: a, subject_thread_id: randomUUID() })

    const { data, error } = await db.rpc('reject_point_identity_pair', {
      p_candidate_ids: [candAtoB, candBtoA], p_resolved_by: null,
    })
    expect(error).toBeNull()
    const result = data as { rejectedCount: number }
    expect(result.rejectedCount).toBe(2)

    const { data: rows } = await db
      .from('tracked_point_identity_candidate')
      .select('id, status')
      .in('id', [candAtoB, candBtoA, untouched])
    const byId = new Map(((rows ?? []) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
    expect(byId.get(candAtoB)).toBe('rejected')
    expect(byId.get(candBtoA)).toBe('rejected')
    expect(byId.get(untouched)).toBe('pending')
  })

  it('atomicité tout-ou-rien : une ligne invalide dans le lot bloque le rejet des lignes valides', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const validCand = await makeCandidate({ candidate_point_id: a })
    const alreadyResolved = await makeCandidate({ candidate_point_id: a, status: 'accepted', resolved_at: new Date().toISOString() })

    const { error } = await db.rpc('reject_point_identity_pair', {
      p_candidate_ids: [validCand, alreadyResolved], p_resolved_by: null,
    })
    expect(error).not.toBeNull()

    const { data: row } = await db.from('tracked_point_identity_candidate').select('status').eq('id', validCand).single()
    expect((row as { status: string }).status).toBe('pending')
  })

  it('refuse un site_id divergent entre les lignes de la paire', async () => {
    const db = createAdminClient()
    const a = await makePoint()
    const candSite1 = await makeCandidate({ candidate_point_id: a, site_id: siteId })
    const candSite2 = await makeCandidate({ candidate_point_id: a, site_id: siteId2 })

    const { error } = await db.rpc('reject_point_identity_pair', {
      p_candidate_ids: [candSite1, candSite2], p_resolved_by: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/différent des autres lignes de la paire/)
  })
})
