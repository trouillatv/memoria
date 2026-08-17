import 'server-only'

// Cœur d'écriture de `createCopilotScheduledEvent` (P5-F3), extrait de
// `copilot-write-action.ts` pour être appelable HORS contexte HTTP/cookies —
// même raison que `confirmSiteAction` (lib/db/site-action-write.ts, P5-F1) :
// un harnais de recette réversible doit exécuter EXACTEMENT le même chemin
// d'écriture que la server action, sans passer par une session cookie.
//
// `copilot-write-action.ts` reste la SEULE porte d'entrée en production —
// c'est elle qui résout userId depuis la session (via requireSiteAccess) et
// le transmet ici. Ce module ne fait AUCUNE vérification d'accès.
//
// Extraction à comportement strictement identique (P5-F3, 2026-08-17) :
// la branche idempotente ci-dessous NE rappelle PAS updateCopilotProposalStatus
// (contrairement à confirmSiteAction) — asymmetrie déjà présente dans le code
// original, préservée telle quelle, pas « corrigée ». Les logs `[ScheduleVisit]`
// (investigation de debug antérieure) sont conservés à l'identique.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { toNomeaTimestamp } from '@/lib/visits/copilot-schedule-parse'

export type ConfirmScheduledEventParams = {
  siteId: string
  userId: string
  type: 'visit' | 'meeting'
  title: string
  scheduledDate: string
  scheduledTime: string
  objective: string | null
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmScheduledEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string }

export async function confirmScheduledEvent(params: ConfirmScheduledEventParams): Promise<ConfirmScheduledEventResult> {
  const { siteId, userId, type, title, scheduledDate, scheduledTime, objective, copilotProposalId, interactionId } = params
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
      created_by: userId,
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
