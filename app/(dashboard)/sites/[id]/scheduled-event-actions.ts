'use server'

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { startScheduledEvent } from '@/lib/db/scheduled-events'

export async function startScheduledEventAction(eventId: string, siteId: string) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const orgIds = await getOrgIdsOfUser().catch(() => [] as string[])
  const orgId = orgIds[0] ?? null

  const result = await startScheduledEvent(eventId, { userId: user.id, orgId })
  if (!result.ok) throw new Error(result.error)

  const reportId = result.value?.reportId
  if (reportId) {
    redirect(`/sites/${siteId}/visites/${reportId}`)
  } else {
    redirect(`/sites/${siteId}?tab=planning`)
  }
}
