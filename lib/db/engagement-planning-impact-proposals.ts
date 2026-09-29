// DOC-CONTRACT-OS-1B4-B (mandat Vincent 2026-09-30, sur audit 1B4-A FINAL
// CLOSED) — couche d'accès pour les Propositions d'impact Planning
// (migration 448). Génère/liste/écarte des propositions dérivées de
// engagement_contract_effects. AUCUNE mutation Planning ici (1B4-C, HOLD).
//
// Chaîne d'autorisation obligatoire, fail-closed à chaque maillon — même
// discipline que resolve-contract-state-for-user.ts (M2B) :
//   utilisateur → appartenance organisation (resolveResourceAccess)
//   → organisation/chantier DE L'ENGAGEMENT LUI-MÊME → lignes chargées.
//
// La capacité d'application Planning (resolvePlanningApplicationCapability)
// est calculée à la volée sur chaque lecture, jamais stockée en base — cf.
// doctrine de la migration 448 et lib/engagements/planning-impact-proposal.ts.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteById } from '@/lib/db/sites'
import { resolveResourceAccess } from '@/lib/auth/resource-access'
import { resolveEngagementAtDate } from '@/lib/engagements/resolve-contract-state'
import type { EngagementContractEffectRow, MaterializedContractEffect } from '@/lib/engagements/resolve-contract-state'
import type { ContractTemporality } from '@/lib/engagements/contract-effect'
import {
  buildPlanningImpactProposalPayload,
  computePlanningImpactProposalFingerprint,
  resolvePlanningApplicationCapability,
  type PlanningImpactKind,
  type PlanningImpactProposalPayload,
  type PlanningApplicationCapability,
} from '@/lib/engagements/planning-impact-proposal'
import { resolveContractCadenceAtDate, type ContractCadence } from '@/lib/engagements/contract-cadence'
import { addDaysLocal } from '@/lib/time/local-date'
import type { DbUser } from '@/types/db'

export type EngagementPlanningImpactProposalStatus = 'proposed' | 'dismissed'

export type EngagementPlanningImpactProposalRow = {
  id: string
  organizationId: string
  siteId: string | null
  engagementId: string
  contractEffectId: string
  impactKind: PlanningImpactKind
  proposalPayload: PlanningImpactProposalPayload
  proposalFingerprint: string
  proposalVersion: number
  status: EngagementPlanningImpactProposalStatus
  dismissedAt: string | null
  dismissedBy: string | null
  dismissalReason: string | null
  createdAt: string
  updatedAt: string
}

export type PlanningImpactProposalReadModel = EngagementPlanningImpactProposalRow & {
  capability: PlanningApplicationCapability
}

type EngagementContractEffectDbRow = {
  id: string
  engagement_id: string
  organization_id: string
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

type EngagementPlanningImpactProposalDbRow = {
  id: string
  organization_id: string
  site_id: string | null
  engagement_id: string
  contract_effect_id: string
  impact_kind: string
  proposal_payload: Record<string, unknown>
  proposal_fingerprint: string
  proposal_version: number
  status: string
  dismissed_at: string | null
  dismissed_by: string | null
  dismissal_reason: string | null
  created_at: string
  updated_at: string
}

function mapContractEffectRow(row: EngagementContractEffectDbRow): EngagementContractEffectRow {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    effect: row.effect as MaterializedContractEffect,
    temporality: row.temporality as ContractTemporality,
    scopeKey: row.scope_key,
    effectPayload: row.effect_payload ?? {},
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    resumeOn: row.resume_on,
    sourceDocumentId: row.source_document_id,
    sourceProposalId: row.source_proposal_id,
    appliedAt: row.applied_at,
  }
}

function mapProposalRow(row: EngagementPlanningImpactProposalDbRow): EngagementPlanningImpactProposalRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    engagementId: row.engagement_id,
    contractEffectId: row.contract_effect_id,
    impactKind: row.impact_kind as PlanningImpactKind,
    proposalPayload: row.proposal_payload as unknown as PlanningImpactProposalPayload,
    proposalFingerprint: row.proposal_fingerprint,
    proposalVersion: row.proposal_version,
    status: row.status as EngagementPlanningImpactProposalStatus,
    dismissedAt: row.dismissed_at,
    dismissedBy: row.dismissed_by,
    dismissalReason: row.dismissal_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const PROPOSAL_SELECT =
  'id, organization_id, site_id, engagement_id, contract_effect_id, impact_kind, proposal_payload, proposal_fingerprint, proposal_version, status, dismissed_at, dismissed_by, dismissal_reason, created_at, updated_at'

