import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnomalyModal } from '@/app/(field)/m/intervention/[id]/anomaly-modal'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/app/(field)/m/intervention/[id]/actions', () => ({
  createAnomalyMobileAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/app/(field)/m/intervention/[id]/photo-capture-button', () => ({
  PhotoCaptureButton: () => <button type="button">Prendre une photo</button>,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('AnomalyModal', () => {
  it('shows the chantier incident categories on mobile', () => {
    render(<AnomalyModal interventionId="int-1" open onClose={() => {}} />)

    for (const label of [
      'Accès impossible',
      'Eau coupée',
      'Électricité coupée',
      'Zone non prête',
      'Matériel manquant',
      'Danger / sécurité',
      'Livraison problème',
      'Autre',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })
})
