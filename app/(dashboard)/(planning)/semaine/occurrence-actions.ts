'use server'

// « REVENIR AU ROULEMENT » — défaire une exception ponctuelle.
//
// L'exception a modifié UNE occurrence (équipe, horaire, jour, ou annulation).
// Ce geste restaure exactement ce que le rythme prescrit — pas ce qu'on croit
// se rappeler. La source de vérité est le template, relu au moment du geste.
//
// Le roulement n'a jamais bougé : c'est précisément ce qui rend le retour
// possible et sûr.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { prescribedDateNear, hhmmOf, detectDeviations } from '@/lib/planning/occurrence-exception'
import type { WeekTemplate } from '@/lib/db/week-planning'
import { slotFromUtcHour } from '@/lib/time/prestation-slot'
import { logAuditEvent } from '@/lib/audit/log'

export async function revertOccurrenceAction(
  interventionId: string,
): Promise<{ ok: true; message: string } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(interventionId).success) return { error: 'Identifiant invalide' }

  const owned = await requireOwned(auth.role, 'interventions', interventionId)
  if (!owned.allowed) return { error: owned.error }

  const db = createAdminClient()

  const { data: row } = await db
    .from('interventions')
    .select(
      'id, status, scheduled_for, slot, assigned_team_id, planned_start, planned_end, template_id, missions!inner(site_id)',
    )
    .eq('id', interventionId)
    .maybeSingle()

  const intv = row as {
    id: string
    status: string
    scheduled_for: string
    slot: string | null
    assigned_team_id: string | null
    planned_start: string | null
    planned_end: string | null
    template_id: string | null
    missions?: { site_id?: string }
  } | null
  if (!intv) return { error: 'Intervention introuvable' }
  if (!intv.template_id) return { error: 'Cette intervention ne vient pas d’un roulement' }

  // Fait, exécuté, en cours : le passé ne se « restaure » pas.
  if (intv.status !== 'planned' && intv.status !== 'skipped') {
    return { error: 'Cette intervention est déjà engagée — rien à restaurer' }
  }

  const { data: tplRow } = await db
    .from('intervention_templates')
    .select(
      'id, mission_id, frequency, slots, day_of_week, day_of_month, planned_start_hhmm, planned_end_hhmm, starts_on, ends_on, cycle_length_weeks, anchor_date, week_index, assigned_team_id, deleted_at',
    )
    .eq('id', intv.template_id)
    .maybeSingle()

  const tpl = tplRow as (WeekTemplate & { deleted_at: string | null }) | null
  // Le rythme d'origine a pu être ARCHIVÉ (roulement modifié avec date d'effet,
  // ou retiré). On ne restaure pas vers une règle qui n'existe plus : on le DIT.
  if (!tpl || tpl.deleted_at) {
    return { error: 'Le roulement d’origine n’existe plus — cette version a été remplacée' }
  }

  // Que restaure-t-on ? Exactement ce qui dévie — relu depuis le rythme.
  const deviations = detectDeviations(
    {
      scheduledFor: intv.scheduled_for,
      status: intv.status,
      assignedTeamId: intv.assigned_team_id,
      startHHMM: hhmmOf(intv.planned_start),
      endHHMM: hhmmOf(intv.planned_end),
    },
    tpl,
  )
  if (deviations.length === 0) return { error: 'Cette occurrence suit déjà son roulement' }

  // Le JOUR prescrit — celui du rythme, pas celui de l'exception.
  let targetDate = intv.scheduled_for
  if (deviations.some((d) => d.kind === 'date')) {
    const prescribed = prescribedDateNear(tpl, intv.scheduled_for)
    if (!prescribed) {
      return {
        error:
          'Impossible de retrouver le jour prévu à moins d’une semaine — le rythme ne tombe pas près de cette date',
      }
    }
    targetDate = prescribed
  }

  const patch: Record<string, unknown> = {
    scheduled_for: targetDate,
    scheduled_at: `${targetDate}T00:00:00.000Z`,
    status: 'planned',
    skipped_at: null,
    skipped_reason: null,
  }
  if (tpl.assigned_team_id) patch.assigned_team_id = tpl.assigned_team_id
  if (tpl.planned_start_hhmm) {
    patch.planned_start = `${targetDate}T${tpl.planned_start_hhmm}:00.000Z`
    patch.slot = slotFromUtcHour(Number(tpl.planned_start_hhmm.slice(0, 2)))
  }
  if (tpl.planned_end_hhmm) patch.planned_end = `${targetDate}T${tpl.planned_end_hhmm}:00.000Z`

  const { error } = await db.from('interventions').update(patch).eq('id', interventionId)
  if (error) {
    // L'identité d'occurrence (template_id, jour, créneau) est UNIQUE : si le
    // moteur a déjà régénéré ce jour-là, on ne crée pas un doublon — on le dit.
    if (error.code === '23505') {
      return { error: 'Une intervention du roulement existe déjà ce jour-là' }
    }
    return { error: error.message }
  }

  const siteId = intv.missions?.site_id
  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: siteId ?? interventionId,
    action: 'updated',
    metadata: {
      kind: 'occurrence_exception_reverted',
      intervention_id: interventionId,
      template_id: intv.template_id,
      restored_to: targetDate,
      deviations: deviations.map((d) => d.kind),
    },
  })

  revalidatePath('/semaine')
  revalidatePath('/dashboard')
  if (siteId) revalidatePath(`/sites/${siteId}`)

  return { ok: true, message: 'Revenue au roulement.' }
}
