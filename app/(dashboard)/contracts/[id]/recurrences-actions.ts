'use server'

// Phase 6 — Récurrence simple — Slice 6.2
//
// Server actions pour création de récurrences (intervention templates).
// Wording interne: "template" (helpers DB) ; UX externe: "récurrence".

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { getMission } from '@/lib/db/missions'
import { slotFromUtcHour } from '@/lib/time/prestation-slot'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  archiveTemplate,
  getTemplate,
} from '@/lib/db/intervention-templates'
import { logAuditEvent } from '@/lib/audit/log'

// PLAN-SEC-1 FINAL — le rôle métier vient du membership dans l'organisation
// DU CHANTIER (doctrine M2C), jamais de users.role : un compte manager sur
// son profil mais chef_equipe sur l'organisation propriétaire du site ne
// doit pas pouvoir créer/modifier/archiver une récurrence de ce chantier.
// requireSiteWriteAccess résout à la fois l'appartenance et le rôle dans
// l'organisation du site — remplace l'ancienne paire de gardes qui vérifiait
// ces deux dimensions séparément, l'une sur le mauvais référentiel
// (rôle global de l'utilisateur). Le site vient
// TOUJOURS de la Mission persistée (jamais de contract_id client, jamais
// d'un site_id client), et le refus est identique que la Mission/le
// template soit introuvable ou appartienne à une autre organisation : aucun
// oracle ne doit permettre de distinguer les deux cas.
const REFUS = 'Accès refusé' as const

const frequencySchema = z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'one_shot'])
const slotSchema = z.enum(['morning', 'afternoon', 'evening'])
const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
}

function isReplaceCycleRequired(message: string): boolean {
  return message.includes('PLAN_INTEG_REPLACE_CYCLE_REQUIRED')
}

/** Dérive slot + heures depuis l'heure précise (si fournie). Le slot reste
 *  utile à la grille et à l'index d'unicité ; l'heure exacte vit dans le template. */
function deriveTimeFields(
  startHHMM: string | undefined,
  endHHMM: string | undefined,
  fallbackSlots: ('morning' | 'afternoon' | 'evening')[],
): { slots: ('morning' | 'afternoon' | 'evening')[] | null; planned_start_hhmm: string | null; planned_end_hhmm: string | null } {
  if (startHHMM) {
    const slot = slotFromUtcHour(Number(startHHMM.slice(0, 2)))
    return { slots: [slot], planned_start_hhmm: startHHMM, planned_end_hhmm: endHHMM ?? null }
  }
  return { slots: fallbackSlots.length > 0 ? fallbackSlots : null, planned_start_hhmm: null, planned_end_hhmm: null }
}

const createRecurrenceSchema = z
  .object({
    mission_id: z.string().uuid(),
    // Le contrat n'est plus un PRÉREQUIS : il ne sert qu'à revalider sa page si
    // la mission en a un. Une mission sans contrat a désormais sa propre fiche.
    contract_id: z.string().uuid().optional(),
    title: z.string().min(1).max(200).optional(),
    frequency: frequencySchema,
    day_of_week: z.number().int().min(1).max(7).nullable().optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    slots: z.array(slotSchema).max(3).default([]),
    planned_start_hhmm: z.string().regex(hhmmRe, 'Heure invalide (HH:MM)').optional(),
    planned_end_hhmm: z.string().regex(hhmmRe, 'Heure invalide (HH:MM)').optional(),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
    // « Jusqu'à quand ? » — la colonne existait depuis la mig 021 et n'était
    // écrite NULLE PART. Un rythme sans fin est un rythme qu'on n'ose pas créer.
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis').nullable().optional(),
    confirm_replace_cycle: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ends_on && data.ends_on < data.starts_on) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fin ne peut pas précéder le début', path: ['ends_on'] })
    }
    if (data.planned_start_hhmm && data.planned_end_hhmm && data.planned_end_hhmm <= data.planned_start_hhmm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "L'heure de fin doit être après le début", path: ['planned_end_hhmm'] })
    }
    if (data.frequency === 'weekly' && (data.day_of_week === null || data.day_of_week === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quel jour de la semaine ?',
        path: ['day_of_week'],
      })
    }
    if (data.frequency === 'monthly' && (data.day_of_month === null || data.day_of_month === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quel jour du mois ?',
        path: ['day_of_month'],
      })
    }
  })

export interface CreateRecurrenceInput {
  mission_id: string
  contract_id?: string
  title?: string
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'one_shot'
  day_of_week?: number | null
  day_of_month?: number | null
  slots: ('morning' | 'afternoon' | 'evening')[]
  planned_start_hhmm?: string
  planned_end_hhmm?: string
  starts_on: string
  ends_on?: string | null
  confirm_replace_cycle?: boolean
}

export type CreateRecurrenceResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string; conflict?: 'replace_cycle_with_simple' }

