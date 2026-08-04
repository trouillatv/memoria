'use server'

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { startScheduledEvent } from '@/lib/db/scheduled-events'

export async function startScheduledEventAction(
  eventId: string,
  siteId: string,
  eventType: 'visit' | 'meeting' | 'inspection' | 'delivery' | 'other' = 'visit',
) {
  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) redirect('/login')

  const orgIds = await getOrgIdsOfUser().catch(() => [] as string[])
  const orgId = orgIds[0] ?? null

  const result = await startScheduledEvent(eventId, { userId: user.id, orgId })
  if (!result.ok) throw new Error(result.error)

  const reportId = result.value?.reportId
  if (reportId) {
    const reportRoute = eventType === 'meeting'
      ? `/sites/${siteId}/reunion/${reportId}`
      : `/sites/${siteId}/visites/${reportId}`
    redirect(reportRoute)
  } else {
    redirect(`/sites/${siteId}?tab=planning`)
  }
}
