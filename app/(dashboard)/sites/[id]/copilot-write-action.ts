'use server'

// Copilote 3C — Server Actions de confirmation.
// Invariant : AUCUNE écriture sans confirmation explicite de l'utilisateur.
// Chaque action est idempotente via copilot_proposal_id (UNIQUE en base).

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { upsertPreparationItem } from '@/lib/db/visit-preparation'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { toNomeaTimestamp } from '@/lib/visits/copilot-schedule-parse'
import { todayLocalIso } from '@/lib/time/local-date'
import { confirmActorAlias } from '@/lib/db/actor-alias-write'
import { confirmSiteFact } from '@/lib/db/site-fact-write'
import { confirmSiteRelation } from '@/lib/db/canonical-subject-link-write'
import { confirmSiteWatchpoint } from '@/lib/db/site-watchpoint-write'
import { confirmSiteDeadline } from '@/lib/db/site-deadline-write'

// ── Créer une action depuis une proposition copilote ─────────────────────────

const createActionSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  llmModel: z.string().max(100),
  promptVersion: z.string().max(50),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotActionResult =
  | { ok: true; actionId: string }
  | { ok: false; error: string }

export async function createCopilotAction(rawInput: unknown): Promise<CreateCopilotActionResult> {
  const parsed = createActionSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, body, canonicalSubjectId, copilotProposalId, llmModel, promptVersion, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule action
  const { data: existing } = await admin
    .from('site_actions')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) return { ok: true, actionId: (existing as { id: string }).id }

  const { data, error } = await admin
    .from('site_actions')
    .insert({
      site_id: siteId,
      title,
      body: body ?? null,
      status: 'open',
      created_by: user.id,
      created_from: 'copilot',
      copilot_proposal_id: copilotProposalId,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      llm_model: llmModel,
      prompt_version: promptVersion,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  invalidateSiteProjection(siteId)
  // Mise à jour best-effort du statut de proposition dans la télémétrie
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, actionId: (data as { id: string }).id }
}

// ── Ajouter au plan de visite depuis une proposition copilote ────────────────

const addToBriefingSchema = z.object({
  siteId: z.string().uuid(),
  label: z.string().min(1).max(255),
  canonicalSubjectId: z.string().uuid().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).optional(),
})

export type AddCopilotToBriefingResult =
  | { ok: true }
  | { ok: false; error: string }

export async function addCopilotToBriefing(rawInput: unknown): Promise<AddCopilotToBriefingResult> {
  const parsed = addToBriefingSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, label, canonicalSubjectId, copilotProposalId, interactionId, reason } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  const orgIds = await getOrgIdsOfUser().catch(() => [] as string[])
  if (orgIds.length === 0) return { ok: false, error: 'Organisation introuvable.' }

  try {
    await upsertPreparationItem({
      siteId,
      organizationId: orgIds[0],
      stableKey: `copilot:${copilotProposalId}`,
      label,
      sourceKind: 'copilot_suggestion',
      sourceRef: copilotProposalId,
      canonicalSubjectId: canonicalSubjectId ?? null,
      priority: 'normal',
      reason: reason ?? 'Proposé par le Copilote',
      preparedBy: user.id,
    })
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true }
}

// ── Planifier un événement depuis une proposition copilote ────────────────────

const createScheduledEventSchema = z.object({
  siteId: z.string().uuid(),
  type: z.enum(['visit', 'meeting']),
  title: z.string().min(1).max(255),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date invalide (yyyy-mm-dd)'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)'),
  objective: z.string().max(500).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotScheduledEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string }

