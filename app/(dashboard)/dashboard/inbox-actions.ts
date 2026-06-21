'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { markInboxSeen } from '@/lib/db/inbox-feed'

/** « Tout marquer comme vu » — avance last_seen_at de l'utilisateur courant. */
export async function markInboxSeenAction(): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  await markInboxSeen(user.id)
  revalidatePath('/dashboard')
  return { ok: true }
}