function isPlanningImpactKind(effect: MaterializedContractEffect): effect is PlanningImpactKind {
  return effect === 'new' || effect === 'modify' || effect === 'suspend'
}

/** Valeur de la portée `scopeKey` juste avant `beforeDate` (résolue sur
 *  l'historique COMPLET, jamais un sous-ensemble) — `null` si non résolvable
 *  (aucune date de référence pour MODIFY effectif immédiatement). */
function resolvePriorScopeValue(
  engagementId: string,
  effects: EngagementContractEffectRow[],
  scopeKey: string,
  startsOn: string | null,
): unknown {
  if (!startsOn) return null
  const dayBefore = addDaysLocal(startsOn, -1)
  const state = resolveEngagementAtDate({ engagementId, effects }, dayBefore)
  return state.scopes.find((s) => s.scopeKey === scopeKey)?.value ?? null
}

/** Cadence contractuelle structurée connue au jour civil précédant
 *  `startsOn` (mandat GO 1B4-B, règle 2 pour MODIFY frequency, règle 3 pour
 *  SUSPEND) — `null` si non résolvable ou non connue structurellement.
 *  Jamais écrite dans l'effet lui-même, uniquement injectée dans la
 *  proposition Planning dérivée. */
function resolvePriorCadence(
  engagementId: string,
  effects: EngagementContractEffectRow[],
  startsOn: string | null,
): ContractCadence | null {
  if (!startsOn) return null
  const dayBefore = addDaysLocal(startsOn, -1)
  const state = resolveEngagementAtDate({ engagementId, effects }, dayBefore)
  return resolveContractCadenceAtDate(effects, state)
}

export type GeneratePlanningImpactProposalsError = 'access_denied' | 'write_failed'

export type GeneratePlanningImpactProposalsResult =
  | { ok: true; proposals: EngagementPlanningImpactProposalRow[] }
  | { ok: false; error: GeneratePlanningImpactProposalsError }

/**
 * Génère (idempotent) les Propositions d'impact Planning pour tous les
 * effets contractuels matérialisables (NEW/MODIFY/SUSPEND) d'un Engagement.
 * CONFIRM n'en produit jamais (buildPlanningImpactProposalPayload → null).
 *
 * Idempotence : si le contenu dérivé d'un effet est inchangé depuis la
 * dernière génération (même fingerprint à version égale), aucune nouvelle
 * ligne n'est créée — la ligne existante est retournée telle quelle
 * (jamais réécrite : le statut de revue humaine, proposed ou dismissed,
 * n'est jamais altéré par une régénération). Si le contenu a dérivé (ex.
 * "from" recalculé suite à l'insertion d'un effet antérieur), une NOUVELLE
 * version est créée — l'ancienne ligne, avec sa décision humaine éventuelle,
 * reste intacte pour l'audit.
 */
