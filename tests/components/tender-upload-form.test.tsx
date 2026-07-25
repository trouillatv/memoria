import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TenderUploadForm } from '@/app/(dashboard)/tenders/new/TenderUploadForm'
import {
  createTenderDraftAction,
  finalizeTenderUploadAction,
  uploadTenderPieceAction,
} from '@/app/(dashboard)/tenders/new/actions'

vi.mock('@/app/(dashboard)/tenders/new/actions', () => ({
  createTenderAction: vi.fn(),
  createTenderDraftAction: vi.fn(),
  uploadTenderPieceAction: vi.fn(),
  finalizeTenderUploadAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

class TestDataTransfer {
  files: File[] = []
  items = { add: (file: File) => { this.files.push(file) } }
}

vi.stubGlobal('DataTransfer', TestDataTransfer)

describe('TenderUploadForm', () => {
  it('envoie chaque pièce séparément puis finalise le dossier', async () => {
    vi.mocked(createTenderDraftAction).mockResolvedValueOnce({ ok: true, tenderId: 'tender-1' })
    const uploadOrder: string[] = []
    vi.mocked(uploadTenderPieceAction).mockImplementation(async (formData) => {
      uploadOrder.push((formData.get('file') as File).name)
      return { ok: true }
    })
    vi.mocked(finalizeTenderUploadAction).mockResolvedValueOnce({ ok: true, tenderId: 'tender-1' })

    render(<TenderUploadForm />)

    const files = [
      new File(['%PDF-1.7-1'], 'un.pdf', { type: 'application/pdf' }),
      new File(['%PDF-1.7-2'], 'deux.pdf', { type: 'application/pdf' }),
    ]
    fireEvent.change(screen.getByLabelText('Pièces du dossier'), { target: { files } })
    fireEvent.submit(screen.getByRole('button', { name: /lancer l'analyse ia/i }).closest('form')!)

    await waitFor(() => expect(finalizeTenderUploadAction).toHaveBeenCalledWith(expect.any(FormData)))
    expect(createTenderDraftAction).toHaveBeenCalledTimes(1)
    expect(uploadOrder).toEqual(['un.pdf', 'deux.pdf'])
  })

  it('quitte le mode envoi et affiche une erreur quand la Server Action échoue', async () => {
    vi.mocked(createTenderDraftAction).mockRejectedValueOnce(new Error('Erreur stockage'))

    render(<TenderUploadForm />)

    const file = new File(['%PDF-1.7'], 'dossier.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Pièces du dossier'), { target: { files: [file] } })
    fireEvent.submit(screen.getByRole('button', { name: /lancer l'analyse ia/i }).closest('form')!)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /lancer l'analyse ia/i })).toBeEnabled()
    })
    expect(screen.getByText(/erreur stockage/i)).toBeInTheDocument()
  })
})
