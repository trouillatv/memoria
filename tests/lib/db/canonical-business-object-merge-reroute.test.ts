// Test d'INTÉGRATION (vraie Supabase) — P1-C2B.3 Gate 2 hardening.
//
// L'audit Gate 2 a prouvé que merge_canonical_subjects() (311/344/345) ne
// reroutait jamais canonical_business_object.canonical_subject_id lors d'une
// fusion. La migration 348 ajoute ce reroutage. Ce test exerce le vrai RPC
// SQL (pas un mock) sur une chaîne de fusion réelle à 2 sauts A→B→C :
//   - un CBO déjà existant sur A doit se retrouver sur C après les 2 fusions ;
//   - une création de CBO postérieure sur un sujet déjà fusionné doit
//     atterrir directement sur le winner (résolu par makeWinnerResolver,
//     câblé dans createSoloCbo — cf. tests/lib/db/canonical-business-object-attach.test.ts
//     pour la couverture unitaire de cette résolution).
//   - jamais de double-appartenance (contrainte UNIQUE member_entity_type/id).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { mergeCanonicalSubjects } from '@/lib/db/canonical-subject-merge'
import { attachToCanonicalBusinessObject } from '@/lib/db/canonical-business-object-attach'

const TAG = `__test_p1c2b3_merge_reroute_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let csAId: string
let csBId: string
let csCId: string
let reserveExistingId: string // membre d'un CBO créé AVANT la chaîne de fusions
let reserveLateId: string // entité attachée APRÈS la chaîne de fusions
let cboExistingId: string

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

  const { data: csA, error: aErr } = await db
    .from('canonical_subject').insert({ site_id: siteId, label: `${TAG} A` }).select('id').single()
  if (aErr) throw aErr
  csAId = (csA as { id: string }).id

  const { data: csB, error: bErr } = await db
    .from('canonical_subject').insert({ site_id: siteId, label: `${TAG} B` }).select('id').single()
  if (bErr) throw bErr
  csBId = (csB as { id: string }).id

  const { data: csC, error: cErr2 } = await db
    .from('canonical_subject').insert({ site_id: siteId, label: `${TAG} C` }).select('id').single()
  if (cErr2) throw cErr2
  csCId = (csC as { id: string }).id

  // Réserve + CBO existants sur A, AVANT toute fusion.
  const { data: reserve, error: rErr } = await db
    .from('site_reserve')
    .insert({ site_id: siteId, label: `${TAG} réserve existante`, canonical_subject_id: csAId })
    .select('id').single()
  if (rErr) throw rErr
  reserveExistingId = (reserve as { id: string }).id

  const { data: cbo, error: cboErr } = await db
    .from('canonical_business_object')
    .insert({ site_id: siteId, object_type: 'site_reserve', label: `${TAG} CBO existant`, canonical_subject_id: csAId })
    .select('id').single()
  if (cboErr) throw cboErr
  cboExistingId = (cbo as { id: string }).id

  const { error: memErr } = await db.from('canonical_business_object_member').insert({
    canonical_business_object_id: cboExistingId,
    member_entity_type: 'site_reserve',
    member_entity_id: reserveExistingId,
    resolution_source: 'manual',
  })
  if (memErr) throw memErr

  // Réserve attachée APRÈS la chaîne de fusions (créée ici, rattachée dans le test).
  const { data: reserveLate, error: rlErr } = await db
    .from('site_reserve')
    .insert({ site_id: siteId, label: `${TAG} réserve tardive`, canonical_subject_id: csAId })
    .select('id').single()
  if (rlErr) throw rlErr
  reserveLateId = (reserveLate as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  if (reserveExistingId) await db.from('canonical_business_object_member').delete().eq('member_entity_id', reserveExistingId)
  if (reserveLateId) await db.from('canonical_business_object_member').delete().eq('member_entity_id', reserveLateId)
  if (reserveExistingId) await db.from('site_reserve').delete().eq('id', reserveExistingId)
  if (reserveLateId) await db.from('site_reserve').delete().eq('id', reserveLateId)
  // Les CBO créés dans le test (cboExisting + celui créé par le test 2) sont
  // supprimés via leur site_id (CASCADE emporte les membres restants).
  if (siteId) await db.from('canonical_business_object').delete().eq('site_id', siteId)
  if (csAId) await db.from('canonical_subject').delete().eq('id', csAId)
  if (csBId) await db.from('canonical_subject').delete().eq('id', csBId)
  if (csCId) await db.from('canonical_subject').delete().eq('id', csCId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

describe('merge_canonical_subjects() — reroutage canonical_business_object (migration 348)', () => {
  it('chaîne réelle A→B→C : un CBO existant sur A se retrouve sur C après les 2 fusions, sans double-appartenance', async () => {
    const db = createAdminClient()

    const before = await db.from('canonical_business_object').select('canonical_subject_id').eq('id', cboExistingId).single()
    expect(before.data?.canonical_subject_id).toBe(csAId)

    const mergeAB = await mergeCanonicalSubjects(csAId, csBId)
    expect(mergeAB.ok).toBe(true)
    if (mergeAB.ok) expect(mergeAB.result.canonicalBusinessObjectsMoved).toBe(1)

    const afterAB = await db.from('canonical_business_object').select('canonical_subject_id').eq('id', cboExistingId).single()
    expect(afterAB.data?.canonical_subject_id).toBe(csBId)

    const mergeBC = await mergeCanonicalSubjects(csBId, csCId)
    expect(mergeBC.ok).toBe(true)
    if (mergeBC.ok) expect(mergeBC.result.canonicalBusinessObjectsMoved).toBe(1)

    const afterBC = await db.from('canonical_business_object').select('canonical_subject_id').eq('id', cboExistingId).single()
    expect(afterBC.data?.canonical_subject_id).toBe(csCId)

    // Aucune double-appartenance : le membre existant reste unique.
    const members = await db.from('canonical_business_object_member').select('id').eq('member_entity_id', reserveExistingId)
    expect(members.data).toHaveLength(1)
  })

  it('après la chaîne A→B→C, une création de CBO sur A (loser) atterrit directement sur C (winner)', async () => {
    // Ce test dépend de l'ordre : la chaîne A→B→C a déjà été exécutée par le
    // test précédent (même describe, même beforeAll) — A et B sont déjà 'merged'.
    const outcome = await attachToCanonicalBusinessObject({
      siteId,
      canonicalSubjectId: csAId, // loser — le sujet a fusionné entre-temps
      entityType: 'site_reserve',
      entityId: reserveLateId,
      label: `${TAG} réserve tardive`,
      date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind !== 'created_new') return

    const db = createAdminClient()
    const cbo = await db.from('canonical_business_object').select('canonical_subject_id').eq('id', outcome.canonicalBusinessObjectId).single()
    expect(cbo.data?.canonical_subject_id).toBe(csCId)

    const members = await db.from('canonical_business_object_member').select('id').eq('member_entity_id', reserveLateId)
    expect(members.data).toHaveLength(1)
  })
})
