// Test d'INTÉGRATION (vraie Supabase) — P1-4B-ATOMICITÉ, migration 382.
//
// Prouve que la persistance résolution+candidats est ATOMIQUE et retry-safe via la RPC
// persist_document_completion_resolution : jamais de parent effectif sans ses candidats, rollback
// intégral en cas d'échec candidat, idempotence, course concurrente sûre, lecture legacy intacte.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { persistCompletionResolution, getEffectiveResolution, computeContextFingerprint } from '@/lib/db/document-completion-resolution'

const TAG = `__test_p14b_atomic_${Math.floor(Date.now() / 1000)}__`

let orgId: string, clientId: string, siteId: string, subjectId: string, proofId: string, cboAId: string, cboBId: string

const countRes = async () => {
  const db = createAdminClient()
  const { count } = await db.from('document_completion_resolution').select('*', { count: 'exact', head: true }).eq('proof_occurrence_id', proofId)
  return count ?? 0
}
const countCand = async (resId: string) => {
  const db = createAdminClient()
  const { count } = await db.from('document_completion_candidate').select('*', { count: 'exact', head: true }).eq('resolution_id', resId)
  return count ?? 0
}

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
    source_ref_id: randomUUID(), label: `${TAG} preuve`, effective_date: '2026-05-23',
    state_status: 'resolved', state_key: 'knowledge_fact',
  }).select('id').single()).data!.id as string
  cboAId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO A` }).select('id').single()).data!.id as string
  cboBId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO B` }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('document_completion_resolution').delete().eq('site_id', siteId)
  await db.from('canonical_subject_occurrence').delete().eq('site_id', siteId)
  await db.from('canonical_business_object').delete().eq('site_id', siteId)
  await db.from('canonical_subject').delete().eq('site_id', siteId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('persist atomique — RPC 382', () => {
  it('1. insertion complète → parent + N candidats', async () => {
    const out = await persistCompletionResolution({
      siteId, proofOccurrenceId: proofId,
      candidates: [
        { canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct', reason: 'ok' },
        { canonicalBusinessObjectId: cboBId, verdict: 'not_accomplished', intentMatch: 'different', evidenceDirectness: 'inferred', reason: 'non' },
      ],
      decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: cboAId, policyVersion: 'atomic-test-v1',
    })
    expect(out.kind).toBe('created')
    expect(await countCand(out.resolutionId)).toBe(2)
  })

  it('2. replay identique → aucun doublon (already_exists, mêmes candidats)', async () => {
    const before = await countRes()
    const out = await persistCompletionResolution({
      siteId, proofOccurrenceId: proofId,
      candidates: [
        { canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct', reason: 'ok' },
        { canonicalBusinessObjectId: cboBId, verdict: 'not_accomplished', intentMatch: 'different', evidenceDirectness: 'inferred', reason: 'non' },
      ],
      decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: cboAId, policyVersion: 'atomic-test-v1',
    })
    expect(out.kind).toBe('already_exists')
    expect(await countRes()).toBe(before) // aucun doublon
    expect(await countCand(out.resolutionId)).toBe(2) // candidats intacts
  })

  it('3. candidat invalide (FK CBO inexistant) → 0 parent + 0 enfant (rollback intégral)', async () => {
    const before = await countRes()
    const ghost = randomUUID() // CBO inexistant → viole la FK candidate
    await expect(persistCompletionResolution({
      siteId, proofOccurrenceId: proofId,
      candidates: [
        { canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct' },
        { canonicalBusinessObjectId: ghost, verdict: 'not_accomplished', intentMatch: 'different', evidenceDirectness: 'inferred' },
      ],
      decision: 'AMBIGUOUS', confidenceClass: 'LOW', selectedCboId: null, policyVersion: 'atomic-test-rollback',
    })).rejects.toThrow()
    // Le parent NE DOIT PAS exister sous cette policy (rollback intégral)
    const db = createAdminClient()
    const { count } = await db.from('document_completion_resolution').select('*', { count: 'exact', head: true })
      .eq('proof_occurrence_id', proofId).eq('policy_version', 'atomic-test-rollback')
    expect(count).toBe(0)
    expect(await countRes()).toBe(before) // aucune ligne ajoutée globalement
  })

  it('4. retry après échec (candidats valides) → succès normal', async () => {
    const out = await persistCompletionResolution({
      siteId, proofOccurrenceId: proofId,
      candidates: [{ canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct' }],
      decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: cboAId, policyVersion: 'atomic-test-rollback',
    })
    expect(out.kind).toBe('created')
    expect(await countCand(out.resolutionId)).toBe(1)
  })

  it('5. concurrence : deux persists identiques → une seule résolution logique', async () => {
    const input = {
      siteId, proofOccurrenceId: proofId,
      candidates: [{ canonicalBusinessObjectId: cboAId, verdict: 'accomplished' as const, intentMatch: 'exact' as const, evidenceDirectness: 'direct' as const }],
      decision: 'MATCH' as const, confidenceClass: 'HIGH' as const, selectedCboId: cboAId, policyVersion: 'atomic-test-race',
    }
    const [r1, r2] = await Promise.all([persistCompletionResolution(input), persistCompletionResolution(input)])
    expect(r1.resolutionId).toBe(r2.resolutionId) // même ligne
    const kinds = [r1.kind, r2.kind].sort()
    expect(kinds).toEqual(['already_exists', 'created']) // exactement un created, un already_exists
    const db = createAdminClient()
    const { count } = await db.from('document_completion_resolution').select('*', { count: 'exact', head: true })
      .eq('proof_occurrence_id', proofId).eq('policy_version', 'atomic-test-race')
    expect(count).toBe(1)
    expect(await countCand(r1.resolutionId)).toBe(1) // candidats présents une seule fois
  })

  it('6. lecture legacy intacte : getEffectiveResolution retrouve la résolution', async () => {
    const fp = computeContextFingerprint([cboAId])
    const eff = await getEffectiveResolution(proofId, [cboAId], 'atomic-test-race')
    expect(eff).not.toBeNull()
    expect(eff?.decision).toBe('MATCH')
    expect(eff?.contextFingerprint).toBe(fp)
  })
})
