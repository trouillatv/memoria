'use server'

// Actions du bandeau de notifications (socle mig 159).
import { markNotificationRead } from '@/lib/db/notifications'

export async function dismissNotificationAction(id: string): Promise<void> {
  await markNotificationRead(id)
}
