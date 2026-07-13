'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  addCompanyToIntervention,
  removeCompanyFromIntervention,
} from '@/lib/db/intervention-companies'
import { requireOwned } from '@/lib/auth/ownership'
import type { UserRole } from '@/types/db'

async function requireManagerOrAdmin(): Promise<
  { userId: string; role: UserRole; organizationId: string | null } | { error: string }
> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  const sb = createAdminClient()
  const { data: profile } = await sb
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()
  return { userId: user.id, role, organizationId: profile?.organization_id ?? null }
}

const addSchema = z.object({
  intervention_id: z.string().uuid(),
  company_name: z.string().min(1).max(200),
  role_description: z.string().max(100).optional(),
})

export async function addCompanyAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = addSchema.safeParse({
    intervention_id: formData.get('intervention_id'),
    company_name: String(formData.get('company_name') ?? '').trim(),
    role_description: String(formData.get('role_description') ?? '').trim() || undefined,
  })
  if (!parsed.success) return { error: 'Données invalides' }

  // Lot S : l'intervention porteuse doit être de mon organisation.
  const owned = await requireOwned(auth.role, 'interventions', parsed.data.intervention_id)
  if (!owned.allowed) return { error: owned.error }

  await addCompanyToIntervention({
    interventionId: parsed.data.intervention_id,
    companyName: parsed.data.company_name,
    roleDescription: parsed.data.role_description,
    createdBy: auth.userId,
    organizationId: auth.organizationId ?? undefined,
  })

  revalidatePath(`/interventions/${parsed.data.intervention_id}`)
  return {}
}

export async function removeCompanyAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const companyId = String(formData.get('company_id') ?? '')
  const interventionId = String(formData.get('intervention_id') ?? '')
  if (!companyId || !interventionId) return { error: 'Paramètres manquants' }

  const owned = await requireOwned(auth.role, 'interventions', interventionId)
  if (!owned.allowed) return { error: owned.error }

  await removeCompanyFromIntervention(companyId)

  revalidatePath(`/interventions/${interventionId}`)
  return {}
}
