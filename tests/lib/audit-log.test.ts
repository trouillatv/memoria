import { describe, it, expect, vi, beforeEach } from 'vitest'

// On mock @/lib/db/activity-logs avant l'import du module audit
vi.mock('@/lib/db/activity-logs', () => ({
  insertActivityLog: vi.fn(),
}))

import { insertActivityLog } from '@/lib/db/activity-logs'
import { logAuditEvent } from '@/lib/audit/log'

describe('logAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appelle insertActivityLog avec les bons paramètres', async () => {
    await logAuditEvent({
      userId: 'user-1',
      entityType: 'mission',
      entityId: 'mission-1',
      action: 'closed',
      metadata: { closed_with_deviation: true },
    })

    expect(insertActivityLog).toHaveBeenCalledWith({
      userId: 'user-1',
      entityType: 'mission',
      entityId: 'mission-1',
      action: 'closed',
      metadata: { closed_with_deviation: true },
    })
  })

  it('ne casse pas le flow métier si l\'insertion log échoue', async () => {
    vi.mocked(insertActivityLog).mockRejectedValueOnce(new Error('DB down'))

    // Doit résoudre, pas throw
    await expect(
      logAuditEvent({
        userId: 'user-1',
        entityType: 'user',
        entityId: 'u-2',
        action: 'role_changed',
      })
    ).resolves.toBeUndefined()
  })

  it('passe metadata vide si non fourni', async () => {
    await logAuditEvent({
      userId: null,
      entityType: 'user',
      entityId: 'u-1',
      action: 'soft_deleted',
    })

    expect(insertActivityLog).toHaveBeenCalledWith({
      userId: null,
      entityType: 'user',
      entityId: 'u-1',
      action: 'soft_deleted',
      metadata: undefined,
    })
  })
})
