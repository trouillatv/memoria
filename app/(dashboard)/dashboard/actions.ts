'use server'

import { revalidatePath } from 'next/cache'
import { requireSiteActionWriteAccess } from '@/lib/auth/site-write-access'
import { markSiteActionDone } from '@/lib/db/site-actions'

export async function completeDashboardAction(actionId: string, siteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireSiteActionWriteAccess(actionId)
  if (!access.ok) return { ok: false, error: 'Accès refusé' }
  try {
    await markSiteActionDone(actionId, undefined, access.userId)
    revalidatePath('/dashboard')
    revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Impossible de clôturer cette action' }
  }
}
