'use server'

import { revalidatePath } from 'next/cache'
import { confirmSubjectLink, rejectSubjectLink } from '@/lib/db/subject-thread-links'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export async function confirmLinkAction(
  linkId: string,
  siteId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getCurrentUserWithProfile()
    if (!user) return { ok: false, error: 'Non authentifié' }
    await confirmSubjectLink(linkId, user.id)
    revalidatePath(`/sites/${siteId}/subjects`)
    revalidatePath(`/sites/${siteId}/historique`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function rejectLinkAction(
  linkId: string,
  siteId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await rejectSubjectLink(linkId)
    revalidatePath(`/sites/${siteId}/subjects`)
    revalidatePath(`/sites/${siteId}/historique`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
