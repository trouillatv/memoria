// Test d'INTÉGRATION (vraie Supabase) — P1-4B-PROPOSAL, migration 383.
//
// Prouve le chemin de preuve proposition-level : XOR des références (occurrence/proposition),
// persistance atomique proposal-ref (created/already_exists/rollback), idempotence par
// (proof_proposal_id, policy, fingerprint enrichi). Le chemin occurrence-level legacy reste couvert
// par document-completion-persist-atomic.test.ts (inchangé).
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { persistCompletionResolution, getEffectiveResolutionByProposal } from '@/lib/db/document-completion-resolution'

const TAG = `__test_p14b_proposal_${Math.floor(Date.now() / 1000)}__`

let orgId: string, clientId: string, siteId: string, docId: string, runId: string, proposalId: string, cboAId: string, cboBId: string

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id
  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/x.pdf`, filename: 'x.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
  proposalId = (await db.from('document_extraction_proposal').insert({
    organization_id: orgId, extraction_run_id: runId, document_id: docId,
    proposal_family: 'knowledge_fact', label: `${TAG} fait`, document_status: 'done',
  }).select('id').single()).data!.id as string
  cboAId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO A` }).select('id').single()).data!.id as string
  cboBId = (await db.from('canonical_business_object').insert({ site_id: siteId, object_type: 'site_action', label: `${TAG} CBO B` }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('document_completion_resolution').delete().eq('site_id', siteId)
  await db.from('canonical_business_object').delete().eq('site_id', siteId)
  await db.from('document_extraction_proposal').delete().eq('id', proposalId)
  await db.from('document_extraction_run').delete().eq('id', runId)
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

const candValid = () => [
  { canonicalBusinessObjectId: cboAId, verdict: 'accomplished' as const, intentMatch: 'exact' as const, evidenceDirectness: 'direct' as const, reason: 'ok' },
  { canonicalBusinessObjectId: cboBId, verdict: 'not_accomplished' as const, intentMatch: 'different' as const, evidenceDirectness: 'inferred' as const, reason: 'non' },
]

describe('preuve proposition-level — XOR + atomicité (migration 383)', () => {
  it('XOR TS : aucune référence → throw ; deux références → throw', async () => {
    await expect(persistCompletionResolution({
      siteId, candidates: [], decision: 'NO_MATCH', confidenceClass: 'LOW', selectedCboId: null, contextFingerprint: 'x',
    })).rejects.toThrow()
    await expect(persistCompletionResolution({
      siteId, proofOccurrenceId: randomUUID(), proofProposalId: proposalId,
      candidates: [], decision: 'NO_MATCH', confidenceClass: 'LOW', selectedCboId: null, contextFingerprint: 'x',
    })).rejects.toThrow()
  })

  it('XOR DB : insert direct des deux (ou aucune) référence → rejeté', async () => {
    const db = createAdminClient()
    const both = await db.from('document_completion_resolution').insert({
      site_id: siteId, proof_occurrence_id: randomUUID(), proof_proposal_id: proposalId,
      policy_version: 'x', context_fingerprint: 'x', decision: 'NO_MATCH', confidence_class: 'LOW',
    })
    expect(both.error).not.toBeNull()
    const none = await db.from('document_completion_resolution').insert({
      site_id: siteId, policy_version: 'x', context_fingerprint: 'y', decision: 'NO_MATCH', confidence_class: 'LOW',
    })
    expect(none.error).not.toBeNull()
  })

  it('proposition : persistance atomique → parent + candidats, puis replay = already_exists', async () => {
    const input = {
      siteId, proofProposalId: proposalId, candidates: candValid(),
      decision: 'MATCH' as const, confidenceClass: 'HIGH' as const, selectedCboId: cboAId,
      policyVersion: 'p1.4b.v2.2', contextFingerprint: 'fp-prop-1',
    }
    const first = await persistCompletionResolution(input)
    expect(first.kind).toBe('created')
    const db = createAdminClient()
    const { count } = await db.from('document_completion_candidate').select('*', { count: 'exact', head: true }).eq('resolution_id', first.resolutionId)
    expect(count).toBe(2)
    const retry = await persistCompletionResolution(input)
    expect(retry.kind).toBe('already_exists')
    expect(retry.resolutionId).toBe(first.resolutionId)
  })

  it('proposition : décision effective adressée par proof_proposal_id + fingerprint', async () => {
    const eff = await getEffectiveResolutionByProposal(proposalId, 'fp-prop-1', 'p1.4b.v2.2')
    expect(eff).not.toBeNull()
    expect(eff?.decision).toBe('MATCH')
    expect(eff?.selectedCboId).toBe(cboAId)
  })

  it('proposition : candidat FK invalide → rollback intégral (0 parent + 0 enfant)', async () => {
    await expect(persistCompletionResolution({
      siteId, proofProposalId: proposalId,
      candidates: [
        { canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct' },
        { canonicalBusinessObjectId: randomUUID(), verdict: 'not_accomplished', intentMatch: 'different', evidenceDirectness: 'inferred' },
      ],
      decision: 'AMBIGUOUS', confidenceClass: 'LOW', selectedCboId: null,
      policyVersion: 'p1.4b.v2.2', contextFingerprint: 'fp-prop-rollback',
    })).rejects.toThrow()
    const db = createAdminClient()
    const { count } = await db.from('document_completion_resolution').select('*', { count: 'exact', head: true })
      .eq('proof_proposal_id', proposalId).eq('context_fingerprint', 'fp-prop-rollback')
    expect(count).toBe(0)
  })

  it('proposition : retry après échec (candidats valides) → succès', async () => {
    const out = await persistCompletionResolution({
      siteId, proofProposalId: proposalId,
      candidates: [{ canonicalBusinessObjectId: cboAId, verdict: 'accomplished', intentMatch: 'exact', evidenceDirectness: 'direct' }],
      decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: cboAId,
      policyVersion: 'p1.4b.v2.2', contextFingerprint: 'fp-prop-rollback',
    })
    expect(out.kind).toBe('created')
  })
})
