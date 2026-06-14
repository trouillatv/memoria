'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { revokeInterventionToken } from '@/lib/db/intervention-tokens'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

export async function revokeTokenAction(
  tokenId: string,
  interventionId: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { error: auth.error }

  try {
    await revokeInterventionToken(tokenId, auth.userId)
  } catch {
    return { error: 'Erreur lors de la révocation du lien' }
  }

  revalidatePath(`/interventions/${interventionId}`)
  return { ok: true }
}
