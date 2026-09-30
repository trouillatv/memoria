// DOC-CONTRACT-OS-1B4-C1 (GO Vincent 2026-09-30, sur audit 1B4-A/B0/B FINAL
// CLOSED — SHA c6864e85) — couche DB/auth pour la décision humaine
// d'application d'une Planning Impact Proposal (448) : cibles candidates
// (READ-ONLY), aperçu (READ-ONLY), création/maturation/annulation de la
// décision (planning_impact_application_decisions, migration 449).
//
// AUCUNE écriture Planning (missions/templates/cycles/interventions) — ce lot
// ne fait que décrire et statuer sur une intention humaine, jamais l'appliquer
// (mandat §16 : Apply réservé à C2+).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResourceAccess } from '@/lib/auth/resource-access'
import { getCycle } from '@/lib/db/planning-cycles'
import { getTemplate } from '@/lib/db/intervention-templates'
import { listActiveClosuresForSites } from '@/lib/db/site-closures'
import {
  resolvePlanningTargetCandidates,
  type ResolvableMission,
  type PlanningTargetCandidate,
} from '@/lib/planning/target-resolution'
import {
  buildCanonicalCycleState,
  computeCycleStateFingerprint,
  buildCanonicalSimpleTemplateState,
  computeSimpleTemplateStateFingerprint,
} from '@/lib/planning/state-fingerprint'
import {
  computeApplicationFingerprint,
  computeContractFreshness,
  normalizeDecisionAgainstProposal,
  computeSuspensionWindow,
  coversDate,
  overlapsPeriod,
  validateTargetEligibility,
  type MutationKind,
  type PlanningTargetSourceKind,
  type DecisionLifecycleStatus,
  type PlanningApplicationDecisionPayload,
  type NewDecisionPayload,
  type ModifyCycleDecisionPayload,
} from '@/lib/engagements/planning-application-decision'
import {
  previewNewSimple,
  previewModifyCycleGrid,
  previewSuspendWindow,
  type ModifyCycleGridPreview,
  type SuspendWindowPreview,
} from '@/lib/planning/impact-preview'
import { occurrenceKey, type ProjectableTemplate, type ProjectedOccurrence } from '@/lib/planning/projection'
import type {
  PlanningImpactKind,
  PlanningImpactProposalPayload,
  SuspendPlanningImpactPayload,
} from '@/lib/engagements/planning-impact-proposal'
import type { DbUser, DbInterventionTemplate } from '@/types/db'

// ── Chargement de la proposition (448) avec vérification d'accès ───────────
//
// Loader local minimal — ne réutilise pas PROPOSAL_SELECT/mapProposalRow
// (privés dans lib/db/engagement-planning-impact-proposals.ts) afin de ne pas
// percer leur encapsulation ; reproduit la même chaîne d'accès fail-closed.

type ProposalDbRow = {
  id: string
  organization_id: string
  site_id: string | null
  engagement_id: string
  contract_effect_id: string
  impact_kind: string
  proposal_payload: Record<string, unknown>
  proposal_version: number
  status: string
}

const PROPOSAL_MIN_SELECT =
  'id, organization_id, site_id, engagement_id, contract_effect_id, impact_kind, proposal_payload, proposal_version, status'

type LoadedProposal = {
  id: string
  organizationId: string
  siteId: string | null
  engagementId: string
  contractEffectId: string
  impactKind: PlanningImpactKind
  proposalPayload: PlanningImpactProposalPayload
  proposalVersion: number
  status: 'proposed' | 'dismissed'
}

type LoadProposalResult =
  | { ok: true; proposal: LoadedProposal; organizationId: string; userId: string }
  | { ok: false; error: 'access_denied' }

async function loadProposalWithAccess(
  proposalId: string,
  currentUser: Pick<DbUser, 'id'> | null | undefined,
): Promise<LoadProposalResult> {
  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('engagement_planning_impact_proposals')
    .select(PROPOSAL_MIN_SELECT)
    .eq('id', proposalId)
    .maybeSingle()
  if (error || !row) return { ok: false, error: 'access_denied' }
  const r = row as ProposalDbRow

  const access = await resolveResourceAccess({ kind: 'engagement', id: r.engagement_id }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }
  if (r.organization_id !== access.context.organizationId) {
    console.error(
      `[planning-impact-application-decisions] proposition ${proposalId} organization_id incohérent avec la résolution d'accès`,
    )
    return { ok: false, error: 'access_denied' }
  }

  return {
    ok: true,
    organizationId: access.context.organizationId,
    userId: access.context.userId,
    proposal: {
      id: r.id,
      organizationId: r.organization_id,
      siteId: r.site_id,
      engagementId: r.engagement_id,
      contractEffectId: r.contract_effect_id,
      impactKind: r.impact_kind as PlanningImpactKind,
      proposalPayload: r.proposal_payload as unknown as PlanningImpactProposalPayload,
      proposalVersion: r.proposal_version,
      status: r.status as 'proposed' | 'dismissed',
    },
  }
}

// ── Résolution READ-ONLY des cibles candidates (mandat §7) ──────────────────

export type ResolveTargetsResult =
  | { ok: true; candidates: PlanningTargetCandidate[] }
  | { ok: false; error: 'access_denied' }