export async function createCopilotScheduledEvent(
  rawInput: unknown,
): Promise<CreateCopilotScheduledEventResult> {
  const parsed = createScheduledEventSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, type, title, scheduledDate, scheduledTime, objective, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'un seul événement
  const { data: existing } = await admin
    .from('site_scheduled_events')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) return { ok: true, eventId: (existing as { id: string }).id }

  // Récupérer organization_id (NOT NULL sur site_scheduled_events)
  const { data: site } = await admin
    .from('sites')
    .select('organization_id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  const orgId = (site as { organization_id: string } | null)?.organization_id
  if (!orgId) return { ok: false, error: 'Chantier introuvable.' }

  // Construire le payload discriminé selon le type
  const payload = type === 'visit'
    ? { type: 'visit', ...(objective?.trim() ? { objective: objective.trim() } : {}) }
    : { type: 'meeting', ...(objective?.trim() ? { agenda: objective.trim() } : {}) }

  const plannedStart = toNomeaTimestamp(scheduledDate, scheduledTime)

  console.log('[ScheduleVisit] SCHEDULE_VISIT_CONFIRM_START', { siteId, type, scheduledDate, scheduledTime, title: title.trim() })

  const { data, error } = await admin
    .from('site_scheduled_events')
    .insert({
      organization_id: orgId,
      site_id: siteId,
      type,
      status: 'planned',
      planned_start: plannedStart,
      title: title.trim(),
      payload,
      created_from: 'manual',
      created_by: user.id,
      copilot_proposal_id: copilotProposalId,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[ScheduleVisit] SCHEDULE_VISIT_CONFIRM_ERROR', { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint })
    return { ok: false, error: 'Impossible de créer cet événement.' }
  }

  const eventId = (data as { id: string }).id
  console.log('[ScheduleVisit] SCHEDULE_VISIT_DB_CREATED', { eventId, siteId, plannedStart })
  invalidateSiteProjection(siteId)
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  console.log('[ScheduleVisit] SCHEDULE_VISIT_CONFIRM_SUCCESS', { eventId })
  return { ok: true, eventId }
}

// ── Enregistrer un constat OBSERVATION depuis une proposition copilote ───────
//
// P4-A — canal séparé des 3 actions ci-dessus : écrit directement dans
// canonical_subject_occurrence (source_kind='copilot', mig 326), pas dans
// site_actions/visit_preparation/site_scheduled_events. canonical_subject_id
// est NOT NULL en base : un constat sans sujet résolu ne peut pas être
// confirmé (le brouillon n'est même pas construit dans ce cas, voir
// copilot-free-prepare.ts). validation_status='confirmed' d'emblée : cette
// action ne s'exécute qu'après confirmation humaine explicite. Aucune écriture
// de lastMeaningfulChangeAt ici — la doctrine Fact Ledger décide "évolution ou
// pas" après matérialisation, jamais à l'écriture.

const createObservationSchema = z.object({
  siteId: z.string().uuid(),
  canonicalSubjectId: z.string().uuid(),
  label: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotObservationResult =
  | { ok: true; occurrenceId: string }
  | { ok: false; error: string }

export async function createCopilotObservation(rawInput: unknown): Promise<CreateCopilotObservationResult> {
  const parsed = createObservationSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, canonicalSubjectId, label, body, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'une seule occurrence
  // (miroir de cso_copilot_uniq, mig 326 : canonical_subject_id + source_ref_id).
  const { data: existing } = await admin
    .from('canonical_subject_occurrence')
    .select('id')
    .eq('source_kind', 'copilot')
    .eq('source_ref_id', copilotProposalId)
    .maybeSingle()
  if (existing) return { ok: true, occurrenceId: (existing as { id: string }).id }

  const { data, error } = await admin
    .from('canonical_subject_occurrence')
    .insert({
      canonical_subject_id: canonicalSubjectId,
      site_id: siteId,
      source_kind: 'copilot',
      source_ref_id: copilotProposalId,
      source_proposal_id: null,
      visit_status: null,
      label,
      note: body ?? null,
      evidence_count: 0,
      effective_date: todayLocalIso(),
      created_by: user.id,
      validation_status: 'confirmed',
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Impossible d\'enregistrer ce constat.' }

  const occurrenceId = (data as { id: string }).id
  invalidateSiteProjection(siteId)
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, occurrenceId }
}

// ── Confirmer une correspondance d'identité d'acteur (P4-B.2) ───────────────
//
// « Retenir que "Clim Expert" désigne Clim Expair ? » → actor_alias(status=
// 'confirmed'). La cible (company OU company_contact) doit déjà exister —
// cette action ne crée jamais d'acteur, elle enregistre une correspondance.
//
// Correction #2 (Vincent, mandat P4-B.2) : ne JAMAIS faire confiance à un
// organization_id transmis par le client. `organizationId` vient uniquement
// de `requireSiteAccess`, et la cible est revérifiée serveur pour confirmer
// qu'elle appartient bien à cette organisation avant toute écriture.

const createActorAliasSchema = z.object({
  siteId: z.string().uuid(),
  alias: z.string().min(1).max(255),
  targetKind: z.enum(['company', 'contact']),
  targetId: z.string().uuid(),
  aliasNature: z.enum(['business_alias', 'transcription_alias']),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotActorAliasResult =
  | { ok: true; aliasId: string }
  | { ok: false; error: string }

export async function createCopilotActorAlias(rawInput: unknown): Promise<CreateCopilotActorAliasResult> {
  const parsed = createActorAliasSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, alias, targetKind, targetId, aliasNature, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmActorAlias({
    organizationId,
    userId: user.id,
    alias,
    targetKind,
    targetId,
    aliasNature,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Retenir une information depuis une proposition copilote (P4-C, FACT) ────
//
// La nature (current_information / durable_knowledge) est choisie par
// l'humain sur le brouillon — jamais déduite ici ni en amont. Écrit
// directement dans site_knowledge_entries, pas de résolution de sujet
// requise en V1 (cadrage Vincent).

const createFactSchema = z.object({
  siteId: z.string().uuid(),
  kind: z.enum(['current_information', 'durable_knowledge']),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotFactResult =
  | { ok: true; entryId: string }
  | { ok: false; error: string }

export async function createCopilotFact(rawInput: unknown): Promise<CreateCopilotFactResult> {
  const parsed = createFactSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, kind, title, body, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteFact({
    organizationId,
    siteId,
    userId: user.id,
    kind,
    title,
    body: body ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Confirmer une relation entre deux sujets (P4-D1, RELATION_CLAIM) ────────
//
// « Le SSI dépend de la mise sous tension » → canonical_subject_links,
// status='confirmed' d'emblée (l'utilisateur affirme ET valide lui-même —
// pas une suggestion statistique du moteur P0-B1). evidenceText = phrase
// verbatim de l'utilisateur (invariant canonical_subject_link_evidence.
// evidence_text, mig 316). Aucune résolution ni création de sujet ici : les
// deux id ont déjà été résolus avec certitude dans copilot-free-prepare.ts.

const createRelationClaimSchema = z.object({
  siteId: z.string().uuid(),
  relationType: z.enum(['requires', 'enables', 'validates', 'causes', 'replaces']),
  sourceSubjectId: z.string().uuid(),
  targetSubjectId: z.string().uuid(),
  evidenceText: z.string().min(1).max(2000),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotRelationClaimResult =
  | { ok: true; linkId: string }
  | { ok: false; error: string }

export async function createCopilotRelationClaim(rawInput: unknown): Promise<CreateCopilotRelationClaimResult> {
  const parsed = createRelationClaimSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, relationType, sourceSubjectId, targetSubjectId, evidenceText, copilotProposalId, interactionId } = parsed.data

  try {
    await requireSiteAccess(siteId)
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteRelation({
    siteId,
    userId: user.id,
    relationType,
    sourceSubjectId,
    targetSubjectId,
    evidenceText,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Retenir un point de vigilance depuis une proposition copilote (P4-E1) ───
//
// « Surveille le SSI tant que ce n'est pas réglé » → site_watchpoints,
// status='active' (défaut de la table). Aucune nature à choisir (contrairement
// à FACT) : un point de vigilance n'a qu'une seule forme. Pas de résolution ni
// de FK de sujet ici — même doctrine que FACT (canonicalSubjectId reste un
// enrichissement d'affichage du brouillon, jamais persisté). La fermeture
// (résolu/converti en réserve) reste un geste humain exclusif, hors périmètre
// de cette action.

const createWatchpointSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotWatchpointResult =
  | { ok: true; watchpointId: string }
  | { ok: false; error: string }

export async function createCopilotWatchpoint(rawInput: unknown): Promise<CreateCopilotWatchpointResult> {
  const parsed = createWatchpointSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, body, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteWatchpoint({
    organizationId,
    siteId,
    userId: user.id,
    title,
    body: body ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}

// ── Créer une échéance depuis une proposition copilote (P4-E2) ──────────────
//
// « Le SSI doit être réglé avant vendredi » → site_deadlines. `dueDate` null
// reste un état valide (« à planifier », doctrine mig 215) — jamais rejeté ni
// forcé. Pas de sujet ni de nature à choisir ici — même doctrine que FACT/
// WATCHPOINT (canonicalSubjectId n'existe même pas comme colonne sur
// site_deadlines, audit p4-e2-audit-deadline). `body` (constraint_text) porte
// la phrase verbatim, jamais une date déduite du texte.

const createDeadlineSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().min(1).max(255),
  body: z.string().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  copilotProposalId: z.string().uuid(),
  interactionId: z.string().uuid().nullable().optional(),
})

export type CreateCopilotDeadlineResult =
  | { ok: true; deadlineId: string }
  | { ok: false; error: string }

export async function createCopilotDeadline(rawInput: unknown): Promise<CreateCopilotDeadlineResult> {
  const parsed = createDeadlineSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides.' }
  const { siteId, title, body, dueDate, copilotProposalId, interactionId } = parsed.data

  let organizationId: string
  try {
    const access = await requireSiteAccess(siteId)
    organizationId = access.organizationId
  } catch {
    return { ok: false, error: 'Accès non autorisé.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié.' }

  return confirmSiteDeadline({
    organizationId,
    siteId,
    userId: user.id,
    title,
    constraintText: body ?? null,
    dueDate: dueDate ?? null,
    copilotProposalId,
    interactionId: interactionId ?? null,
  })
}
