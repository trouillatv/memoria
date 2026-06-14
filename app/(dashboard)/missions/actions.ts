'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'

const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'on_demand'] as const

const createMissionSchema = z.object({
  site_id: z.string().uuid('Site requis'),
  name: z.string().min(1, 'Nom requis').max(200),
  cadence: z.enum(CADENCES),
  description: z.string().max(500).optional(),
})

export type CreateMissionResult = { ok: true; missionId: string } | { error: string }

export async function createMissionAction(formData: FormData): Promise<CreateMissionResult> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }

  const parsed = createMissionSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    cadence: formData.get('cadence'),
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('missions')
    .insert({
      site_id: parsed.data.site_id,
      name: parsed.data.name,
      cadence: parsed.data.cadence,
      description: parsed.data.description ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Impossible de créer la mission' }

  revalidatePath('/missions')
  return { ok: true, missionId: data.id }
}
