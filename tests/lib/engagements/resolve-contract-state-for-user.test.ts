// Test d'INTÉGRATION (vraie Supabase) — DOC-CONTRACT-OS-1B2-B3 (mandat Vincent
// 2026-09-29, sur 1B2-A FINAL CLOSED / 1B2-B1 CODE CLOSED / 1B2-B2 CODE
// CLOSED). Couvre la primitive serveur canonique
// `resolveEngagementContractStateForUser` : autorisation M2B, chargement DB,
// mapping vers le moteur pur B1, délégation intégrale sans recomposition.
//
// Conventions reprises de tests/lib/db/materialize-engagement-contract-effect.test.ts
// (proposals qualifiées + RPC atomique pour produire de vrais effets
// persistés — jamais un insert direct dans engagement_contract_effects, qui
// exigerait de recréer artificiellement les contraintes NOT NULL/FK que la
// RPC garantit déjà).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEngagementContractStateForUser } from '@/lib/engagements/resolve-contract-state-for-user'
import {
  resolveEngagementAtDate,
  type EngagementContractEffectRow,
  type MaterializedContractEffect,
} from '@/lib/engagements/resolve-contract-state'
import type { ContractTemporality } from '@/lib/engagements/contract-effect'

type EngagementContractEffectDbRow = {
  id: string
  engagement_id: string
  effect: string
  temporality: string
  scope_key: string
  effect_payload: Record<string, unknown> | null
  starts_on: string | null
  ends_on: string | null
  resume_on: string | null
  source_document_id: string
  source_proposal_id: string
  applied_at: string
}

const TAG = `__test_resolve_for_user_${Math.floor(Date.now() / 1000)}__`

let memberOrgId: string
let outsiderOrgId: string
let adminUserId: string
let clientId: string
let siteId: string
let outsiderClientId: string
let outsiderSiteId: string
let docId: string
let runId: string

let legacyEngagementId: string
let historyEngagementId: string
let crossOrgEngagementId: string
let inconsistentEngagementId: string
let tamperedEffectEngagementId: string

const currentUser = () => ({ id: adminUserId })

async function makeQualifiedProposal(
  contractEffect: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const db = createAdminClient()
  const { data: proposal, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: memberOrgId,
      extraction_run_id: runId,
      document_id: docId,
      target_site_id: siteId,
      proposal_family: 'engagement',
      label: `${TAG} proposal`,
      source_excerpt: `${TAG} extrait source de la proposition`,
      review_status: 'accepted',
      source_payload: { contract_effect: contractEffect },
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  const proposalId = (proposal as { id: string }).id

  const { data: evidence, error: evidenceError } = await db
    .from('document_extraction_evidence')
    .insert({ organization_id: memberOrgId, extraction_run_id: runId, document_id: docId, evidence_type: 'text_excerpt' })
    .select('id')
    .single()
  if (evidenceError) throw evidenceError
  const { error: linkError } = await db
    .from('document_proposal_evidence')
    .insert({ proposal_id: proposalId, evidence_id: (evidence as { id: string }).id, relation_type: 'source' })
  if (linkError) throw linkError

  return proposalId
}

async function insertEngagement(overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('engagements')
    .insert({
      source_type: 'manual',
      source_excerpt: `${TAG} source excerpt`,
      category: 'other',
      short_label: `${TAG} engagement`,
      status: 'active',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun user admin — seed requis')
  adminUserId = (admin as { id: string }).id

  memberOrgId = (await db.from('organizations').insert({ name: `${TAG}member_org` }).select('id').single()).data!.id as string
  outsiderOrgId = (await db.from('organizations').insert({ name: `${TAG}outsider_org` }).select('id').single()).data!.id as string

  const { error: membershipError } = await db.from('organization_memberships').insert({
    user_id: adminUserId,
    organization_id: memberOrgId,
    role: 'admin',
    status: 'active',
  })
  if (membershipError) throw membershipError

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: memberOrgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: memberOrgId }).select('id').single()).data!.id as string
  outsiderClientId = (await db.from('clients').insert({ name: `${TAG}outsider_client`, organization_id: outsiderOrgId }).select('id').single()).data!.id as string
  outsiderSiteId = (await db.from('sites').insert({ name: `${TAG}outsider_site`, client_id: outsiderClientId, organization_id: outsiderOrgId }).select('id').single()).data!.id as string

  docId = (await db.from('documents').insert({ organization_id: memberOrgId, document_type: 'ordre_service', storage_path: `${TAG}/os.pdf`, filename: 'os.pdf' }).select('id').single()).data!.id as string
  runId = (await db.from('document_extraction_run').insert({ organization_id: memberOrgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string

  legacyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} legacy` })
  historyEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} history` })
  crossOrgEngagementId = await insertEngagement({ site_id: outsiderSiteId, organization_id: outsiderOrgId, short_label: `${TAG} cross-org` })
  // Anomalie délibérée : organisation membre, chantier d'une AUTRE organisation
  // — jamais produite par un parcours normal, témoin du fail-closed Section 7.
  inconsistentEngagementId = await insertEngagement({ site_id: outsiderSiteId, organization_id: memberOrgId, short_label: `${TAG} inconsistent` })

  // Historique : permanent (fréquence A depuis 2026-01-01) puis bounded
  // (fréquence B, 2026-06-01→2026-06-30) — reconstruction permanent → bounded
  // → retour au permanent après expiration.
  const permanentProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-01-01',
    targetEngagementId: historyEngagementId,
  })
  await materializeEffectWithPayload(permanentProposal, { frequency: 'A' })

  const boundedProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'bounded',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-06-01',
    endsOn: '2026-06-30',
    targetEngagementId: historyEngagementId,
  })
  await materializeEffectWithPayload(boundedProposal, { frequency: 'B' })

  // Effet corrompu : matérialisé normalement via la RPC (donc cohérent à la
  // création), puis son organization_id est altéré directement en base —
  // seule façon de produire, en lecture privilégiée, l'anomalie que la RPC
  // interdit en écriture. Témoin du fail-closed Section 7 sur les EFFETS,
  // pas seulement sur l'Engagement/chantier.
  tamperedEffectEngagementId = await insertEngagement({ site_id: siteId, organization_id: memberOrgId, short_label: `${TAG} tampered-effect` })
  const tamperedProposal = await makeQualifiedProposal({
    effect: 'modify',
    temporality: 'permanent',
    scope: 'frequency',
    scopeKey: 'frequency',
    startsOn: '2026-01-01',
    targetEngagementId: tamperedEffectEngagementId,
  })
  const tamperedEffect = await materializeEffectWithPayload(tamperedProposal, { frequency: 'TAMPERED' })
  const { error: tamperError } = await db
    .from('engagement_contract_effects')
    .update({ organization_id: outsiderOrgId })
    .eq('id', tamperedEffect.effect_id)
  if (tamperError) throw tamperError
})

