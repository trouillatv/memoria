// Test d'INTÉGRATION (vraie Supabase) — Phase 6D.0, migration 390.
//
// GO Vincent après clôture 6C.1 : « Aucun build global encore. » Ce lot est
// strictement schéma + tests d'isolation — zéro écrivain applicatif câblé
// (le premier écrivain réel est 6D.1, sur GO séparé).
//
// Vérifie :
//   1. les contraintes CHECK du workflow pending → resolved|dismissed
//      (resolved_consistency, target_consistency) ;
//   2. l'idempotence via l'index unique partiel (COALESCE sur
//      source_proposal_id NULL) ;
//   3. l'isolation structurelle : tracked_point_pending_trace n'est lue par
//      AUCUN code de lecture du Point — loadTrackedPointReadModel produit un
//      résultat rigoureusement identique avant/après insertion de traces
//      pending, quel que soit leur kind, et reste identique même après leur
//      résolution vers un target_point_id (seul un vrai tracked_point_member
//      HARD peut faire évoluer la projection, cf. migration 388/389).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'

const TAG = `__test_6d0_pending_trace_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let pointId: string

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

  const { data: point, error: pErr } = await db
    .from('tracked_point')
    .insert({ site_id: siteId, label: `${TAG} Point`, founding_kind: 'manual', seed_source: 'manual' })
    .select('id').single()
  if (pErr) throw pErr
  pointId = (point as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('tracked_point_pending_trace').delete().eq('site_id', siteId)
  await db.from('tracked_point_member').delete().eq('tracked_point_id', pointId)
  await db.from('tracked_point').delete().eq('site_id', siteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('tracked_point_pending_trace — contraintes (migration 390)', () => {
  it('accepte une ligne pending sans resolved_at ni target_point_id', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED',
      reason: 'observation indéterminée',
    })
    expect(error).toBeNull()
    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('rejette une ligne resolved sans resolved_at', async () => {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: randomUUID(), kind: 'TRACKABILITY_UNDETERMINED',
      reason: 'x', status: 'resolved', target_point_id: pointId,
    })
    expect(error).not.toBeNull()
  })

  it('rejette une ligne dismissed sans resolved_at', async () => {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: randomUUID(), kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: 'x', status: 'dismissed',
    })
    expect(error).not.toBeNull()
  })

  it('rejette target_point_id posé alors que status=pending', async () => {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: randomUUID(), kind: 'TRACKABILITY_UNDETERMINED',
      reason: 'x', status: 'pending', target_point_id: pointId,
    })
    expect(error).not.toBeNull()
  })

  it('rejette target_point_id posé sur un dismissed (une décision humaine « jamais » n\'a pas de cible)', async () => {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: randomUUID(), kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: 'x', status: 'dismissed', resolved_at: new Date().toISOString(), target_point_id: pointId,
    })
    expect(error).not.toBeNull()
  })

  it('accepte resolved + resolved_at + target_point_id ensemble', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: 'résolue vers un Point identifié', status: 'resolved',
      resolved_at: new Date().toISOString(), target_point_id: pointId,
    })
    expect(error).toBeNull()
    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('accepte dismissed + resolved_at sans target_point_id', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED',
      reason: 'jugée non pertinente', status: 'dismissed', resolved_at: new Date().toISOString(),
    })
    expect(error).toBeNull()
    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('rejette un kind hors du vocabulaire fermé', async () => {
    const db = createAdminClient()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: randomUUID(), kind: 'AUTRE_CHOSE', reason: 'x',
    })
    expect(error).not.toBeNull()
  })

  it('idempotence : deux pending (même thread, même kind, source_proposal_id NULL) — le doublon est rejeté', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const first = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED', reason: 'première',
    })
    expect(first.error).toBeNull()

    const duplicate = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED', reason: 'rejeu',
    })
    expect(duplicate.error).not.toBeNull()

    // Un kind différent sur le même thread n'est PAS un doublon.
    const otherKind = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM', reason: 'autre kind',
    })
    expect(otherKind.error).toBeNull()

    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('idempotence : une fois résolue, un nouveau pending sur la même clé redevient possible (index partiel WHERE status=pending)', async () => {
    const db = createAdminClient()
    const threadId = randomUUID()
    const first = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED', reason: 'première',
    }).select('id').single()
    expect(first.error).toBeNull()

    const resolve = await db.from('tracked_point_pending_trace')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('id', (first.data as { id: string }).id)
    expect(resolve.error).toBeNull()

    const second = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED', reason: 'rejeu après résolution',
    })
    expect(second.error).toBeNull()

    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })
})

describe('tracked_point_pending_trace — isolation vis-à-vis du read-model du Point (6D.0)', () => {
  it('PENDING_TRACKABILITY : insérer une trace pending ne change jamais loadTrackedPointReadModel', async () => {
    const db = createAdminClient()
    const before = await loadTrackedPointReadModel(siteId)

    const threadId = randomUUID()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'TRACKABILITY_UNDETERMINED',
      reason: 'observation indéterminée, sans Point',
    })
    expect(error).toBeNull()

    const after = await loadTrackedPointReadModel(siteId)
    expect(after).toEqual(before)

    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM orpheline : idem, aucun effet sur le read-model', async () => {
    const db = createAdminClient()
    const before = await loadTrackedPointReadModel(siteId)

    const threadId = randomUUID()
    const { error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: 'résolution documentaire sans problème connu associé',
    })
    expect(error).toBeNull()

    const after = await loadTrackedPointReadModel(siteId)
    expect(after).toEqual(before)

    await db.from('tracked_point_pending_trace').delete().eq('source_thread_id', threadId)
  })

  it('résolution vers target_point_id seule (sans membership HARD) : toujours aucun effet — target_point_id est un pointeur d\'audit, pas une adhésion', async () => {
    const db = createAdminClient()
    const before = await loadTrackedPointReadModel(siteId)

    const threadId = randomUUID()
    const { data, error } = await db.from('tracked_point_pending_trace').insert({
      site_id: siteId, source_thread_id: threadId, kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM',
      reason: 'rapprochée manuellement du Point existant', status: 'resolved',
      resolved_at: new Date().toISOString(), target_point_id: pointId,
    }).select('id').single()
    expect(error).toBeNull()

    const afterResolved = await loadTrackedPointReadModel(siteId)
    expect(afterResolved).toEqual(before)

    // Seul le mécanisme EXISTANT (tracked_point_member HARD, mig 388) fait évoluer la
    // projection — jamais la résolution de pending_trace elle-même.
    const { error: memberErr } = await db.from('tracked_point_member').insert({
      tracked_point_id: pointId, subject_thread_id: threadId, scope: 'thread',
      resolution_source: 'manual',
    })
    expect(memberErr).toBeNull()

    const afterMembership = await loadTrackedPointReadModel(siteId)
    expect(afterMembership).not.toEqual(before)
    const point = afterMembership.points.find((p) => p.id === pointId)
    expect(point?.hardMemberThreadIds).toContain(threadId)

    await db.from('tracked_point_member').delete().eq('tracked_point_id', pointId).eq('subject_thread_id', threadId)
    await db.from('tracked_point_pending_trace').delete().eq('id', (data as { id: string }).id)
  })
})
