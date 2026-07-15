import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  getCurrentUserWithProfile: vi.fn(),
  getOrgId: vi.fn(),
  createSite: vi.fn(),
  createSiteAction: vi.fn(),
  revalidatePath: vi.fn(),
  logUsageEvent: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/db/users', () => ({
  getCurrentUserWithProfile: mocks.getCurrentUserWithProfile,
  getOrgId: mocks.getOrgId,
}))

vi.mock('@/lib/db/sites', () => ({
  createSite: mocks.createSite,
}))

vi.mock('@/lib/db/site-actions', () => ({
  createSiteAction: mocks.createSiteAction,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/services/ai/tracking', () => ({
  logAIUsageDirect: mocks.logUsageEvent,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import { createQuickActionAction } from '@/app/(dashboard)/actions/actions'

describe('createQuickActionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserWithProfile.mockResolvedValue({
      id: 'user-1',
      role: 'manager',
      organization_id: 'org-1',
    })
    mocks.getOrgId.mockResolvedValue('org-1')
    mocks.createSite.mockResolvedValue('site-1')
    mocks.createSiteAction.mockResolvedValue('action-1')
    mocks.createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { organization_id: 'org-1', deleted_at: null } }),
          }),
        }),
      }),
    })
  })

  it('pose created_from=actions_list quand le flux rapide ne fournit rien', async () => {
    const siteId = randomUUID()
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('title', 'Action rapide')

    const result = await createQuickActionAction(fd)

    expect(result).toEqual({ ok: true, id: 'action-1' })
    expect(mocks.createSiteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: siteId,
        title: 'Action rapide',
        created_from: 'actions_list',
      }),
    )
  })
})
