'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createIntervention, bulkInsertChecklistItems } from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { slotFromUtcHour } from '@/lib/time/prestation-slot'
import { requireOwned } from '@/lib/auth/ownership'
import type { ChecklistTemplateItem, UserRole } from '@/types/db'

async function requireManagerOrAdmin(): Promise<{ userId: string; role: UserRole } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id, role }
}

const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/
const createInterventionSchema = z
  .object({
    mission_id: z.string().uuid(),
    scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date attendu YYYY-MM-DD'),
    // V6.2 — heure précise (début + fin obligatoires), plus de créneau saisi.
    planned_start_hhmm: z.string().regex(hhmmRe, 'Heure de début invalide (HH:MM)'),
    planned_end_hhmm: z.string().regex(hhmmRe, 'Heure de fin invalide (HH:MM)'),
  })
  .refine((d) => d.planned_end_hhmm > d.planned_start_hhmm, {
    message: "L'heure de fin doit être après le début",
    path: ['planned_end_hhmm'],
  })

export async function createInterventionAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createInterventionSchema.safeParse({
    mission_id: formData.get('mission_id'),
    scheduled_for: formData.get('scheduled_for'),
    planned_start_hhmm: formData.get('planned_start_hhmm'),
    planned_end_hhmm: formData.get('planned_end_hhmm'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // Lot S : on ne planifie pas sur la mission d'un autre tenant.
  const owned = await requireOwned(auth.role, 'missions', parsed.data.mission_id)
  if (!owned.allowed) return { error: owned.error }

  const mission = await getMission(parsed.data.mission_id)
  if (!mission) return { error: 'Mission introuvable' }

  // V6.2 — slot dérivé de l'heure de début (grille + cohérence vues). L'heure
  // précise écrase l'ancrage côté createIntervention.
  const slot = slotFromUtcHour(Number(parsed.data.planned_start_hhmm.slice(0, 2)))
  const interventionId = await createIntervention({
    mission_id: parsed.data.mission_id,
    scheduled_for: parsed.data.scheduled_for,
    slot,
    planned_start_hhmm: parsed.data.planned_start_hhmm,
    planned_end_hhmm: parsed.data.planned_end_hhmm,
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
      expected_qty: item.expected_qty ?? null,
    })))
  }

  // Get contract_id for revalidation (through mission → site → contract)
  const supabase = await createServerClient()
  const { data: site } = await supabase.from('sites').select('contract_id').eq('id', mission.site_id).maybeSingle()
  if (site?.contract_id) {
    revalidatePath(`/contracts/${site.contract_id}/interventions`)
  }
  // Doctrine (audit/09) : une mutation rafraîchit toutes les vues concernées —
  // l'intervention créée ici apparaît aussi dans la semaine et les missions.
  revalidatePath('/semaine')
  revalidatePath('/missions')

  return { ok: true as const, interventionId }
}
