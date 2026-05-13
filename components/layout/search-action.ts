'use server'

import { searchMemory } from '@/lib/db/memory-search'
import { getCurrentUserRole } from '@/lib/db/users'

export async function searchMemoryAction(q: string) {
  const role = await getCurrentUserRole()
  if (!role) return []
  if (role !== 'admin' && role !== 'manager') return []

  return searchMemory({ q, periodDays: 365, limit: 50 })
}