export async function createRecurrenceAction(
  input: CreateRecurrenceInput
): Promise<CreateRecurrenceResult> {
  const parsed = createRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  // PLAN-SEC-1 FINAL : la mission RÉELLE est chargée d'abord (jamais de
  // confiance dans un mission_id client sans preuve) ; le site — donc
  // l'organisation et le rôle métier de l'appelant — est dérivé de cette
  // mission persistée, jamais d'un contract_id ou site_id client. Mission
  // introuvable ou accès refusé renvoient le MÊME message.
  const mission = await getMission(parsed.data.mission_id)
  if (!mission) return { ok: false, error: REFUS }

  const access = await requireSiteWriteAccess(mission.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: REFUS }

  const title = (parsed.data.title?.trim() || mission.name).slice(0, 200)
  const t = deriveTimeFields(parsed.data.planned_start_hhmm, parsed.data.planned_end_hhmm, parsed.data.slots)

  try {
    const { data, error } = await (createAdminClient() as unknown as RpcClient).rpc(
      'fn_plan_create_simple_template_exclusive',
      {
        p_mission_id: parsed.data.mission_id,
        p_title: title,
        p_frequency: parsed.data.frequency,
        p_slots: t.slots,
        p_planned_start_hhmm: t.planned_start_hhmm,
        p_planned_end_hhmm: t.planned_end_hhmm,
        p_day_of_week:
          parsed.data.frequency === 'weekly' ? (parsed.data.day_of_week ?? null) : null,
        p_day_of_month:
          parsed.data.frequency === 'monthly' ? (parsed.data.day_of_month ?? null) : null,
        p_starts_on: parsed.data.starts_on,
        p_ends_on: parsed.data.ends_on ?? null,
        p_created_by: access.userId,
        p_confirm_replace_cycle: parsed.data.confirm_replace_cycle ?? false,
      },
    )
    if (error) throw new Error(error.message)
    const templateId = (data as { template_id?: string } | null)?.template_id
    if (!templateId) throw new Error('Création de récurrence impossible')

    await logAuditEvent({
      userId: access.userId,
      entityType: 'mission',
      entityId: parsed.data.mission_id,
      action: 'created',
      metadata: {
        kind: 'intervention_template',
        template_id: templateId,
        frequency: parsed.data.frequency,
        slots: parsed.data.slots,
        replaced_cycle: parsed.data.confirm_replace_cycle ?? false,
      },
    })

    // La fiche mission est LE lieu du rythme désormais ; le contrat n'est
    // revalidé que s'il existe (il n'est plus un prérequis).
    revalidatePath(`/missions/${parsed.data.mission_id}`)
    revalidatePath('/missions')
    if (parsed.data.contract_id) {
      revalidatePath(`/contracts/${parsed.data.contract_id}/missions/${parsed.data.mission_id}/edit`)
    }

    return { ok: true, templateId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création récurrence'
    if (isReplaceCycleRequired(msg)) {
      return {
        ok: false,
        error: 'Cette mission utilise déjà un roulement. Confirmez le remplacement pour créer ce rythme simple.',
        conflict: 'replace_cycle_with_simple',
      }
    }
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// Update — Slice 6.5
// ----------------------------------------------------------------------------

const updateRecurrenceSchema = z
  .object({
    templateId: z.string().uuid(),
    contract_id: z.string().uuid().optional(),
    title: z.string().min(1).max(200).optional(),
    frequency: frequencySchema,
    day_of_week: z.number().int().min(1).max(7).nullable().optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    slots: z.array(slotSchema).max(3).default([]),
    planned_start_hhmm: z.string().regex(hhmmRe, 'Heure invalide (HH:MM)').optional(),
    planned_end_hhmm: z.string().regex(hhmmRe, 'Heure invalide (HH:MM)').optional(),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
    // « Jusqu'à quand ? » — la colonne existait depuis la mig 021 et n'était
    // écrite NULLE PART. Un rythme sans fin est un rythme qu'on n'ose pas créer.
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis').nullable().optional(),
    confirm_replace_cycle: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ends_on && data.ends_on < data.starts_on) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fin ne peut pas précéder le début', path: ['ends_on'] })
    }
    if (data.planned_start_hhmm && data.planned_end_hhmm && data.planned_end_hhmm <= data.planned_start_hhmm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "L'heure de fin doit être après le début", path: ['planned_end_hhmm'] })
    }
    if (data.frequency === 'weekly' && (data.day_of_week === null || data.day_of_week === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quel jour de la semaine ?',
        path: ['day_of_week'],
      })
    }
    if (data.frequency === 'monthly' && (data.day_of_month === null || data.day_of_month === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quel jour du mois ?',
        path: ['day_of_month'],
      })
    }
  })

export interface UpdateRecurrenceInput {
  templateId: string
  contract_id?: string
  title?: string
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'one_shot'
  day_of_week?: number | null
  day_of_month?: number | null
  slots: ('morning' | 'afternoon' | 'evening')[]
  planned_start_hhmm?: string
  planned_end_hhmm?: string
  starts_on: string
  ends_on?: string | null
  confirm_replace_cycle?: boolean
}

export type UpdateRecurrenceResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string; conflict?: 'replace_cycle_with_simple' }

