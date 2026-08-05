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

  if (error || !data) return { ok: false, error: 'Impossible de créer cet événement.' }

  invalidateSiteProjection(siteId)
  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, eventId: (data as { id: string }).id }
}
