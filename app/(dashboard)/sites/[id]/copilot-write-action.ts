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
import { normalizeActorLabel } from '@/lib/db/actor-alias-resolve'

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

  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut confirmer qu'une seule correspondance.
  const { data: existing } = await admin
    .from('actor_alias')
    .select('id, status')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string; status: string }
    if (row.status !== 'confirmed') {
      await admin
        .from('actor_alias')
        .update({ status: 'confirmed', confirmed_by: user.id, confirmed_at: new Date().toISOString() })
        .eq('id', row.id)
    }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, aliasId: row.id }
  }

  // Revérification serveur de la cible — jamais la parole du client.
  if (targetKind === 'company') {
    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!company) return { ok: false, error: 'Acteur introuvable dans cette organisation.' }
  } else {
    const { data: contact } = await admin
      .from('company_contacts')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!contact) return { ok: false, error: 'Acteur introuvable dans cette organisation.' }
  }

  const { data, error } = await admin
    .from('actor_alias')
    .insert({
      organization_id: organizationId,
      company_id: targetKind === 'company' ? targetId : null,
      contact_id: targetKind === 'contact' ? targetId : null,
      alias,
      alias_norm: normalizeActorLabel(alias),
      alias_nature: aliasNature,
      status: 'confirmed',
      source: 'copilot',
      copilot_proposal_id: copilotProposalId,
      copilot_interaction_id: interactionId ?? null,
      created_by: user.id,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: 'Cette correspondance est déjà mémorisée pour cet acteur.' }
    return { ok: false, error: error?.message ?? "Impossible d'enregistrer cette correspondance." }
  }

  const aliasId = (data as { id: string }).id
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, aliasId }
}
