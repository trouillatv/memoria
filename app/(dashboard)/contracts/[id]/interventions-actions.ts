'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createIntervention, bulkInsertChecklistItems } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import type { ChecklistTemplateItem } from '@/types/db'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const createInterventionSchema = z.object({
  mission_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
})

export async function createInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  // Allow plain ISO without TZ (datetime-local input gives e.g. '2026-05-15T08:00')
  const scheduled_at_raw = formData.get('scheduled_at') as string
  const scheduled_at_iso = scheduled_at_raw.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(scheduled_at_raw)
    ? scheduled_at_raw
    : `${scheduled_at_raw}:00.000Z`

  const parsed = createInterventionSchema.safeParse({
    mission_id: formData.get('mission_id'),
    scheduled_at: scheduled_at_iso,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const mission = await getMission(parsed.data.mission_id)
  if (!mission) return { error: 'Mission introuvable' }

  // Create intervention
  const interventionId = await createIntervention({
    mission_id: parsed.data.mission_id,
    scheduled_at: parsed.data.scheduled_at,
    created_by: auth.userId,
  })

  // Materialize checklist items from mission's default_checklist (template → instance)
  const template = (mission.default_checklist ?? []) as ChecklistTemplateItem[]
  if (template.length > 0) {
    await bulkInsertChecklistItems(template.map((item, idx) => ({
      intervention_id: interventionId,
      engagement_id: item.engagement_id ?? null,
      label: item.label,
      position: item.position ?? idx + 1,
      required: item.required ?? false,
    })))
  }

  // Get contract_id for revalidation (through mission → site → contract)
  const supabase = await createServerClient()
  const { data: site } = await supabase.from('sites').select('contract_id').eq('id', mission.site_id).maybeSingle()
  if (site?.contract_id) {
    revalidatePath(`/contracts/${site.contract_id}/interventions`)
  }

  return { ok: true as const, interventionId }
}