async function materializeEffectWithPayload(proposalId: string, payload: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db.rpc('materialize_engagement_contract_effect', {
    p_proposal_id: proposalId,
    p_user_id: adminUserId,
    p_category: null,
    p_kind: null,
    p_measurable: null,
    p_effect_payload: payload,
  })
  if (error) throw error
  return (data as Array<{ effect_id: string; engagement_id: string }>)[0]
}

afterAll(async () => {
  const db = createAdminClient()
  // engagements cascade → engagement_contract_effects
  await db.from('engagements').delete().in('id', [legacyEngagementId, historyEngagementId, crossOrgEngagementId, inconsistentEngagementId, tamperedEffectEngagementId])
  // documents cascade → run → proposals → evidence → proposal_evidence → materialization
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().in('id', [siteId, outsiderSiteId])
  await db.from('clients').delete().in('id', [clientId, outsiderClientId])
  await db.from('organization_memberships').delete().eq('user_id', adminUserId).eq('organization_id', memberOrgId)
  await db.from('organizations').delete().in('id', [memberOrgId, outsiderOrgId])
})

describe('resolveEngagementContractStateForUser — happy path', () => {
  it('utilisateur autorisé, Engagement legacy (zéro effet) : DTO identique au resolver pur', async () => {
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '2026-09-29', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expected = resolveEngagementAtDate({ engagementId: legacyEngagementId, effects: [] }, '2026-09-29')
    expect(result.state).toEqual(expected)
    expect(result.state.existence).toEqual({ status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null })
  })

  it('utilisateur autorisé, Engagement avec effets : DTO identique au resolver pur pour les mêmes lignes', async () => {
    const db = createAdminClient()
    const { data: rows } = await db
      .from('engagement_contract_effects')
      .select('id, engagement_id, effect, temporality, scope_key, effect_payload, starts_on, ends_on, resume_on, source_document_id, source_proposal_id, applied_at')
      .eq('engagement_id', historyEngagementId)
    const effects: EngagementContractEffectRow[] = ((rows ?? []) as EngagementContractEffectDbRow[]).map((r) => ({
      id: r.id,
      engagementId: r.engagement_id,
      effect: r.effect as MaterializedContractEffect,
      temporality: r.temporality as ContractTemporality,
      scopeKey: r.scope_key,
      effectPayload: r.effect_payload ?? {},
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      resumeOn: r.resume_on,
      sourceDocumentId: r.source_document_id,
      sourceProposalId: r.source_proposal_id,
      appliedAt: r.applied_at,
    }))
    const expected = resolveEngagementAtDate({ engagementId: historyEngagementId, effects }, '2026-03-15')

    const result = await resolveEngagementContractStateForUser(historyEngagementId, '2026-03-15', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toEqual(expected)
  })
})

describe('resolveEngagementContractStateForUser — reconstruction historique', () => {
  it('permanent avant le bounded (2026-03-15) : fréquence A', async () => {
    const result = await resolveEngagementContractStateForUser(historyEngagementId, '2026-03-15', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const frequency = result.state.scopes.find((s) => s.scopeKey === 'frequency')
    expect(frequency?.value).toEqual({ frequency: 'A' })
    expect(frequency?.basis).toBe('modify')
  })

  it('pendant la fenêtre bounded (2026-06-15) : fréquence B', async () => {
    const result = await resolveEngagementContractStateForUser(historyEngagementId, '2026-06-15', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const frequency = result.state.scopes.find((s) => s.scopeKey === 'frequency')
    expect(frequency?.value).toEqual({ frequency: 'B' })
  })

  it('après expiration du bounded (2026-07-15) : retour à la fréquence A', async () => {
    const result = await resolveEngagementContractStateForUser(historyEngagementId, '2026-07-15', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const frequency = result.state.scopes.find((s) => s.scopeKey === 'frequency')
    expect(frequency?.value).toEqual({ frequency: 'A' })
  })
})

describe('resolveEngagementContractStateForUser — sécurité', () => {
  it('Engagement d’une autre organisation : refusé', async () => {
    const result = await resolveEngagementContractStateForUser(crossOrgEngagementId, '2026-09-29', currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('Engagement avec incohérence organisation/chantier : refusé (fail-closed, jamais absorbé)', async () => {
    const result = await resolveEngagementContractStateForUser(inconsistentEngagementId, '2026-09-29', currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('effet rattaché à l’Engagement mais organization_id incohérent (lecture privilégiée) : refusé, aucun appel au resolver', async () => {
    const result = await resolveEngagementContractStateForUser(tamperedEffectEngagementId, '2026-09-29', currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('utilisateur non membre de l’organisation : refusé', async () => {
    const strangerId = randomUUID()
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '2026-09-29', { id: strangerId })
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('id inexistant : refusé proprement', async () => {
    const result = await resolveEngagementContractStateForUser(randomUUID(), '2026-09-29', currentUser())
    expect(result).toEqual({ ok: false, error: 'access_denied' })
  })

  it('aucun oracle : id inexistant et Engagement cross-org rendent le même message externe', async () => {
    const nonexistent = await resolveEngagementContractStateForUser(randomUUID(), '2026-09-29', currentUser())
    const crossOrg = await resolveEngagementContractStateForUser(crossOrgEngagementId, '2026-09-29', currentUser())
    expect(nonexistent).toEqual(crossOrg)
  })
})

describe('resolveEngagementContractStateForUser — mapping', () => {
  it('effect_payload, dates et appliedAt (audit uniquement) sont fidèlement transmis', async () => {
    const result = await resolveEngagementContractStateForUser(historyEngagementId, '2026-06-15', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const boundedEntry = result.state.provenanceTrail.find((p) => p.temporality === 'bounded')
    expect(boundedEntry).toMatchObject({ startsOn: '2026-06-01', endsOn: '2026-06-30' })
    expect(typeof boundedEntry?.recordedInMemoriaAt).toBe('string')
    // appliedAt (recordedInMemoriaAt) reste un horodatage d'audit — jamais
    // confondu avec la date contractuelle startsOn qu'il accompagne.
    expect(boundedEntry?.recordedInMemoriaAt).not.toBe(boundedEntry?.startsOn)
  })
})

describe('resolveEngagementContractStateForUser — date', () => {
  it('date ISO valide acceptée', async () => {
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '2026-12-25', currentUser())
    expect(result.ok).toBe(true)
  })

  it('date invalide (format) refusée', async () => {
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '25/12/2026', currentUser())
    expect(result).toEqual({ ok: false, error: 'invalid_date' })
  })

  it('date invalide (calendaire impossible) refusée', async () => {
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '2026-02-30', currentUser())
    expect(result).toEqual({ ok: false, error: 'invalid_date' })
  })

  it('date invalide vérifiée avant toute autorisation — même refus pour un Engagement inexistant', async () => {
    const result = await resolveEngagementContractStateForUser(randomUUID(), 'not-a-date', currentUser())
    expect(result).toEqual({ ok: false, error: 'invalid_date' })
  })
})

describe('resolveEngagementContractStateForUser — legacy (aucun effet)', () => {
  it('Engagement sans aucun effet : engagement_base, value=null, jamais de parsing de texte', async () => {
    const result = await resolveEngagementContractStateForUser(legacyEngagementId, '2026-09-29', currentUser())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.scopes).toEqual([
      {
        scopeKey: 'whole_engagement',
        applicability: 'applicable',
        dominatedByWholeEngagementSuspend: false,
        basis: 'engagement_base',
        value: null,
        sourceEffectId: null,
        valueConflict: null,
        applicabilityConflict: null,
        indeterminateReason: null,
      },
    ])
  })
})
