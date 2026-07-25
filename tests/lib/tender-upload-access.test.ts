import { describe, expect, it } from 'vitest'
import { canAccessTenderForUpload } from '@/lib/tenders/upload-access'

describe('canAccessTenderForUpload', () => {
  it('autorise un dossier de l’organisation active', () => {
    expect(canAccessTenderForUpload(
      { organization_id: 'org-demo', created_by: 'other-user', deleted_at: null },
      'current-user',
      ['org-demo'],
    )).toBe(true)
  })

  it('refuse un dossier hors périmètre ou supprimé', () => {
    expect(canAccessTenderForUpload(
      { organization_id: 'org-other', created_by: 'other-user', deleted_at: null },
      'current-user',
      ['org-demo'],
    )).toBe(false)
    expect(canAccessTenderForUpload(
      { organization_id: 'org-demo', created_by: 'current-user', deleted_at: '2026-07-25T00:00:00Z' },
      'current-user',
      ['org-demo'],
    )).toBe(false)
  })
})
