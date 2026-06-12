'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { generateQrToken } from '@/lib/db/site-qr'

export async function activateQrAction(siteId: string): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    throw new Error('Forbidden')
  }
  await generateQrToken(siteId)
  revalidatePath(`/sites/${siteId}/qr`)
}
