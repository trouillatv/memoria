// Slice B.1 — Tests composant ProofPhotoGrid.
//
// Tests :
//   1. 0 photo → ne rend pas de listitem
//   2. 3 photos → 3 buttons rendus
//   3. Click thumbnail → dialog modal visible
//   4. Click sur le bouton close → modal ferme
//   5. Badge "Anomalie" visible sur photo kind='anomaly'

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProofPhotoGrid } from '@/app/(dashboard)/preuves/[id]/ProofPhotoGrid'
import type { ProofPhoto } from '@/lib/db/proofs'

function makePhoto(overrides: Partial<ProofPhoto> = {}): ProofPhoto {
  return {
    id: overrides.id ?? 'photo-1',
    url: overrides.url ?? 'https://example.com/photo.jpg',
    caption: overrides.caption ?? null,
    taken_at: overrides.taken_at ?? '2026-05-01T09:00:00.000Z',
    intervention_id: overrides.intervention_id ?? 'int-1',
    checklist_item_id: overrides.checklist_item_id ?? null,
    anomaly_id: overrides.anomaly_id ?? null,
    kind: overrides.kind ?? 'proof',
  }
}

describe('ProofPhotoGrid', () => {
  it('0 photo → ne rend aucun listitem', () => {
    const { container } = render(<ProofPhotoGrid photos={[]} />)
    // Le composant retourne null quand vide.
    expect(container.firstChild).toBeNull()
  })

  it('3 photos → 3 buttons rendus dans la grid', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    const buttons = screen.getAllByRole('listitem')
    expect(buttons.length).toBe(3)
  })

  it('click sur thumbnail → modal dialog visible avec full-size', () => {
    const photos = [makePhoto({ id: 'p1', caption: 'Une photo' })]
    render(<ProofPhotoGrid photos={photos} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('listitem'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('click sur bouton fermer → modal disparaît', () => {
    const photos = [makePhoto({ id: 'p1' })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getByRole('listitem'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Fermer'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('photo kind=anomaly → badge "Anomalie" visible', () => {
    const photos = [makePhoto({ id: 'p1', kind: 'anomaly' })]
    render(<ProofPhotoGrid photos={photos} />)
    expect(screen.getByText('Anomalie')).toBeInTheDocument()
  })

  it('photo kind=proof → pas de badge anomalie', () => {
    const photos = [makePhoto({ id: 'p1', kind: 'proof' })]
    render(<ProofPhotoGrid photos={photos} />)
    expect(screen.queryByText('Anomalie')).toBeNull()
  })
})
