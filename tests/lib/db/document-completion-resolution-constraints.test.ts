// Test d'INTÉGRATION (vraie Supabase) — P1-4B1, migration 380.
//
// Leçon P1-4A : un contrat SQL (CHECK/FK/UNIQUE) doit être prouvé contre la VRAIE base, pas
// seulement contre des mocks. Ce fichier vérifie : décisions/confiances/verdicts fermés,
// cohérence selected_only_if_match, FK, idempotence (proof, policy, fingerprint), candidats liés,
// nouvelle policy autorisée, et la dérivation de la décision effective (empreinte de contexte).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { persistCompletionResolution, getEffectiveResolution, computeContextFingerprint } from '@/lib/db/document-completion-resolution'

const TAG = `__test_p14b1_completion_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let subjectId: string
let proofId: string
let cboAId: string
let cboBId: string

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id
  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  subjectId = (await db.from('canonical_subject').insert({ site_id: siteId, label: `${TAG} sujet` }).select('id').single()).data!.id as string
  proofId = (await db.from('canonical_subject_occurrence').insert({
    canonical_subject_id: subjectId, site_id: siteId, source_kind: 'historical_pdf',
    source_ref_id: randomUUID(), label: `${TAG} preuve réalisée`, effective_date: '2026-05-23',
    state_status: 'resolved', state_key: 'knowledge_fact',
  }).select('id').single()).data!.id as string
  cboAId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO A` }).select('id').single()).data!.id as string
  cboBId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO B` }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('document_completion_resolution').delete().eq('site_id', siteId) // cascade candidats
  await db.from('canonical_subject_occurrence').delete().eq('site_id', siteId)
  await db.from('canonical_business_object').delete().eq('site_id', siteId)
  await db.from('canonical_subject').delete().eq('site_id', siteId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('document_completion_resolution — contraintes + idempotence (migration 380)', () => {
  it('persiste une résolution MATCH + candidats, puis retry = no-op (idempotent)', async () => {
    const input = {
      siteId, proofOccurrenceId: proofId,
      candidates: [
        { canonicalBusinessObjectId: cboAId, verdict: 'accomplished' as const, intentMatch: 'exact' as const, reason: 'même acte+objet' },
        { canonicalBusinessObjectId: cboBId, verdict: 'not_accomplished' as const, intentMatch: 'different' as const, reason: 'autre intention' },
      ],
      decision: 'MATCH' as const, confidenceClass: 'HIGH' as const, selectedCboId: cboAId, reasoning: 'preuve exacte',
    }
    const first = await persistCompletionResolution(input)
    expect(first.kind).toBe('created')
    const retry = await persistCompletionResolution(input)
    expect(retry.kind).toBe('already_exists')
    expect(retry.resolutionId).toBe(first.resolutionId)

    const db = createAdminClient()
    const res = await db.from('document_completion_resolution').select('id').eq('proof_occurrence_id', proofId).eq('policy_version', 'p1.4b.v2')
    expect(res.data?.length).toBe(1) // pas de doublon
    const cands = await db.from('document_completion_candidate').select('id, canonical_business_object_id').eq('resolution_id', first.resolutionId)
    expect(cands.data?.length).toBe(2) // candidats liés
  })

  it('décision effective dérivée : même ensemble de candidats (ordre différent) → même résolution', async () => {
    const eff = await getEffectiveResolution(proofId, [cboBId, cboAId]) // ordre inversé
    expect(eff).not.toBeNull()
    expect(eff?.decision).toBe('MATCH')
    expect(eff?.selectedCboId).toBe(cboAId)
    expect(eff?.contextFingerprint).toBe(computeContextFingerprint([cboAId, cboBId]))
  })

  it('décision effective : contexte différent (topologie CBO changée) → null (à re-résoudre)', async () => {
    const eff = await getEffectiveResolution(proofId, [cboAId]) // ensemble de candidats différent
    expect(eff).toBeNull()
  })

  it('nouvelle policy_version → nouvelle résolution conservée (append-only)', async () => {
    const out = await persistCompletionResolution({
      siteId, proofOccurrenceId: proofId,
      candidates: [{ canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact' }, { canonicalBusinessObjectId: cboBId, verdict: 'not_accomplished', intentMatch: 'different' }],
      decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: cboAId, policyVersion: 'p1.4b.v3-test',
    })
    expect(out.kind).toBe('created')
    const db = createAdminClient()
    const all = await db.from('document_completion_resolution').select('policy_version').eq('proof_occurrence_id', proofId)
    expect(new Set((all.data ?? []).map((r) => (r as { policy_version: string }).policy_version)).size).toBeGreaterThanOrEqual(2)
  })

  it('CHECK : decision=MATCH sans selected_cbo_id → rejeté', async () => {
    const db = createAdminClient()
    const { error } = await db.from('document_completion_resolution').insert({
      site_id: siteId, proof_occurrence_id: proofId, policy_version: 'x', context_fingerprint: 'x',
      decision: 'MATCH', confidence_class: 'HIGH', selected_cbo_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('CHECK : decision=NO_MATCH avec selected_cbo_id → rejeté', async () => {
    const db = createAdminClient()
    const { error } = await db.from('document_completion_resolution').insert({
      site_id: siteId, proof_occurrence_id: proofId, policy_version: 'x', context_fingerprint: 'y',
      decision: 'NO_MATCH', confidence_class: 'LOW', selected_cbo_id: cboAId,
    })
    expect(error).not.toBeNull()
  })

  it('CHECK : decision inconnue → rejetée', async () => {
    const db = createAdminClient()
    const { error } = await db.from('document_completion_resolution').insert({
      site_id: siteId, proof_occurrence_id: proofId, policy_version: 'x', context_fingerprint: 'z',
      decision: 'PEUT_ETRE', confidence_class: 'HIGH', selected_cbo_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('CHECK : intent_match inconnu sur un candidat → rejeté', async () => {
    const db = createAdminClient()
    const res = await db.from('document_completion_resolution').insert({
      site_id: siteId, proof_occurrence_id: proofId, policy_version: 'x', context_fingerprint: 'w',
      decision: 'AMBIGUOUS', confidence_class: 'LOW', selected_cbo_id: null,
    }).select('id').single()
    const { error } = await db.from('document_completion_candidate').insert({
      resolution_id: (res.data as { id: string }).id, canonical_business_object_id: cboAId,
      candidate_verdict: 'uncertain', intent_match: 'peut-etre',
    })
    expect(error).not.toBeNull()
  })
})
