'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import {
  getIntervention,
  updateInterventionStatus,
  markChecklistItemDone,
} from '@/lib/db/interventions'

async function requireFieldAgent(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  // chef_equipe = production agent. admin/manager = QA on /m.
  if (role !== 'chef_equipe' && role !== 'admin' && role !== 'manager') {
    return { error: 'Forbidden' }
  }
  return { userId: user.id }
}

const idSchema = z.object({ id: z.string().uuid() })

export async function startInterventionMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const intervention = await getIntervention(parsed.data.id)
  if (!intervention) return { error: 'Intervention introuvable' }

  // Only allow start if currently planned. If already in_progress, this is a no-op success
  // (handles concurrent agent on same intervention — pas de panic, juste idempotent)
  if (intervention.status === 'planned') {
    await updateInterventionStatus(parsed.data.id, 'in_progress')
  } else if (intervention.status !== 'in_progress') {
    return { error: `Statut actuel : ${intervention.status}. Démarrage impossible.` }
  }

  revalidatePath(`/m/intervention/${parsed.data.id}`)
  revalidatePath('/m')
  return { ok: true as const }
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  done: z.boolean(),
})

export async function toggleChecklistItemMobileAction(formData: FormData) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return auth

  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    done: formData.get('done') === 'true',
  })
  if (!parsed.success) return { error: 'Invalid input' }

  if (parsed.data.done) {
    await markChecklistItemDone(parsed.data.id, auth.userId)
  } else {
    // Reset done = false (admin client — RLS still protects via the policies on intervention_checklist_items)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('intervention_checklist_items')
      .update({ done: false, done_at: null, done_by: null })
      .eq('id', parsed.data.id)
    if (error) return { error: error.message }
  }

  // Find intervention_id for revalidation
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('intervention_checklist_items')
    .select('intervention_id')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (data?.intervention_id) revalidatePath(`/m/intervention/${data.intervention_id}`)
  return { ok: true as const }
}
