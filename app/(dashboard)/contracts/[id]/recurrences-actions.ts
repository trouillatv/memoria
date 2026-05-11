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
import { createTemplate } from '@/lib/db/intervention-templates'
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

const createRecurrenceSchema = z
  .object({
    mission_id: z.string().uuid(),
    contract_id: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    frequency: frequencySchema,
    day_of_week: z.number().int().min(1).max(7).nullable().optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    slots: z.array(slotSchema).max(3).default([]),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  })
  .superRefine((data, ctx) => {
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
  contract_id: string
  title?: string
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'one_shot'
  day_of_week?: number | null
  day_of_month?: number | null
  slots: ('morning' | 'afternoon' | 'evening')[]
  starts_on: string
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

  try {
    const tpl = await createTemplate({
      mission_id: parsed.data.mission_id,
      title,
      frequency: parsed.data.frequency,
      slots: parsed.data.slots.length > 0 ? parsed.data.slots : null,
      day_of_week:
        parsed.data.frequency === 'weekly' ? (parsed.data.day_of_week ?? null) : null,
      day_of_month:
        parsed.data.frequency === 'monthly' ? (parsed.data.day_of_month ?? null) : null,
      starts_on: parsed.data.starts_on,
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

    revalidatePath(
      `/contracts/${parsed.data.contract_id}/missions/${parsed.data.mission_id}/edit`
    )

    return { ok: true, templateId: tpl.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur création récurrence'
    return { ok: false, error: msg }
  }
}