export async function resolvePlanningTargetCandidatesForProposal(
  proposalId: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<ResolveTargetsResult> {
  const loaded = await loadProposalWithAccess(proposalId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { proposal } = loaded
  if (!proposal.siteId) return { ok: true, candidates: [] }

  const supabase = createAdminClient()
  const { data: missionRows, error: missionError } = await supabase
    .from('missions')
    .select('id, name, active, organization_id, engagement_ids')
    .eq('site_id', proposal.siteId)
    .is('deleted_at', null)
  if (missionError) return { ok: false, error: 'access_denied' }
  const allMissions = (missionRows ?? []) as Array<{
    id: string
    name: string
    active: boolean
    organization_id: string
    engagement_ids: string[] | null
  }>
  if (allMissions.some((m) => m.organization_id !== proposal.organizationId)) {
    console.error(`[planning-impact-application-decisions] proposition ${proposalId} mission(s) avec organization_id incohérent`)
    return { ok: false, error: 'access_denied' }
  }

  // NEW : toute Mission du chantier est candidate, même pas encore liée à cet
  // Engagement — le rattachement se fait en créant le rythme (mandat FIX 1).
  // MODIFY/SUSPEND : la cible doit être un rythme EXISTANT de CET Engagement —
  // une Mission qui ne le porte pas encore (engagement_ids) est
  // structurellement hors du périmètre contractuel de cette proposition.
  const missions =
    proposal.impactKind === 'new'
      ? allMissions
      : allMissions.filter((m) => (m.engagement_ids ?? []).includes(proposal.engagementId))
  if (missions.length === 0) return { ok: true, candidates: [] }
  const missionIds = missions.map((m) => m.id)

  const effectiveFrom = proposal.proposalPayload.effectiveFrom
  const effectiveTo = proposal.proposalPayload.effectiveTo

  const [templatesRes, cyclesRes] = await Promise.all([
    supabase
      .from('intervention_templates')
      .select('id, mission_id, starts_on, ends_on')
      .in('mission_id', missionIds)
      .is('cycle_id', null)
      .eq('active', true)
      .is('deleted_at', null),
    supabase
      .from('planning_cycles')
      .select('id, mission_id, starts_on, ends_on')
      .in('mission_id', missionIds)
      .eq('status', 'published')
      .is('deleted_at', null),
  ])
  if (templatesRes.error || cyclesRes.error) return { ok: false, error: 'access_denied' }

  // MODIFY/SUSPEND : une source ne compte comme candidate que si elle COUVRE
  // ponctuellement effectiveFrom (coversDate) — c'est la cible réelle à cette
  // date contractuelle. NEW : coversDate est INSUFFISANT — un nouveau rythme
  // couvrant 01/12→31/01 doit entrer en conflit avec un cycle publié
  // 01/01→null même s'il ne "couvre" pas le 01/12 ; c'est un chevauchement
  // d'intervalle (overlapsPeriod) qu'il faut tester, jamais une couverture
  // ponctuelle (mandat ROUND 2 FIX 2). effectiveFrom absent (null, cas
  // exceptionnel hors SUSPEND) : aucune vérification n'est possible, la
  // source reste candidate (comportement antérieur conservé).
  const templatesByMission = new Map<string, string[]>()
  for (const t of (templatesRes.data ?? []) as Array<{ id: string; mission_id: string; starts_on: string; ends_on: string | null }>) {
    if (!coversDate(t.starts_on, t.ends_on, effectiveFrom)) continue
    const list = templatesByMission.get(t.mission_id) ?? []
    list.push(t.id)
    templatesByMission.set(t.mission_id, list)
  }
  const cyclesByMission = new Map<string, string[]>()
  for (const c of (cyclesRes.data ?? []) as Array<{ id: string; mission_id: string; starts_on: string; ends_on: string | null }>) {
    const cycleQualifies =
      proposal.impactKind === 'new'
        ? overlapsPeriod(c.starts_on, c.ends_on, effectiveFrom, effectiveTo)
        : coversDate(c.starts_on, c.ends_on, effectiveFrom)
    if (!cycleQualifies) continue
    const list = cyclesByMission.get(c.mission_id) ?? []
    list.push(c.id)
    cyclesByMission.set(c.mission_id, list)
  }

  const candidateMissions: ResolvableMission[] = missions.map((m) => ({
    missionId: m.id,
    missionName: m.name,
    active: m.active,
    activeSimpleTemplateIds: templatesByMission.get(m.id) ?? [],
    activePublishedCycleIds: cyclesByMission.get(m.id) ?? [],
  }))

  return {
    ok: true,
    candidates: resolvePlanningTargetCandidates({ mutationKind: proposal.impactKind, candidateMissions }),
  }
}

// ── Aperçu READ-ONLY de l'application (mandat §8/§9/§10) ────────────────────

export type ApplicationPreview =
  | { kind: 'new'; occurrences: ProjectedOccurrence[] }
  | ({ kind: 'modify_cycle'; liveStateFingerprint: string } & ModifyCycleGridPreview)
  | { kind: 'modify_blocked_simple' }
  | ({ kind: 'suspend' } & SuspendWindowPreview)

export type PreviewApplicationError =
  | 'access_denied'
  | 'mutation_kind_mismatch'
  | 'target_mission_mismatch'
  | 'target_not_found'
  | 'target_organization_mismatch'
  | 'target_not_eligible'

export type PreviewApplicationResult =
  | { ok: true; preview: ApplicationPreview }
  | { ok: false; error: PreviewApplicationError }

export async function previewApplication(
  params: { proposalId: string; decisionPayload: PlanningApplicationDecisionPayload; from: string; to: string },
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<PreviewApplicationResult> {
  const { proposalId, decisionPayload, from, to } = params
  const loaded = await loadProposalWithAccess(proposalId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { proposal } = loaded
  if (decisionPayload.mutationKind !== proposal.impactKind) return { ok: false, error: 'mutation_kind_mismatch' }

  const supabase = createAdminClient()
  const { data: missionRow, error: missionError } = await supabase
    .from('missions')
    .select('id, organization_id, site_id, active, engagement_ids')
    .eq('id', decisionPayload.targetMissionId)
    .is('deleted_at', null)
    .maybeSingle()
  if (missionError || !missionRow) return { ok: false, error: 'target_not_found' }
  const mission = missionRow as {
    id: string
    organization_id: string
    site_id: string
    active: boolean
    engagement_ids: string[] | null
  }
  if (mission.organization_id !== proposal.organizationId || mission.site_id !== proposal.siteId) {
    console.error(
      `[planning-impact-application-decisions] proposition ${proposalId} cible mission ${mission.id} organisation/chantier incohérent`,
    )
    return { ok: false, error: 'target_organization_mismatch' }
  }
  const missionEligibility = { active: mission.active, engagementIds: mission.engagement_ids }
  const { effectiveFrom, effectiveTo } = proposal.proposalPayload

  if (decisionPayload.mutationKind === 'new') {
    const normalized = normalizeDecisionAgainstProposal(decisionPayload, proposal.proposalPayload)
    if (!normalized.ok) return { ok: false, error: normalized.error }
    const normalizedPayload = normalized.payload as NewDecisionPayload

    const { data: cycleRows, error: cycleError } = await supabase
      .from('planning_cycles')
      .select('starts_on, ends_on')
      .eq('mission_id', decisionPayload.targetMissionId)
      .eq('status', 'published')
      .is('deleted_at', null)
    if (cycleError) return { ok: false, error: 'target_not_found' }
    const eligible = validateTargetEligibility({
      mutationKind: 'new',
      targetSourceKind: null,
      engagementId: proposal.engagementId,
      effectiveFrom,
      effectiveTo,
      mission: missionEligibility,
      newMissionCycles: ((cycleRows ?? []) as Array<{ starts_on: string; ends_on: string | null }>).map((c) => ({
        startsOn: c.starts_on,
        endsOn: c.ends_on,
      })),
    })
    if (!eligible) return { ok: false, error: 'target_not_eligible' }

    return {
      ok: true,
      preview: { kind: 'new', occurrences: previewNewSimple({ draft: normalizedPayload.draftSimpleTemplate, from, to }) },
    }
  }

  if (decisionPayload.mutationKind === 'modify') {
    if (decisionPayload.targetSourceKind === 'simple') {
      const template = await getTemplate(decisionPayload.targetTemplateId)
      if (!template || template.mission_id !== decisionPayload.targetMissionId) return { ok: false, error: 'target_not_found' }
      const eligible = validateTargetEligibility({
        mutationKind: 'modify',
        targetSourceKind: 'simple',
        engagementId: proposal.engagementId,
        effectiveFrom,
        effectiveTo,
        mission: missionEligibility,
        simpleTemplate: { active: template.active, startsOn: template.starts_on, endsOn: template.ends_on },
      })
      if (!eligible) return { ok: false, error: 'target_not_eligible' }
      return { ok: true, preview: { kind: 'modify_blocked_simple' } }
    }
    const cycle = await getCycle(decisionPayload.targetCycleId)
    if (!cycle) return { ok: false, error: 'target_not_found' }
    if (cycle.missionId !== decisionPayload.targetMissionId || cycle.siteId !== proposal.siteId) {
      console.error(
        `[planning-impact-application-decisions] proposition ${proposalId} cible cycle ${cycle.id} mission/chantier incohérent`,
      )
      return { ok: false, error: 'target_organization_mismatch' }
    }
    const eligible = validateTargetEligibility({
      mutationKind: 'modify',
      targetSourceKind: 'cycle',
      engagementId: proposal.engagementId,
      effectiveFrom,
      effectiveTo,
      mission: missionEligibility,
      publishedCycle: { status: cycle.status, startsOn: cycle.startsOn, endsOn: cycle.endsOn },
    })
    if (!eligible) return { ok: false, error: 'target_not_eligible' }

    const normalized = normalizeDecisionAgainstProposal(decisionPayload, proposal.proposalPayload)
    if (!normalized.ok) return { ok: false, error: normalized.error }
    const normalizedPayload = normalized.payload as ModifyCycleDecisionPayload

    const closuresBySite = await listActiveClosuresForSites([proposal.siteId as string], from, to)
    const closures = closuresBySite[proposal.siteId as string] ?? []
    const grid = previewModifyCycleGrid({ before: cycle, after: normalizedPayload.draftCycleAfter, closures, from, to })
    const liveStateFingerprint = computeCycleStateFingerprint(buildCanonicalCycleState(cycle))
    return { ok: true, preview: { kind: 'modify_cycle', ...grid, liveStateFingerprint } }
  }

  // suspend — la fenêtre suspendue vient EXCLUSIVEMENT du contrat
  // (proposalPayload.effectiveFrom/effectiveTo/resumeOn) ; from/to reste une
  // fenêtre d'AFFICHAGE, jamais la définition de la suspension (mandat ROUND
  // 2 FIX 1). L'intersection contractuelle/affichage est calculée APRÈS la
  // validation d'éligibilité de la cible, jamais avant (target_not_found doit
  // rester prioritaire sur une fenêtre vide).
  let templates: ProjectableTemplate[] = []
  let eligible = false
  if (decisionPayload.targetSourceKind === 'simple') {
    if (!decisionPayload.targetTemplateId) return { ok: false, error: 'target_not_found' }
    const template = await getTemplate(decisionPayload.targetTemplateId)
    if (!template || template.mission_id !== decisionPayload.targetMissionId) return { ok: false, error: 'target_not_found' }
    templates = [template]
    eligible = validateTargetEligibility({
      mutationKind: 'suspend',
      targetSourceKind: 'simple',
      engagementId: proposal.engagementId,
      effectiveFrom,
      effectiveTo,
      mission: missionEligibility,
      simpleTemplate: { active: template.active, startsOn: template.starts_on, endsOn: template.ends_on },
    })
  } else if (decisionPayload.targetSourceKind === 'cycle') {
    if (!decisionPayload.targetCycleId) return { ok: false, error: 'target_not_found' }
    const cycle = await getCycle(decisionPayload.targetCycleId)
    if (!cycle || cycle.missionId !== decisionPayload.targetMissionId || cycle.siteId !== proposal.siteId) {
      return { ok: false, error: 'target_not_found' }
    }
    const { data: cycleTemplateRows, error: cycleTemplateError } = await supabase
      .from('intervention_templates')
      .select('*')
      .eq('cycle_id', decisionPayload.targetCycleId)
      .is('deleted_at', null)
    if (cycleTemplateError) return { ok: false, error: 'target_not_found' }
    templates = (cycleTemplateRows ?? []) as DbInterventionTemplate[]
    eligible = validateTargetEligibility({
      mutationKind: 'suspend',
      targetSourceKind: 'cycle',
      engagementId: proposal.engagementId,
      effectiveFrom,
      effectiveTo,
      mission: missionEligibility,
      publishedCycle: { status: cycle.status, startsOn: cycle.startsOn, endsOn: cycle.endsOn },
    })
  } else {
    return { ok: false, error: 'target_not_found' }
  }
  if (!eligible) return { ok: false, error: 'target_not_eligible' }

  const suspensionWindow = computeSuspensionWindow(proposal.proposalPayload as SuspendPlanningImpactPayload, from, to)
  if (!suspensionWindow) {
    return {
      ok: true,
      preview: { kind: 'suspend', occurrences: [], summary: { totalOccurrences: 0, materializedCount: 0, projectedOnlyCount: 0 } },
    }
  }
  const { from: windowFrom, to: windowTo } = suspensionWindow

  const templateIds = templates.map((t) => t.id)
  const materializedOccurrenceKeys = new Set<string>()
  if (templateIds.length > 0) {
    const { data: interventionRows, error: interventionError } = await supabase
      .from('interventions')
      .select('template_id, scheduled_for, slot')
      .in('template_id', templateIds)
      .gte('scheduled_for', windowFrom)
      .lte('scheduled_for', windowTo)
    if (interventionError) return { ok: false, error: 'target_not_found' }
    for (const row of (interventionRows ?? []) as Array<{
      template_id: string | null
      scheduled_for: string | null
      slot: string | null
    }>) {
      materializedOccurrenceKeys.add(
        occurrenceKey({ templateId: row.template_id, scheduledFor: row.scheduled_for, slot: row.slot }),
      )
    }
  }
  return {
    ok: true,
    preview: {
      kind: 'suspend',
      ...previewSuspendWindow({ templates, materializedOccurrenceKeys, from: windowFrom, to: windowTo }),
    },
  }
}

// ── Empreinte d'état Planning vivante (mandat §6/§12) — partagée création/maturation ──

type LiveFingerprintResult = { ok: true; fingerprint: string | null } | { ok: false }

async function resolveLivePlanningStateFingerprint(
  decisionPayload: PlanningApplicationDecisionPayload,
  siteId: string | null,
): Promise<LiveFingerprintResult> {
  if (decisionPayload.mutationKind === 'new') return { ok: true, fingerprint: null }
  if (decisionPayload.mutationKind === 'modify' && decisionPayload.targetSourceKind === 'simple') {
    // Bloqué en C1 (simple_modify_blocked_check) — jamais 'ready'/'applied' —
    // mais la cible doit exister et appartenir à cette Mission dès le draft :
    // ne jamais laisser `blocked_requires_simple_supersession` court-circuiter
    // cette vérification (mandat FIX 3, cross-cutting).
    const template = await getTemplate(decisionPayload.targetTemplateId)
    if (!template || template.mission_id !== decisionPayload.targetMissionId) return { ok: false }
    return { ok: true, fingerprint: null }
  }
  if (decisionPayload.targetSourceKind === 'cycle' && decisionPayload.targetCycleId) {
    const cycle = await getCycle(decisionPayload.targetCycleId)
    if (!cycle || cycle.missionId !== decisionPayload.targetMissionId || cycle.siteId !== siteId) return { ok: false }
    return { ok: true, fingerprint: computeCycleStateFingerprint(buildCanonicalCycleState(cycle)) }
  }
  if (decisionPayload.targetSourceKind === 'simple' && decisionPayload.targetTemplateId) {
    const template = await getTemplate(decisionPayload.targetTemplateId)
    if (!template || template.mission_id !== decisionPayload.targetMissionId) return { ok: false }
    return {
      ok: true,
      fingerprint: computeSimpleTemplateStateFingerprint(
        buildCanonicalSimpleTemplateState({
          id: template.id,
          missionId: template.mission_id,
          active: template.active,
          deletedAt: template.deleted_at,
          frequency: template.frequency,
          slots: template.slots ?? [],
          dayOfWeek: template.day_of_week,
          dayOfMonth: template.day_of_month,
          plannedStartHHMM: template.planned_start_hhmm,
          plannedEndHHMM: template.planned_end_hhmm,
          startsOn: template.starts_on,
          endsOn: template.ends_on,
        }),
      ),
    }
  }
  return { ok: false }
}

// ── Éligibilité serveur de la cible, DB-aware (mandat ROUND 2 FIX 3) ────────
//
// Helper partagé createDraftDecision/markDecisionReady : ces deux fonctions
// confondent DÉJÀ "cible introuvable" et "cible mission/chantier incohérente"
// sous target_not_found (comportement antérieur, testé, volontairement
// conservé ici) — contrairement à previewApplication qui distingue
// target_not_found de target_organization_mismatch et appelle donc la
// fonction pure validateTargetEligibility directement sur ses propres
// entités déjà résolues plutôt que via ce helper.

type CheckTargetEligibilityInput = {
  mutationKind: MutationKind
  targetSourceKind: PlanningTargetSourceKind | null
  targetMissionId: string
  targetTemplateId: string | null
  targetCycleId: string | null
  engagementId: string
  siteId: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
}

type CheckTargetEligibilityResult = { ok: true } | { ok: false; error: 'target_not_found' | 'target_not_eligible' }

async function checkTargetEligibility(
  supabase: ReturnType<typeof createAdminClient>,
  input: CheckTargetEligibilityInput,
): Promise<CheckTargetEligibilityResult> {
  const { data: missionRow, error: missionError } = await supabase
    .from('missions')
    .select('id, active, engagement_ids')
    .eq('id', input.targetMissionId)
    .is('deleted_at', null)
    .maybeSingle()
  if (missionError || !missionRow) return { ok: false, error: 'target_not_found' }
  const mission = missionRow as { id: string; active: boolean; engagement_ids: string[] | null }
  const missionEligibility = { active: mission.active, engagementIds: mission.engagement_ids }

  if (input.mutationKind === 'new') {
    const { data: cycleRows, error: cycleError } = await supabase
      .from('planning_cycles')
      .select('starts_on, ends_on')
      .eq('mission_id', input.targetMissionId)
      .eq('status', 'published')
      .is('deleted_at', null)
    if (cycleError) return { ok: false, error: 'target_not_found' }
    const eligible = validateTargetEligibility({
      mutationKind: 'new',
      targetSourceKind: null,
      engagementId: input.engagementId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      mission: missionEligibility,
      newMissionCycles: ((cycleRows ?? []) as Array<{ starts_on: string; ends_on: string | null }>).map((c) => ({
        startsOn: c.starts_on,
        endsOn: c.ends_on,
      })),
    })
    return eligible ? { ok: true } : { ok: false, error: 'target_not_eligible' }
  }

  if (input.targetSourceKind === 'simple') {
    if (!input.targetTemplateId) return { ok: false, error: 'target_not_found' }
    const template = await getTemplate(input.targetTemplateId)
    if (!template || template.mission_id !== input.targetMissionId) return { ok: false, error: 'target_not_found' }
    const eligible = validateTargetEligibility({
      mutationKind: input.mutationKind,
      targetSourceKind: 'simple',
      engagementId: input.engagementId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      mission: missionEligibility,
      simpleTemplate: { active: template.active, startsOn: template.starts_on, endsOn: template.ends_on },
    })
    return eligible ? { ok: true } : { ok: false, error: 'target_not_eligible' }
  }

  if (input.targetSourceKind === 'cycle') {
    if (!input.targetCycleId) return { ok: false, error: 'target_not_found' }
    const cycle = await getCycle(input.targetCycleId)
    if (!cycle || cycle.missionId !== input.targetMissionId || cycle.siteId !== input.siteId) {
      return { ok: false, error: 'target_not_found' }
    }
    const eligible = validateTargetEligibility({
      mutationKind: input.mutationKind,
      targetSourceKind: 'cycle',
      engagementId: input.engagementId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      mission: missionEligibility,
      publishedCycle: { status: cycle.status, startsOn: cycle.startsOn, endsOn: cycle.endsOn },
    })
    return eligible ? { ok: true } : { ok: false, error: 'target_not_eligible' }
  }

  return { ok: false, error: 'target_not_found' }
}

// ── Ligne DB / mapper (colonnes = migration 449 exactement) ─────────────────

type DecisionDbRow = {
  id: string
  organization_id: string
  site_id: string | null
  engagement_id: string
  contract_effect_id: string
  planning_impact_proposal_id: string
  proposal_version_at_decision: number
  mutation_kind: string
  target_mission_id: string
  target_source_kind: string | null
  target_template_id: string | null
  target_cycle_id: string | null
  decision_payload: Record<string, unknown>
  application_fingerprint: string
  planning_state_fingerprint: string | null
  status: string
  ready_at: string | null
  ready_by: string | null
  applied_at: string | null
  applied_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
  supersedes_decision_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PlanningImpactApplicationDecisionRow = {
  id: string
  organizationId: string
  siteId: string | null
  engagementId: string
  contractEffectId: string
  planningImpactProposalId: string
  proposalVersionAtDecision: number
  mutationKind: MutationKind
  targetMissionId: string
  targetSourceKind: PlanningTargetSourceKind | null
  targetTemplateId: string | null
  targetCycleId: string | null
  decisionPayload: PlanningApplicationDecisionPayload
  applicationFingerprint: string
  planningStateFingerprint: string | null
  status: DecisionLifecycleStatus
  readyAt: string | null
  readyBy: string | null
  appliedAt: string | null
  appliedBy: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationReason: string | null
  supersedesDecisionId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const DECISION_SELECT =
  'id, organization_id, site_id, engagement_id, contract_effect_id, planning_impact_proposal_id, proposal_version_at_decision, mutation_kind, target_mission_id, target_source_kind, target_template_id, target_cycle_id, decision_payload, application_fingerprint, planning_state_fingerprint, status, ready_at, ready_by, applied_at, applied_by, cancelled_at, cancelled_by, cancellation_reason, supersedes_decision_id, created_by, created_at, updated_at'

function mapDecisionRow(row: DecisionDbRow): PlanningImpactApplicationDecisionRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    engagementId: row.engagement_id,
    contractEffectId: row.contract_effect_id,
    planningImpactProposalId: row.planning_impact_proposal_id,
    proposalVersionAtDecision: row.proposal_version_at_decision,
    mutationKind: row.mutation_kind as MutationKind,
    targetMissionId: row.target_mission_id,
    targetSourceKind: row.target_source_kind as PlanningTargetSourceKind | null,
    targetTemplateId: row.target_template_id,
    targetCycleId: row.target_cycle_id,
    decisionPayload: row.decision_payload as unknown as PlanningApplicationDecisionPayload,
    applicationFingerprint: row.application_fingerprint,
    planningStateFingerprint: row.planning_state_fingerprint,
    status: row.status as DecisionLifecycleStatus,
    readyAt: row.ready_at,
    readyBy: row.ready_by,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    supersedesDecisionId: row.supersedes_decision_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Création de la décision (draft) ──────────────────────────────────────────

export type CreateDraftDecisionError =
  | 'access_denied'
  | 'mutation_kind_mismatch'
  | 'target_mission_mismatch'
  | 'target_not_found'
  | 'target_organization_mismatch'
  | 'target_not_eligible'
  | 'duplicate_fingerprint'
  | 'write_failed'

export type CreateDraftDecisionResult =
  | { ok: true; decision: PlanningImpactApplicationDecisionRow }
  | { ok: false; error: CreateDraftDecisionError }

export async function createDraftDecision(
  params: { proposalId: string; decisionPayload: PlanningApplicationDecisionPayload },
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<CreateDraftDecisionResult> {
  const { proposalId, decisionPayload } = params
  const loaded = await loadProposalWithAccess(proposalId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { proposal, userId } = loaded

  if (decisionPayload.mutationKind !== proposal.impactKind) return { ok: false, error: 'mutation_kind_mismatch' }

  const supabase = createAdminClient()
  const { data: missionRow, error: missionError } = await supabase
    .from('missions')
    .select('id, organization_id, site_id')
    .eq('id', decisionPayload.targetMissionId)
    .is('deleted_at', null)
    .maybeSingle()
  if (missionError || !missionRow) return { ok: false, error: 'target_not_found' }
  const mission = missionRow as { id: string; organization_id: string; site_id: string }
  if (mission.organization_id !== proposal.organizationId || mission.site_id !== proposal.siteId) {
    console.error(
      `[planning-impact-application-decisions] proposition ${proposalId} cible mission ${mission.id} organisation/chantier incohérent`,
    )
    return { ok: false, error: 'target_organization_mismatch' }
  }

  // Canonicalisation unique preview/persistance (mandat ROUND 2 FIX 1) — la
  // MÊME fonction pure que previewApplication, jamais une logique dupliquée :
  // le contrat (proposal) fournit nature/cadence/bornes/date d'effet,
  // l'humain ne fournit que les décisions organisationnelles manquantes
  // (équipe, horaire, jour).
  const normalized = normalizeDecisionAgainstProposal(decisionPayload, proposal.proposalPayload)
  if (!normalized.ok) return { ok: false, error: normalized.error }
  const sanitizedPayload = normalized.payload

  // Éligibilité serveur de la cible (mandat ROUND 2 FIX 3) — invariant vérifié
  // dès le draft, pas seulement affiché en aperçu.
  const { effectiveFrom, effectiveTo } = proposal.proposalPayload
  const eligibility = await checkTargetEligibility(supabase, {
    mutationKind: sanitizedPayload.mutationKind,
    targetSourceKind: sanitizedPayload.targetSourceKind,
    targetMissionId: sanitizedPayload.targetMissionId,
    targetTemplateId: sanitizedPayload.targetTemplateId,
    targetCycleId: sanitizedPayload.targetCycleId,
    engagementId: proposal.engagementId,
    siteId: proposal.siteId,
    effectiveFrom,
    effectiveTo,
  })
  if (!eligibility.ok) return { ok: false, error: eligibility.error }

  const liveFingerprint = await resolveLivePlanningStateFingerprint(sanitizedPayload, proposal.siteId)
  if (!liveFingerprint.ok) return { ok: false, error: 'target_not_found' }
  const planningStateFingerprint = liveFingerprint.fingerprint

  const applicationFingerprint = computeApplicationFingerprint({
    contractEffectId: proposal.contractEffectId,
    planningImpactProposalId: proposal.id,
    proposalVersionAtDecision: proposal.proposalVersion,
    mutationKind: sanitizedPayload.mutationKind,
    targetMissionId: sanitizedPayload.targetMissionId,
    targetSourceKind: sanitizedPayload.targetSourceKind,
    targetTemplateId: sanitizedPayload.targetTemplateId,
    targetCycleId: sanitizedPayload.targetCycleId,
    decisionPayload: sanitizedPayload,
  })

  // Atomique (mandat FIX 4, migration 450) — une seule transaction Postgres :
  // verrou + détection idempotence + supersession + insertion, jamais un
  // deux-temps SELECT/UPDATE/INSERT séparé côté client (cf. commentaire de la
  // migration pour le défaut d'atomicité corrigé).
  const { data: rpcData, error: rpcError } = await supabase.rpc('fn_planning_application_decision_create_draft', {
    p_organization_id: proposal.organizationId,
    p_site_id: proposal.siteId,
    p_engagement_id: proposal.engagementId,
    p_contract_effect_id: proposal.contractEffectId,
    p_planning_impact_proposal_id: proposal.id,
    p_proposal_version_at_decision: proposal.proposalVersion,
    p_mutation_kind: sanitizedPayload.mutationKind,
    p_target_mission_id: sanitizedPayload.targetMissionId,
    p_target_source_kind: sanitizedPayload.targetSourceKind,
    p_target_template_id: sanitizedPayload.targetTemplateId,
    p_target_cycle_id: sanitizedPayload.targetCycleId,
    p_decision_payload: sanitizedPayload,
    p_application_fingerprint: applicationFingerprint,
    p_planning_state_fingerprint: planningStateFingerprint,
    p_created_by: userId,
  })
  if (rpcError) {
    if (rpcError.message?.includes('PLANNING_APPLICATION_DECISION_DUPLICATE_FINGERPRINT')) {
      return { ok: false, error: 'duplicate_fingerprint' }
    }
    return { ok: false, error: 'write_failed' }
  }
  const result = rpcData as { idempotent: boolean; decision: DecisionDbRow } | null
  if (!result?.decision) return { ok: false, error: 'write_failed' }
  return { ok: true, decision: mapDecisionRow(result.decision) }
}

// ── Chargement d'une décision avec vérification d'accès ─────────────────────

async function loadDecisionWithAccess(
  decisionId: string,
  currentUser: Pick<DbUser, 'id'> | null | undefined,
): Promise<
  | { ok: true; decision: PlanningImpactApplicationDecisionRow; userId: string }
  | { ok: false; error: 'access_denied' }
> {
  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('planning_impact_application_decisions')
    .select(DECISION_SELECT)
    .eq('id', decisionId)
    .maybeSingle()
  if (error || !row) return { ok: false, error: 'access_denied' }
  const r = row as DecisionDbRow

  const access = await resolveResourceAccess({ kind: 'engagement', id: r.engagement_id }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }
  if (r.organization_id !== access.context.organizationId) {
    console.error(`[planning-impact-application-decisions] décision ${decisionId} organization_id incohérent avec la résolution d'accès`)
    return { ok: false, error: 'access_denied' }
  }

  return { ok: true, decision: mapDecisionRow(r), userId: access.context.userId }
}

// ── Maturation draft → ready (mandat §12 : double vérification de fraîcheur) ─

export type MarkDecisionReadyError =
  | 'access_denied'
  | 'invalid_status_transition'
  | 'blocked_requires_simple_supersession'
  | 'contract_stale'
  | 'contract_dismissed'
  | 'planning_state_stale'
  | 'target_not_found'
  | 'target_not_eligible'
  | 'write_failed'

export type MarkDecisionReadyResult =
  | { ok: true; decision: PlanningImpactApplicationDecisionRow }
  | { ok: false; error: MarkDecisionReadyError }

export async function markDecisionReady(
  decisionId: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<MarkDecisionReadyResult> {
  const loaded = await loadDecisionWithAccess(decisionId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { decision, userId } = loaded

  if (decision.status === 'ready') return { ok: true, decision }
  if (decision.status !== 'draft') return { ok: false, error: 'invalid_status_transition' }
  if (decision.mutationKind === 'modify' && decision.targetSourceKind === 'simple') {
    return { ok: false, error: 'blocked_requires_simple_supersession' }
  }

  const supabase = createAdminClient()
  const { data: proposalRows, error: proposalError } = await supabase
    .from('engagement_planning_impact_proposals')
    .select('proposal_version, status, proposal_payload')
    .eq('contract_effect_id', decision.contractEffectId)
    .order('proposal_version', { ascending: false })
    .limit(1)
  if (proposalError || !proposalRows || proposalRows.length === 0) return { ok: false, error: 'target_not_found' }
  const proposal = proposalRows[0] as { proposal_version: number; status: string; proposal_payload: Record<string, unknown> }

  const freshness = computeContractFreshness({
    proposalVersionAtDecision: decision.proposalVersionAtDecision,
    currentProposalVersion: proposal.proposal_version,
    currentProposalStatus: proposal.status as 'proposed' | 'dismissed',
  })
  if (freshness === 'dismissed') return { ok: false, error: 'contract_dismissed' }
  if (freshness === 'stale') return { ok: false, error: 'contract_stale' }

  // Éligibilité serveur de la cible (mandat ROUND 2 FIX 3) — revalidée EN
  // DIRECT ici, jamais déduite du seul planning_state_fingerprint : une
  // Mission retirée d'engagement_ids, un cycle arrêté ou un rythme simple
  // désactivé entre le draft et la maturation doit refuser le passage à
  // 'ready'.
  const proposalPayload = proposal.proposal_payload as unknown as PlanningImpactProposalPayload
  const eligibility = await checkTargetEligibility(supabase, {
    mutationKind: decision.mutationKind,
    targetSourceKind: decision.targetSourceKind,
    targetMissionId: decision.targetMissionId,
    targetTemplateId: decision.targetTemplateId,
    targetCycleId: decision.targetCycleId,
    engagementId: decision.engagementId,
    siteId: decision.siteId,
    effectiveFrom: proposalPayload.effectiveFrom,
    effectiveTo: proposalPayload.effectiveTo,
  })
  if (!eligibility.ok) return { ok: false, error: eligibility.error }

  const liveFingerprint = await resolveLivePlanningStateFingerprint(decision.decisionPayload, decision.siteId)
  if (!liveFingerprint.ok) return { ok: false, error: 'target_not_found' }
  if (liveFingerprint.fingerprint !== decision.planningStateFingerprint) return { ok: false, error: 'planning_state_stale' }

  // Compare-and-set (mandat ROUND 2 FIX 4A) — la transition draft→ready ne
  // doit jamais résusciter une décision supersédée entre la lecture
  // ci-dessus et cette écriture : l'UPDATE exige explicitement
  // status='draft', jamais un simple .eq('id', ...).single() qui écrirait
  // aveuglément sur n'importe quel statut courant.
  const nowIso = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await supabase
    .from('planning_impact_application_decisions')
    .update({ status: 'ready', ready_at: nowIso, ready_by: userId, updated_at: nowIso })
    .eq('id', decisionId)
    .eq('status', 'draft')
    .select(DECISION_SELECT)
  if (updateError) return { ok: false, error: 'write_failed' }
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: 'invalid_status_transition' }
  return { ok: true, decision: mapDecisionRow(updatedRows[0] as DecisionDbRow) }
}

// ── Annulation (idempotente, discipline "sans oracle") ───────────────────────

export type CancelDecisionError = 'access_denied' | 'already_applied' | 'invalid_status_transition' | 'write_failed'

export type CancelDecisionResult =
  | { ok: true; decision: PlanningImpactApplicationDecisionRow }
  | { ok: false; error: CancelDecisionError }

export async function cancelDecision(
  decisionId: string,
  currentUser: Pick<DbUser, 'id'> | null | undefined,
  reason?: string,
): Promise<CancelDecisionResult> {
  const loaded = await loadDecisionWithAccess(decisionId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { decision, userId } = loaded
  if (decision.status === 'cancelled') return { ok: true, decision }
  if (decision.status === 'applied') return { ok: false, error: 'already_applied' }
  // superseded est terminal au même titre qu'applied/cancelled (mandat ROUND 2
  // FIX 4B) — jamais transformé en cancelled : une décision remplacée par une
  // plus récente doit rester superseded pour toujours.
  if (decision.status === 'superseded') return { ok: false, error: 'invalid_status_transition' }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data: updatedRow, error: updateError } = await supabase
    .from('planning_impact_application_decisions')
    .update({ status: 'cancelled', cancelled_at: nowIso, cancelled_by: userId, cancellation_reason: reason ?? null, updated_at: nowIso })
    .eq('id', decisionId)
    .select(DECISION_SELECT)
    .single()
  if (updateError || !updatedRow) return { ok: false, error: 'write_failed' }
  return { ok: true, decision: mapDecisionRow(updatedRow as DecisionDbRow) }
}

// ── Lecture — liste des décisions d'une proposition ──────────────────────────

export type ListDecisionsError = 'access_denied'

export type ListDecisionsResult =
  | { ok: true; decisions: PlanningImpactApplicationDecisionRow[] }
  | { ok: false; error: ListDecisionsError }

export async function listDecisionsForProposal(
  proposalId: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<ListDecisionsResult> {
  const loaded = await loadProposalWithAccess(proposalId, currentUser)
  if (!loaded.ok) return { ok: false, error: 'access_denied' }
  const { proposal } = loaded

  const supabase = createAdminClient()
  const { data: rows, error } = await supabase
    .from('planning_impact_application_decisions')
    .select(DECISION_SELECT)
    .eq('planning_impact_proposal_id', proposal.id)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: 'access_denied' }

  const raw = (rows ?? []) as DecisionDbRow[]
  if (raw.some((r) => r.organization_id !== proposal.organizationId)) {
    console.error(`[planning-impact-application-decisions] proposition ${proposalId} décision(s) avec organization_id incohérent`)
    return { ok: false, error: 'access_denied' }
  }
  return { ok: true, decisions: raw.map(mapDecisionRow) }
}
