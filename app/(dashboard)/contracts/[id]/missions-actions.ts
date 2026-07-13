'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createMission, updateMission } from '@/lib/db/missions'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const cadenceSchema = z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'on_demand'])

const checklistItemSchema = z.object({
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  engagement_id: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
  // Item « à quantité » (migration 111) : non null = on attend un compte.
  expected_qty: z.number().min(0).max(1_000_000).nullable().optional(),
})

const createMissionSchema = z.object({
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cadence: cadenceSchema,
  engagement_ids: z.array(z.string().uuid()).default([]),
  default_checklist: z.array(checklistItemSchema).default([]),
})

export async function createMissionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const engagementIdsRaw = formData.get('engagement_ids') as string
  const checklistRaw = formData.get('default_checklist') as string
  let engagement_ids: string[] = []
  let default_checklist: unknown[] = []
  try {
    engagement_ids = engagementIdsRaw ? JSON.parse(engagementIdsRaw) : []
    default_checklist = checklistRaw ? JSON.parse(checklistRaw) : []
  } catch {
    return { error: 'Invalid JSON in engagement_ids or default_checklist' }
  }

  const parsed = createMissionSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    cadence: formData.get('cadence'),
    engagement_ids,
    default_checklist,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const missionId = await createMission({
    site_id: parsed.data.site_id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    cadence: parsed.data.cadence,
    default_team: [],
    engagement_ids: parsed.data.engagement_ids,
    default_checklist: parsed.data.default_checklist.map((it, idx) => ({
      label: it.label,
      required: it.required ?? false,
      engagement_id: it.engagement_id ?? undefined,
      position: idx + 1,
      expected_qty: it.expected_qty ?? null,
    })),
    created_by: auth.userId,
  })

  // Règle d'or (lot R) : ce chemin ne revalidait RIEN — incohérent avec le
  // chemin global (/missions). La mission doit apparaître partout où elle
  // est listée, y compris le picker de /semaine.
  revalidatePath('/missions')
  revalidatePath('/semaine')

  return { ok: true as const, missionId }
}

const updateMissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  cadence: cadenceSchema.optional(),
  engagement_ids: z.array(z.string().uuid()).optional(),
  default_checklist: z.array(checklistItemSchema).optional(),
  active: z.boolean().optional(),
})

export async function updateMissionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const engagementIdsRaw = formData.get('engagement_ids') as string | null
  const checklistRaw = formData.get('default_checklist') as string | null
  let engagement_ids: string[] | undefined
  let default_checklist: unknown[] | undefined
  try {
    if (engagementIdsRaw !== null) engagement_ids = JSON.parse(engagementIdsRaw)
    if (checklistRaw !== null) default_checklist = JSON.parse(checklistRaw)
  } catch {
    return { error: 'Invalid JSON' }
  }

  const parsed = updateMissionSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name') || undefined,
    description: formData.get('description'),
    cadence: formData.get('cadence') || undefined,
    engagement_ids,
    default_checklist,
    active: formData.get('active') === 'true' ? true : formData.get('active') === 'false' ? false : undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { id, default_checklist: dc, ...rest } = parsed.data
  const patch: Record<string, unknown> = { ...rest }
  if (dc) {
    patch.default_checklist = dc.map((it, idx) => ({
      label: it.label,
      required: it.required ?? false,
      engagement_id: it.engagement_id ?? undefined,
      position: idx + 1,
      expected_qty: it.expected_qty ?? null,
    }))
  }
  await updateMission(id, patch)
  return { ok: true as const }
}
