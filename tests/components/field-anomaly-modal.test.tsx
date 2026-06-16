import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnomalyModal } from '@/app/(field)/m/intervention/[id]/anomaly-modal'
import { INDUSTRY_TEMPLATES } from '@/lib/catalog/industry-templates'

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
    // Catégories pilotées par le catalogue (template cleaning = parité historique).
    const categories = (INDUSTRY_TEMPLATES.cleaning.anomaly_category ?? []).map((c) => ({
      key: c.key, label: c.label, icon: c.icon ?? null,
    }))
    render(<AnomalyModal interventionId="int-1" open onClose={() => {}} categories={categories} />)

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
