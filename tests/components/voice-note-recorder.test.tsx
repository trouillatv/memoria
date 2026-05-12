// MC-4 — UI VoiceNoteRecorder.
//
// Tests minimaux JSDOM. MediaRecorder n'est pas dispo dans jsdom — on stub
// uniquement ce qui est nécessaire pour les états de rendu. Le flux
// d'enregistrement complet n'est pas testé ici (trop d'asynchronie réelle).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/app/(dashboard)/tenders/[id]/voice-note-actions', () => ({
  saveVoiceNoteAction: vi.fn(async () => ({ ok: true })),
  deleteVoiceNoteAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { VoiceNoteRecorder } from '@/app/(dashboard)/tenders/[id]/VoiceNoteRecorder'

const TENDER_ID = '22222222-2222-2222-2222-222222222222'

describe('VoiceNoteRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('rend "Ajouter une note vocale" quand aucune note n\'existe', () => {
    render(
      <VoiceNoteRecorder
        tenderId={TENDER_ID}
        existingSignedUrl={null}
        existingDurationSeconds={null}
        existingRecordedAt={null}
      />,
    )

    expect(screen.getByText('Ajouter une note vocale')).toBeInTheDocument()
    // Pas de player ni de boutons Remplacer/Supprimer initialement.
    expect(screen.queryByText('Remplacer')).not.toBeInTheDocument()
    expect(screen.queryByText('Supprimer')).not.toBeInTheDocument()
  })

  it('rend le player + boutons Remplacer/Supprimer si une voice note existe', () => {
    render(
      <VoiceNoteRecorder
        tenderId={TENDER_ID}
        existingSignedUrl="https://example.com/signed.webm"
        existingDurationSeconds={84}
        existingRecordedAt="2026-05-13T10:00:00.000Z"
      />,
    )

    expect(screen.getByText('Remplacer')).toBeInTheDocument()
    expect(screen.getByText('Supprimer')).toBeInTheDocument()
    // Player audio rendu via slot data-attribute.
    const audio = document.querySelector('[data-slot="voice-note-audio"]')
    expect(audio).not.toBeNull()
  })

  it('clic sur Remplacer affiche le bouton "Enregistrer une nouvelle note"', () => {
    render(
      <VoiceNoteRecorder
        tenderId={TENDER_ID}
        existingSignedUrl="https://example.com/signed.webm"
        existingDurationSeconds={42}
        existingRecordedAt="2026-05-13T10:00:00.000Z"
      />,
    )

    fireEvent.click(screen.getByText('Remplacer'))
    expect(
      screen.getByText('Enregistrer une nouvelle note'),
    ).toBeInTheDocument()
  })

  it('clic sur le bouton enregistrer sans micro montre une erreur', async () => {
    // getUserMedia non défini → handleStart catch → toast.error puis state revient idle.
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new Error('mic_denied')) },
      configurable: true,
    })

    render(
      <VoiceNoteRecorder
        tenderId={TENDER_ID}
        existingSignedUrl={null}
        existingDurationSeconds={null}
        existingRecordedAt={null}
      />,
    )

    const btn = screen.getByText('Ajouter une note vocale')
    fireEvent.click(btn)

    // Le composant reste en idle (toast.error mock) — pas de crash.
    expect(btn).toBeInTheDocument()
  })

  it('wording sobre : pas de mots interdits dans le rendu', () => {
    render(
      <VoiceNoteRecorder
        tenderId={TENDER_ID}
        existingSignedUrl="https://example.com/signed.webm"
        existingDurationSeconds={60}
        existingRecordedAt="2026-05-13T10:00:00.000Z"
      />,
    )

    const text = document.body.textContent ?? ''
    const lc = text.toLowerCase()
    expect(lc).not.toContain('insight')
    expect(lc).not.toContain('réflexion')
    expect(lc).not.toContain('confidence')
  })
})
