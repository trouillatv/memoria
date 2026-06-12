'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { generateQrToken, revokeQrToken } from '@/lib/db/site-qr'

export async function activateQrAction(siteId: string): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    throw new Error('Forbidden')
  }
  await generateQrToken(siteId, user.id)
  revalidatePath(`/sites/${siteId}/qr`)
}

export async function revokeQrAction(siteId: string): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    throw new Error('Forbidden')
  }
  await revokeQrToken(siteId)
  revalidatePath(`/sites/${siteId}/qr`)
}