/**
 * Modifie une récurrence existante. Les interventions déjà générées par
 * l'ancien template ne sont PAS supprimées (historique immuable). Seules
 * les futures générations refléteront les nouveaux paramètres.
 */
export async function updateRecurrenceAction(
  input: UpdateRecurrenceInput
): Promise<UpdateRecurrenceResult> {
  const parsed = updateRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTemplate(parsed.data.templateId)
  if (!existing) return { ok: false, error: REFUS }

  // PLAN-SEC-1 FINAL : le template ne porte pas de site_id — la mission
  // RÉELLE de CE template persisté est chargée pour le dériver, jamais un
  // contract_id client. Template/Mission introuvable ou accès refusé
  // renvoient le MÊME message.
  const mission = await getMission(existing.mission_id)
  if (!mission) return { ok: false, error: REFUS }

  const access = await requireSiteWriteAccess(mission.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: REFUS }

  const title = (parsed.data.title?.trim() || existing.title).slice(0, 200)

  try {
    const t = deriveTimeFields(parsed.data.planned_start_hhmm, parsed.data.planned_end_hhmm, parsed.data.slots)
    const { error } = await (createAdminClient() as unknown as RpcClient).rpc(
      'fn_plan_update_simple_template_exclusive',
      {
        p_template_id: parsed.data.templateId,
        p_title: title,
        p_frequency: parsed.data.frequency,
        p_slots: t.slots,
        p_planned_start_hhmm: t.planned_start_hhmm,
        p_planned_end_hhmm: t.planned_end_hhmm,
        p_day_of_week:
          parsed.data.frequency === 'weekly' ? (parsed.data.day_of_week ?? null) : null,
        p_day_of_month:
          parsed.data.frequency === 'monthly' ? (parsed.data.day_of_month ?? null) : null,
        p_starts_on: parsed.data.starts_on,
        p_ends_on: parsed.data.ends_on ?? null,
        p_actor_id: access.userId,
        p_confirm_replace_cycle: parsed.data.confirm_replace_cycle ?? false,
      },
    )
    if (error) throw new Error(error.message)

    await logAuditEvent({
      userId: access.userId,
      entityType: 'mission',
      entityId: existing.mission_id,
      action: 'updated',
      metadata: {
        kind: 'intervention_template',
        template_id: parsed.data.templateId,
        frequency: parsed.data.frequency,
        slots: parsed.data.slots,
        replaced_cycle: parsed.data.confirm_replace_cycle ?? false,
      },
    })

    revalidatePath(`/missions/${existing.mission_id}`)
    revalidatePath('/missions')
    if (parsed.data.contract_id) {
      revalidatePath(`/contracts/${parsed.data.contract_id}/missions/${existing.mission_id}/edit`)
    }

    return { ok: true, templateId: parsed.data.templateId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur modification récurrence'
    if (isReplaceCycleRequired(msg)) {
      return {
        ok: false,
        error: 'Cette mission utilise déjà un roulement. Confirmez le remplacement pour enregistrer ce rythme simple.',
        conflict: 'replace_cycle_with_simple',
      }
    }
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// Archive — Slice 6.5
// ----------------------------------------------------------------------------

const archiveRecurrenceSchema = z.object({
  templateId: z.string().uuid(),
  contract_id: z.string().uuid().optional(),
})

export interface ArchiveRecurrenceInput {
  templateId: string
  contract_id?: string
}

export type ArchiveRecurrenceResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Archive (soft-delete) une récurrence. Les interventions déjà générées sont
 * conservées dans tous les cas (historique immuable). Les futures générations
 * ne créeront plus d'interventions à partir de cette récurrence.
 */
export async function archiveRecurrenceAction(
  input: ArchiveRecurrenceInput
): Promise<ArchiveRecurrenceResult> {
  const parsed = archiveRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTemplate(parsed.data.templateId)
  if (!existing) return { ok: false, error: REFUS }

  // PLAN-SEC-1 FINAL : le template ne porte pas de site_id — la mission
  // RÉELLE de CE template persisté est chargée pour le dériver, jamais un
  // contract_id client. Template/Mission introuvable ou accès refusé
  // renvoient le MÊME message.
  const mission = await getMission(existing.mission_id)
  if (!mission) return { ok: false, error: REFUS }

  const access = await requireSiteWriteAccess(mission.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: REFUS }

  try {
    await archiveTemplate(parsed.data.templateId)

    await logAuditEvent({
      userId: access.userId,
      entityType: 'mission',
      entityId: existing.mission_id,
      action: 'soft_deleted',
      metadata: {
        kind: 'intervention_template',
        template_id: parsed.data.templateId,
      },
    })

    revalidatePath(`/missions/${existing.mission_id}`)
    revalidatePath('/missions')
    if (parsed.data.contract_id) {
      revalidatePath(`/contracts/${parsed.data.contract_id}/missions/${existing.mission_id}/edit`)
    }

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur archivage récurrence"
    return { ok: false, error: msg }
  }
}
