// Slice B.2 — Tests composant ProofPhotoGrid (grid + lightbox).
//
// Tests existants (B.1) :
//   1. 0 photo → ne rend pas de listitem
//   2. 3 photos → 3 buttons rendus
//   3. Click thumbnail → dialog modal visible
//   4. Click sur le bouton close → modal ferme
//   5. Badge "Anomalie" visible sur photo kind='anomaly'
//   6. Pas de badge si kind='proof'
//
// Tests étendus B.2 — lightbox :
//   7. Indicateur "1 / N" visible à l'ouverture
//   8. ArrowRight → photo suivante
//   9. ArrowLeft → photo précédente
//  10. Escape → modal ferme
//  11. ArrowRight sur dernière photo → reste sur la dernière (pas de wrap)
//  12. ArrowLeft sur première photo → reste sur la première
//  13. Caption visible si photo.caption présent
//  14. Caption absente si photo.caption null
//  15. Bouton ChevronLeft hidden sur première photo
//  16. Bouton ChevronRight hidden sur dernière photo

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

  // -- B.2 lightbox tests ----------------------------------------------------

  it('ouverture lightbox → indicateur "1 / N" visible', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('ArrowRight keydown → passe à la photo suivante', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('ArrowLeft keydown → revient à la photo précédente', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[1])
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('Escape keydown → modal ferme', () => {
    const photos = [makePhoto({ id: 'p1' }), makePhoto({ id: 'p2' })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ArrowRight sur dernière photo → reste sur la dernière (pas de wrap)', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[2])
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('ArrowLeft sur première photo → reste sur la première (pas de wrap)', () => {
    const photos = [
      makePhoto({ id: 'p1' }),
      makePhoto({ id: 'p2' }),
      makePhoto({ id: 'p3' }),
    ]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('caption présente → visible dans la lightbox', () => {
    const photos = [makePhoto({ id: 'p1', caption: 'Robinet réparé' })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getByRole('listitem'))
    // La caption apparaît en bas de la lightbox.
    expect(screen.getByText('Robinet réparé')).toBeInTheDocument()
  })

  it('caption null → pas de bloc caption dans la lightbox', () => {
    const photos = [makePhoto({ id: 'p1', caption: null })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getByRole('listitem'))
    const dialog = screen.getByRole('dialog')
    // Aucun élément texte autre que l'indicateur "1 / 1" + alt "Photo 1".
    // On vérifie négativement : pas de div avec bg-black/40 (le bloc caption).
    expect(dialog.querySelector('.bg-black\\/40')).toBeNull()
  })

  it('première photo → bouton ChevronLeft absent, ChevronRight présent', () => {
    const photos = [makePhoto({ id: 'p1' }), makePhoto({ id: 'p2' })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(screen.queryByLabelText('Photo précédente')).toBeNull()
    expect(screen.getByLabelText('Photo suivante')).toBeInTheDocument()
  })

  it('dernière photo → bouton ChevronRight absent, ChevronLeft présent', () => {
    const photos = [makePhoto({ id: 'p1' }), makePhoto({ id: 'p2' })]
    render(<ProofPhotoGrid photos={photos} />)
    fireEvent.click(screen.getAllByRole('listitem')[1])
    expect(screen.queryByLabelText('Photo suivante')).toBeNull()
    expect(screen.getByLabelText('Photo précédente')).toBeInTheDocument()
  })
})
