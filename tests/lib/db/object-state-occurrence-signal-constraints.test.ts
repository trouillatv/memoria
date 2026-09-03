// Test d'INTÉGRATION (vraie Supabase) — H2-B.1, migration 349.
//
// Vérifie les invariants imposés par le schéma (pas encore de code applicatif
// branché — ce lot est strictement "schéma de persistance") :
//   1. contrainte resolved_xor_unresolved (une ligne resolved a un signal et
//      pas d'erreur ; une ligne unresolved a une erreur et pas de signal) ;
//   2. idempotence via UNIQUE (entity_type, entity_id) — un doublon est
//      rejeté, un retry doit passer par UPDATE de la même ligne ;
//   3. trigger de reroutage : si canonical_business_object_member.
//      canonical_business_object_id change, object_state_occurrence_signal
//      suit automatiquement.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { emitNativeActionLifecycleSignal } from '@/lib/db/object-state-occurrence-signal'
import { loadCboEvolutions } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CanonicalBusinessObjectEntry } from '@/lib/knowledge/canonical-business-object-projection'

const TAG = `__test_h2b1_occurrence_signal_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let cboAId: string
let cboBId: string
const memberEntityId = randomUUID()
let e2eActionId: string | null = null

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

  const { data: cboA, error: aErr } = await db
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: 'site_reserve', label: `${TAG} CBO A` })
    .select('id').single()
  if (aErr) throw aErr
  cboAId = (cboA as { id: string }).id

  const { data: cboB, error: bErr } = await db
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: 'site_reserve', label: `${TAG} CBO B` })
    .select('id').single()
  if (bErr) throw bErr
  cboBId = (cboB as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('object_state_occurrence_signal').delete().eq('site_id', siteId)
  await db.from('canonical_business_object_member').delete().eq('member_entity_id', memberEntityId)
  if (e2eActionId) await db.from('canonical_business_object_member').delete().eq('member_entity_id', e2eActionId)
  if (siteId) await db.from('site_actions').delete().eq('site_id', siteId)
  if (siteId) await db.from('canonical_business_object').delete().eq('site_id', siteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('object_state_occurrence_signal — contraintes (migration 349)', () => {
  it('rejette une ligne resolved sans final_signal', async () => {
    const db = createAdminClient()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: randomUUID(),
      site_id: siteId,
      status: 'resolved',
      source: 'llm',
      // final_signal manquant
    })
    expect(error).not.toBeNull()
  })

  it('rejette une ligne resolved avec error_code renseigné', async () => {
    const db = createAdminClient()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: randomUUID(),
      site_id: siteId,
      status: 'resolved',
      source: 'llm',
      final_signal: 'OPENED',
      error_code: 'TIMEOUT',
    })
    expect(error).not.toBeNull()
  })

  it('rejette une ligne unresolved sans error_code', async () => {
    const db = createAdminClient()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: randomUUID(),
      site_id: siteId,
      status: 'unresolved',
      source: 'llm',
      // error_code manquant
    })
    expect(error).not.toBeNull()
  })

  it('rejette une ligne unresolved avec final_signal renseigné', async () => {
    const db = createAdminClient()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: randomUUID(),
      site_id: siteId,
      status: 'unresolved',
      source: 'llm',
      final_signal: 'NO_STATE_SIGNAL',
      error_code: 'TIMEOUT',
    })
    expect(error).not.toBeNull()
  })

  it('accepte une ligne resolved + NO_STATE_SIGNAL (conclusion sémantique valide, pas un défaut de panne)', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: entityId,
      site_id: siteId,
      status: 'resolved',
      source: 'llm',
      final_signal: 'NO_STATE_SIGNAL',
    })
    expect(error).toBeNull()
    await db.from('object_state_occurrence_signal').delete().eq('entity_id', entityId)
  })

  it('accepte une ligne unresolved diagnostiquée (error_code + error_detail + attempt_count)', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_action',
      entity_id: entityId,
      site_id: siteId,
      status: 'unresolved',
      source: 'llm',
      error_code: 'RATE_LIMIT',
      error_detail: 'HTTP 429 après 3 tentatives',
      attempt_count: 3,
    })
    expect(error).toBeNull()
    await db.from('object_state_occurrence_signal').delete().eq('entity_id', entityId)
  })

  it('idempotence : un doublon (entity_type, entity_id) est rejeté, un retry passe par UPDATE de la même ligne', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()

    const first = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_deadline',
      entity_id: entityId,
      site_id: siteId,
      status: 'unresolved',
      source: 'llm',
      error_code: 'NETWORK_ERROR',
      attempt_count: 1,
    }).select('id').single()
    expect(first.error).toBeNull()

    // Doublon direct — doit être rejeté par la contrainte UNIQUE.
    const duplicate = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_deadline',
      entity_id: entityId,
      site_id: siteId,
      status: 'unresolved',
      source: 'llm',
      error_code: 'TIMEOUT',
      attempt_count: 1,
    })
    expect(duplicate.error).not.toBeNull()

    // Retry légitime : UPDATE de la ligne existante, jamais une insertion.
    const retry = await db.from('object_state_occurrence_signal')
      .update({ error_code: 'TIMEOUT', attempt_count: 2, last_attempt_at: new Date().toISOString() })
      .eq('id', (first.data as { id: string }).id)
      .select('attempt_count, error_code, updated_at')
      .single()
    expect(retry.error).toBeNull()
    expect(retry.data?.attempt_count).toBe(2)
    expect(retry.data?.error_code).toBe('TIMEOUT')

    await db.from('object_state_occurrence_signal').delete().eq('entity_id', entityId)
  })

  // ── P1-4A — provenance native_action_event (migration 379) contre le CONTRAT SQL RÉEL ──
  // Ces tests prouvent ce que le mock unitaire ne pouvait pas : la contrainte CHECK de la DB
  // accepte désormais le canal natif (bug silencieux corrigé), et le best-effort n'avale plus
  // une violation. Bout-en-bout : emit → object_state_occurrence_signal → loadCboEvolutions.

  it('accepte source=native_action_event + COMPLETED (migration 379)', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_action', entity_id: entityId, site_id: siteId,
      status: 'resolved', source: 'native_action_event', final_signal: 'COMPLETED',
    })
    expect(error).toBeNull()
    await db.from('object_state_occurrence_signal').delete().eq('entity_id', entityId)
  })

  it('accepte source=native_action_event + REOPENED', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_action', entity_id: entityId, site_id: siteId,
      status: 'resolved', source: 'native_action_event', final_signal: 'REOPENED',
    })
    expect(error).toBeNull()
    await db.from('object_state_occurrence_signal').delete().eq('entity_id', entityId)
  })

  it('rejette toujours une source inconnue (le CHECK reste un garde-fou)', async () => {
    const db = createAdminClient()
    const { error } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_action', entity_id: randomUUID(), site_id: siteId,
      status: 'resolved', source: 'valeur_inconnue', final_signal: 'COMPLETED',
    })
    expect(error).not.toBeNull()
  })

  it('bout-en-bout : Terminer natif → signal COMPLETED/native → loadCboEvolutions=DONE ; Rouvrir → REOPENED', async () => {
    const db = createAdminClient()
    const { data: cbo } = await db.from('canonical_business_object')
      .insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO action` })
      .select('id').single()
    const cboId = (cbo as { id: string }).id
    const { data: act } = await db.from('site_actions')
      .insert({ site_id: siteId, title: `${TAG} action`, status: 'open' })
      .select('id').single()
    const actionId = (act as { id: string }).id
    e2eActionId = actionId
    await db.from('canonical_business_object_member').insert({
      canonical_business_object_id: cboId, member_entity_type: 'site_action',
      member_entity_id: actionId, resolution_source: 'manual',
    })

    const entry = {
      key: cboId, entityType: 'site_action', label: 'x', isGrouped: true,
      members: [{ entityType: 'site_action', entityId: actionId, status: 'done', title: 'x' }],
      status: 'done', statusIsDivergent: false,
    } as unknown as CanonicalBusinessObjectEntry

    // Terminer explicitement → le signal natif DOIT être accepté par la DB (plus de violation avalée)
    const outC = await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: actionId, event: 'completed' })
    expect(outC).toMatchObject({ kind: 'emitted', finalSignal: 'COMPLETED' })
    const rowC = await db.from('object_state_occurrence_signal').select('source, final_signal').eq('entity_id', actionId).single()
    expect(rowC.data).toMatchObject({ source: 'native_action_event', final_signal: 'COMPLETED' })
    expect((await loadCboEvolutions([entry])).get(cboId)?.computedState).toBe('DONE')

    // Rouvrir explicitement → REOPENED
    const outR = await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: actionId, event: 'reopened' })
    expect(outR).toMatchObject({ kind: 'emitted', finalSignal: 'REOPENED' })
    expect((await loadCboEvolutions([entry])).get(cboId)?.computedState).toBe('REOPENED')
  })

  it('trigger de reroutage : un changement de membership CBO resynchronise canonical_business_object_id', async () => {
    const db = createAdminClient()

    const { error: memErr } = await db.from('canonical_business_object_member').insert({
      canonical_business_object_id: cboAId,
      member_entity_type: 'site_reserve',
      member_entity_id: memberEntityId,
      resolution_source: 'manual',
    })
    expect(memErr).toBeNull()

    const { error: sigErr } = await db.from('object_state_occurrence_signal').insert({
      entity_type: 'site_reserve',
      entity_id: memberEntityId,
      site_id: siteId,
      canonical_business_object_id: cboAId,
      status: 'resolved',
      source: 'llm',
      final_signal: 'OPENED',
    })
    expect(sigErr).toBeNull()

    // Reroutage manuel du membership A → B (même mécanique que
    // scripts/p1c2b4d-phase-b-execute.ts lors d'une consolidation de CBO).
    const { error: rerouteErr } = await db.from('canonical_business_object_member')
      .update({ canonical_business_object_id: cboBId })
      .eq('member_entity_id', memberEntityId)
    expect(rerouteErr).toBeNull()

    const after = await db.from('object_state_occurrence_signal')
      .select('canonical_business_object_id')
      .eq('entity_id', memberEntityId)
      .single()
    expect(after.data?.canonical_business_object_id).toBe(cboBId)
  })
})
