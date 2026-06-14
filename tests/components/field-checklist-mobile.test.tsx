import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChecklistMobile } from '@/app/(field)/m/intervention/[id]/checklist-mobile'
import type { DbInterventionChecklistItem } from '@/types/db'

const { toggleMock, toastError } = vi.hoisted(() => ({
  toggleMock: vi.fn<(formData: FormData) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  toastError: vi.fn(),
}))

vi.mock('@/app/(field)/m/intervention/[id]/actions', () => ({
  toggleChecklistItemMobileAction: (formData: FormData) => toggleMock(formData),
  deletePhotoMobileAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/field/use-photo-uploader', () => ({
  usePhotoUploader: () => ({ pendingCount: 0 }),
}))

vi.mock('@/lib/field/photo-queue', () => ({
  listQueuedPhotosByIntervention: vi.fn(async () => []),
  blobToDataUrl: vi.fn(async () => ''),
}))

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}))

function makeItem(overrides: Partial<DbInterventionChecklistItem> = {}): DbInterventionChecklistItem {
  return {
    id: 'task-1',
    intervention_id: 'int-1',
    engagement_id: null,
    label: 'Nettoyer l’entrée',
    position: 1,
    required: true,
    done: false,
    done_at: null,
    done_by: null,
    ...overrides,
  }
}

describe('ChecklistMobile', () => {
  beforeEach(() => {
    toggleMock.mockClear()
    toastError.mockClear()
  })

  it('prevents task clicks before the intervention is started and explains what to do', async () => {
    render(
      <ChecklistMobile
        interventionId="int-1"
        items={[makeItem()]}
        serverPhotos={[]}
        signedUrls={{}}
        canEdit={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /nettoyer l’entrée/i }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Démarrez l’intervention avant de cocher les tâches.')
    })
    expect(toggleMock).not.toHaveBeenCalled()
  })

  it('still toggles tasks once the intervention is started', async () => {
    render(
      <ChecklistMobile
        interventionId="int-1"
        items={[makeItem()]}
        serverPhotos={[]}
        signedUrls={{}}
        canEdit
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /nettoyer l’entrée/i }))

    await waitFor(() => {
      expect(toggleMock).toHaveBeenCalledTimes(1)
    })
    expect(toastError).not.toHaveBeenCalled()
  })
})
