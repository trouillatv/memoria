// GhostCamera (mig 195) — wording visible « Référence », jamais Fantôme/Ghost.
// Le nom interne du composant et les commentaires de code restent autorisés
// (mandat 2026-08-24) ; seul le texte affiché à l'écran est contraint ici.
// Couvre le test obligatoire #11.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { GhostCamera } from '@/app/(field)/m/site/[siteId]/GhostCamera'

const getUserMedia = vi.fn()

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

afterEach(() => {
  // @ts-expect-error nettoyage du stub entre tests
  delete navigator.mediaDevices
})

describe('GhostCamera — wording', () => {
  it('aucun texte visible Fantôme/Ghost, wording « Référence » utilisé (test #11)', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [] })

    render(
      <GhostCamera
        ghostUrl="https://x/photo.jpg"
        label="Porte d’entrée"
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallbackNative={vi.fn()}
      />,
    )

    const root = screen.getByTestId('ghost-camera')
    expect(root.textContent).not.toMatch(/fant[oô]me/i)
    expect(root.textContent).not.toMatch(/ghost/i)
    expect(screen.getByText(/— alignez sur la référence/)).toBeInTheDocument()
    expect(screen.getByText(/Référence \d+ %|Référence masquée/)).toBeInTheDocument()
  })

  it('libellé null → repli « Photo de référence », jamais un texte Fantôme (test #11)', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [] })

    render(
      <GhostCamera
        ghostUrl="https://x/photo.jpg"
        label={null}
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallbackNative={vi.fn()}
      />,
    )

    expect(screen.getByText(/Photo de référence — alignez sur la référence/)).toBeInTheDocument()
  })

  it('getUserMedia indisponible → repli natif immédiat, sans afficher d’écran caméra (test #6)', async () => {
    // @ts-expect-error simulation d'un WebView restreint
    delete navigator.mediaDevices
    const onFallbackNative = vi.fn()

    render(
      <GhostCamera
        ghostUrl="https://x/photo.jpg"
        label="Porte d’entrée"
        onCapture={vi.fn()}
        onClose={vi.fn()}
        onFallbackNative={onFallbackNative}
      />,
    )

    expect(onFallbackNative).toHaveBeenCalledTimes(1)
  })
})