export async function generatePlanningImpactProposalsForEngagement(
  engagementId: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<GeneratePlanningImpactProposalsResult> {
  const access = await resolveResourceAccess({ kind: 'engagement', id: engagementId }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }

  const supabase = createAdminClient()

  const { data: engagementRow, error: engagementError } = await supabase
    .from('engagements')
    .select('id, organization_id, site_id')
    .eq('id', engagementId)
    .maybeSingle()
  if (engagementError || !engagementRow) return { ok: false, error: 'access_denied' }

  const engagement = engagementRow as { id: string; organization_id: string; site_id: string | null }

  if (engagement.organization_id !== access.context.organizationId) {
    console.error(
      `[engagement-planning-impact-proposals] engagement ${engagementId} organization_id incohérent avec la résolution d'accès`,
    )
    return { ok: false, error: 'access_denied' }
  }

  if (engagement.site_id) {
    const site = await getSiteById(engagement.site_id)
    if (!site || site.organization_id !== engagement.organization_id) {
      console.error(
        `[engagement-planning-impact-proposals] engagement ${engagementId} chantier ${engagement.site_id} organisation incohérente`,
      )
      return { ok: false, error: 'access_denied' }
    }
  }

  const { data: effectRows, error: effectsError } = await supabase
    .from('engagement_contract_effects')
    .select(
      'id, engagement_id, organization_id, effect, temporality, scope_key, effect_payload, starts_on, ends_on, resume_on, source_document_id, source_proposal_id, applied_at',
    )
    .eq('engagement_id', engagementId)
  if (effectsError) return { ok: false, error: 'access_denied' }

  const rawEffects = (effectRows ?? []) as EngagementContractEffectDbRow[]
  const inconsistentEffect = rawEffects.some((row) => row.organization_id !== engagement.organization_id)
  if (inconsistentEffect) {
    console.error(
      `[engagement-planning-impact-proposals] engagement ${engagementId} effet(s) avec organization_id incohérent`,
    )
    return { ok: false, error: 'access_denied' }
  }

  const effects = rawEffects.map(mapContractEffectRow)
  const materializable = effects.filter((e) => isPlanningImpactKind(e.effect))

  const { data: existingRows, error: existingError } = await supabase
    .from('engagement_planning_impact_proposals')
    .select(PROPOSAL_SELECT)
    .eq('engagement_id', engagementId)
  if (existingError) return { ok: false, error: 'access_denied' }
  const existing = (existingRows ?? []) as EngagementPlanningImpactProposalDbRow[]

  const results: EngagementPlanningImpactProposalRow[] = []

  for (const effect of materializable) {
    const impactKind = effect.effect as PlanningImpactKind
    const priorScopeValue =
      impactKind === 'modify' && effect.scopeKey !== 'frequency'
        ? resolvePriorScopeValue(engagementId, effects, effect.scopeKey, effect.startsOn)
        : undefined
    const priorCadence =
      (impactKind === 'modify' && effect.scopeKey === 'frequency') || impactKind === 'suspend'
        ? resolvePriorCadence(engagementId, effects, effect.startsOn)
        : undefined
    const payload = buildPlanningImpactProposalPayload(effect, { priorScopeValue, priorCadence })
    if (!payload) continue

    const effectExisting = existing.filter((r) => r.contract_effect_id === effect.id)
    const latest =
      effectExisting.length > 0 ? effectExisting.reduce((a, b) => (a.proposal_version > b.proposal_version ? a : b)) : null

    const candidateVersion = latest ? latest.proposal_version : 1
    const candidateFingerprint = computePlanningImpactProposalFingerprint({
      contractEffectId: effect.id,
      impactKind,
      proposalPayload: payload,
      proposalVersion: candidateVersion,
    })

    if (latest && latest.proposal_fingerprint === candidateFingerprint) {
      results.push(mapProposalRow(latest))
      continue
    }

    const insertVersion = latest ? latest.proposal_version + 1 : 1
    const insertFingerprint = latest
      ? computePlanningImpactProposalFingerprint({
          contractEffectId: effect.id,
          impactKind,
          proposalPayload: payload,
          proposalVersion: insertVersion,
        })
      : candidateFingerprint

    const { data: insertedRow, error: insertError } = await supabase
      .from('engagement_planning_impact_proposals')
      .insert({
        organization_id: engagement.organization_id,
        site_id: engagement.site_id,
        engagement_id: engagementId,
        contract_effect_id: effect.id,
        impact_kind: impactKind,
        proposal_payload: payload,
        proposal_fingerprint: insertFingerprint,
        proposal_version: insertVersion,
        status: 'proposed',
      })
      .select(PROPOSAL_SELECT)
      .single()
    if (insertError || !insertedRow) return { ok: false, error: 'write_failed' }

    results.push(mapProposalRow(insertedRow as EngagementPlanningImpactProposalDbRow))
  }

  return { ok: true, proposals: results }
}

export type ListPlanningImpactProposalsError = 'access_denied'

export type ListPlanningImpactProposalsResult =
  | { ok: true; proposals: PlanningImpactProposalReadModel[] }
  | { ok: false; error: ListPlanningImpactProposalsError }

/** Dernière version par contract_effect_id, capacité d'application calculée
 *  à la volée. Ne génère rien — lecture seule sur ce qui existe déjà. */
export async function listPlanningImpactProposalsForEngagement(
  engagementId: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<ListPlanningImpactProposalsResult> {
  const access = await resolveResourceAccess({ kind: 'engagement', id: engagementId }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }

  const supabase = createAdminClient()

  const { data: engagementRow, error: engagementError } = await supabase
    .from('engagements')
    .select('id, organization_id')
    .eq('id', engagementId)
    .maybeSingle()
  if (engagementError || !engagementRow) return { ok: false, error: 'access_denied' }
  if ((engagementRow as { organization_id: string }).organization_id !== access.context.organizationId) {
    console.error(
      `[engagement-planning-impact-proposals] engagement ${engagementId} organization_id incohérent avec la résolution d'accès`,
    )
    return { ok: false, error: 'access_denied' }
  }

  const { data: rows, error: rowsError } = await supabase
    .from('engagement_planning_impact_proposals')
    .select(PROPOSAL_SELECT)
    .eq('engagement_id', engagementId)
  if (rowsError) return { ok: false, error: 'access_denied' }

  const raw = (rows ?? []) as EngagementPlanningImpactProposalDbRow[]
  const inconsistent = raw.some((r) => r.organization_id !== access.context.organizationId)
  if (inconsistent) {
    console.error(
      `[engagement-planning-impact-proposals] engagement ${engagementId} proposition(s) avec organization_id incohérent`,
    )
    return { ok: false, error: 'access_denied' }
  }

  const latestByEffect = new Map<string, EngagementPlanningImpactProposalDbRow>()
  for (const row of raw) {
    const current = latestByEffect.get(row.contract_effect_id)
    if (!current || row.proposal_version > current.proposal_version) {
      latestByEffect.set(row.contract_effect_id, row)
    }
  }

  const proposals = [...latestByEffect.values()].map((row) => {
    const mapped = mapProposalRow(row)
    return { ...mapped, capability: resolvePlanningApplicationCapability(mapped.impactKind, mapped.proposalPayload) }
  })

  return { ok: true, proposals }
}

export type DismissPlanningImpactProposalError = 'access_denied' | 'not_found'

export type DismissPlanningImpactProposalResult =
  | { ok: true; proposal: EngagementPlanningImpactProposalRow }
  | { ok: false; error: DismissPlanningImpactProposalError }

/** Idempotent : une proposition déjà `dismissed` n'est jamais réécrite (ni sa
 *  raison, ni son horodatage) — le premier geste humain fait foi.
 *
 * Sans oracle : un id inexistant et un id cross-organisation/non-membre
 * rendent tous deux `access_denied` — jamais `not_found` pour le premier
 * lookup, sous peine de laisser un appelant distinguer « la ressource
 * n'existe pas » de « elle existe mais m'est inaccessible » (cf. mandat
 * FIX_REQUIRED Vincent 2026-09-30, problème 1 ; même discipline que
 * `list`/`generate` ci-dessus). `not_found` reste réservé à l'échec de
 * l'UPDATE après un accès déjà prouvé (course avec une suppression
 * concurrente — pas un oracle, l'appelant a déjà la preuve d'accès). */
export async function dismissPlanningImpactProposal(
  proposalId: string,
  currentUser: Pick<DbUser, 'id'> | null | undefined,
  reason?: string,
): Promise<DismissPlanningImpactProposalResult> {
  const supabase = createAdminClient()

  const { data: proposalRow, error: proposalError } = await supabase
    .from('engagement_planning_impact_proposals')
    .select(PROPOSAL_SELECT)
    .eq('id', proposalId)
    .maybeSingle()
  if (proposalError || !proposalRow) return { ok: false, error: 'access_denied' }
  const row = proposalRow as EngagementPlanningImpactProposalDbRow

  const access = await resolveResourceAccess({ kind: 'engagement', id: row.engagement_id }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }
  if (row.organization_id !== access.context.organizationId) {
    console.error(
      `[engagement-planning-impact-proposals] proposition ${proposalId} organization_id incohérent avec la résolution d'accès`,
    )
    return { ok: false, error: 'access_denied' }
  }

  if (row.status === 'dismissed') return { ok: true, proposal: mapProposalRow(row) }

  const { data: updatedRow, error: updateError } = await supabase
    .from('engagement_planning_impact_proposals')
    .update({
      status: 'dismissed',
      dismissed_at: new Date().toISOString(),
      dismissed_by: access.context.userId,
      dismissal_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposalId)
    .select(PROPOSAL_SELECT)
    .single()
  if (updateError || !updatedRow) return { ok: false, error: 'not_found' }

  return { ok: true, proposal: mapProposalRow(updatedRow as EngagementPlanningImpactProposalDbRow) }
}
