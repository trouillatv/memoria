// Blob SVG du noyau vocal (mandat Vincent, GO implémentation blob organique,
// 2026-08-19) — tests composant demandés explicitement par le mandat, en plus
// des tests unitaires du module pur (tests/lib/voice-blob-shape.test.ts) :
//
//   1. un changement de phase de la machine à états fait bien varier ce que
//      le composant transmet à `computeBlobPath` (le blob « voit » la phase
//      réelle, pas une valeur figée au montage) ;
//   2. la RAF dédiée au blob (distincte de celle qui mesure l'audio, cf.
//      commentaire dans VoiceOrbOverlay.tsx) ne crée ni nouvel appel
//      `getUserMedia`, ni nouvel `AudioContext` — elle ne lit que
//      `smoothedRef.current` et n'écrit que l'attribut `d` du path ;
//   3. cette RAF est nettoyée au démontage, comme toute autre ressource du
//      composant.
//
// Ne modifie pas tests/components/voice-orb-pending-proposals.test.tsx —
// nouveau fichier, patterns (stubMicDenied/stubMatchMedia/renderOverlay)
// dupliqués localement à dessein.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { VoiceOrbContext, type PendingProposal, type VoiceOrbContextValue } from '@/app/(field)/m/VoiceOrbContext'
import { VoiceOrbOverlay } from '@/components/field/VoiceOrbOverlay'
import * as blobShape from '@/lib/voice/blob-shape'

const SITE = { id: '44444444-4444-4444-4444-444444444444', name: 'Chantier PETRO' }

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function stubMicDenied() {
  const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })))
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  return getUserMedia
}

function renderOverlay(pendingProposals: PendingProposal[] = []) {
  const value: VoiceOrbContextValue = {
    openOrb: () => {},
    pendingProposals,
    addPendingProposal: () => {},
    removePendingProposal: () => {},
    viewPendingProposal: () => {},
    registerProposalViewHandler: () => {},
  }
  return render(
    <VoiceOrbContext.Provider value={value}>
      <VoiceOrbOverlay open siteId={SITE.id} onVoiceTurn={async () => ({})} onClose={() => {}} />
    </VoiceOrbContext.Provider>,
  )
}

/** Laisse s'écouler `n` frames de la vraie RAF jsdom, sans horloge fictive. */
function waitFrames(n: number) {
  return new Promise<void>((resolve) => {
    let count = 0
    const step = () => {
      count += 1
      if (count >= n) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  stubMatchMedia()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('VoiceOrbOverlay — blob : réaction à la phase', () => {
  // Ne PAS écrire `beforeEach(stubMicDenied)` : Vitest traite la valeur
  // renvoyée par un hook comme un callback de nettoyage post-test. Comme
  // `stubMicDenied()` renvoie le mock `getUserMedia`, Vitest le RAPPELLERAIT
  // après le test — un second `Promise.reject()` jamais attrapé, détecté
  // comme rejet non géré et faussement imputé au test suivant.
  beforeEach(() => { stubMicDenied() })

  it('la RAF dédiée transmet la phase réelle de la machine à computeBlobPath, pas une valeur figée', async () => {
    const spy = vi.spyOn(blobShape, 'computeBlobPath')
    renderOverlay()

    // entering (montage) → error (micro refusé) : une vraie transition de la
    // machine à états, pas une manipulation artificielle du composant.
    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())
    await waitFrames(3)

    const phasesSeen = new Set(spy.mock.calls.map(([input]) => input.phase))
    expect(phasesSeen.has('error')).toBe(true)
    expect(phasesSeen.size).toBeGreaterThan(1)
  })
})

describe('VoiceOrbOverlay — blob : aucune ressource audio supplémentaire', () => {
  it('aucun nouvel appel getUserMedia déclenché par la boucle du blob', async () => {
    const getUserMedia = stubMicDenied()
    renderOverlay()

    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())
    await waitFrames(5)

    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('aucun AudioContext créé par la boucle du blob (micro refusé → pipeline audio jamais atteint)', async () => {
    stubMicDenied()
    const audioContextCtor = vi.fn()
    class FakeAudioContext {
      constructor() { audioContextCtor() }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    renderOverlay()

    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())
    await waitFrames(5)

    expect(audioContextCtor).not.toHaveBeenCalled()
  })
})

describe('VoiceOrbOverlay — blob : cycle de vie de la RAF', () => {
  beforeEach(() => { stubMicDenied() })

  it('la RAF du blob est annulée au démontage', async () => {
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame')
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const { unmount } = renderOverlay()

    await waitFor(() => expect(rafSpy).toHaveBeenCalled())
    unmount()

    expect(cafSpy).toHaveBeenCalled()
  })
})
