'use server'

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  getCopilotInteractionDetail,
  type CopilotInteractionDetail,
} from '@/lib/db/copilot-interactions-read'

export async function fetchInteractionDetail(id: string): Promise<CopilotInteractionDetail | null> {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role !== 'admin') redirect('/missions')
  return getCopilotInteractionDetail(id)
}
