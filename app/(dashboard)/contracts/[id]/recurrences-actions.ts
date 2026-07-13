'use server'

// Phase 6 — Récurrence simple — Slice 6.2
//
// Server actions pour création de récurrences (intervention templates).
// Wording interne: "template" (helpers DB) ; UX externe: "récurrence".

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { getMission } from '@/lib/db/missions'
import { slotFromUtcHour } from '@/lib/time/prestation-slot'
import {
  archiveTemplate,
  createTemplate,
  getTemplate,
  updateTemplate,
} from '@/lib/db/intervention-templates'
import { logAuditEvent } from '@/lib/audit/log'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const frequencySchema = z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'one_shot'])
const slotSchema = z.enum(['morning', 'afternoon', 'evening'])
const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/

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
}

export type CreateRecurrenceResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string }

export async function createRecurrenceAction(
  input: CreateRecurrenceInput
): Promise<CreateRecurrenceResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = createRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  // Garantit que la mission existe (et défaut titre)
  const mission = await getMission(parsed.data.mission_id)
  if (!mission) return { ok: false, error: 'Mission introuvable' }

  const title = (parsed.data.title?.trim() || mission.name).slice(0, 200)
  const t = deriveTimeFields(parsed.data.planned_start_hhmm, parsed.data.planned_end_hhmm, parsed.data.slots)

  try {
    const tpl = await createTemplate({
      mission_id: parsed.data.mission_id,
      title,
      frequency: parsed.data.frequency,
      slots: t.slots,
      planned_start_hhmm: t.planned_start_hhmm,
      planned_end_hhmm: t.planned_end_hhmm,
      day_of_week:
        parsed.data.frequency === 'weekly' ? (parsed.data.day_of_week ?? null) : null,
      day_of_month:
        parsed.data.frequency === 'monthly' ? (parsed.data.day_of_month ?? null) : null,
      starts_on: parsed.data.starts_on,
      ends_on: parsed.data.ends_on ?? null,
      created_by: auth.userId,
    })

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: parsed.data.mission_id,
      action: 'created',
      metadata: {
        kind: 'intervention_template',
        template_id: tpl.id,
        frequency: parsed.data.frequency,
        slots: parsed.data.slots,
      },
    })

    // La fiche mission est LE lieu du rythme désormais ; le contrat n'est
    // revalidé que s'il existe (il n'est plus un prérequis).
    revalidatePath(`/missions/${parsed.data.mission_id}`)
    revalidatePath('/missions')
    if (parsed.data.contract_id) {
      revalidatePath(`/contracts/${parsed.data.contract_id}/missions/${parsed.data.mission_id}/edit`)
    }

    return { ok: true, templateId: tpl.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création récurrence'
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
}

export type UpdateRecurrenceResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string }

/**
 * Modifie une récurrence existante. Les interventions déjà générées par
 * l'ancien template ne sont PAS supprimées (historique immuable). Seules
 * les futures générations refléteront les nouveaux paramètres.
 */
export async function updateRecurrenceAction(
  input: UpdateRecurrenceInput
): Promise<UpdateRecurrenceResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = updateRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTemplate(parsed.data.templateId)
  if (!existing) return { ok: false, error: 'Récurrence introuvable' }

  const title = (parsed.data.title?.trim() || existing.title).slice(0, 200)

  try {
    const t = deriveTimeFields(parsed.data.planned_start_hhmm, parsed.data.planned_end_hhmm, parsed.data.slots)
    const updated = await updateTemplate(parsed.data.templateId, {
      title,
      frequency: parsed.data.frequency,
      slots: t.slots,
      planned_start_hhmm: t.planned_start_hhmm,
      planned_end_hhmm: t.planned_end_hhmm,
      day_of_week:
        parsed.data.frequency === 'weekly' ? (parsed.data.day_of_week ?? null) : null,
      day_of_month:
        parsed.data.frequency === 'monthly' ? (parsed.data.day_of_month ?? null) : null,
      starts_on: parsed.data.starts_on,
      ends_on: parsed.data.ends_on ?? null,
    })

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: existing.mission_id,
      action: 'updated',
      metadata: {
        kind: 'intervention_template',
        template_id: updated.id,
        frequency: parsed.data.frequency,
        slots: parsed.data.slots,
      },
    })

    revalidatePath(`/missions/${existing.mission_id}`)
    revalidatePath('/missions')
    if (parsed.data.contract_id) {
      revalidatePath(`/contracts/${parsed.data.contract_id}/missions/${existing.mission_id}/edit`)
    }

    return { ok: true, templateId: updated.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur modification récurrence'
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
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = archiveRecurrenceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const existing = await getTemplate(parsed.data.templateId)
  if (!existing) return { ok: false, error: 'Récurrence introuvable' }

  try {
    await archiveTemplate(parsed.data.templateId)

    await logAuditEvent({
      userId: auth.userId,
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
