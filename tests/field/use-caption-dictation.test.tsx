// Hook de dictée de légende — modalité partagée post-shutter + triage.
// MediaRecorder n'existe pas dans jsdom : on stub un enregistreur minimal
// piloté par le test (comme tests/components/voice-note-recorder.test.tsx).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'

const transcribeDictationAction = vi.fn()
vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  transcribeDictationAction: (...args: unknown[]) => transcribeDictationAction(...args),
}))

import { useCaptionDictation, type DictationState } from '@/lib/field/use-caption-dictation'

// `deferOnstart` : par défaut, l'événement `onstart` (signal réel d'un
// MediaRecorder démarré) est simulé automatiquement en microtâche — les tests
// existants n'ont pas besoin de le piloter. Le mettre à `true` pour un test
// dédié qui vérifie que le hook reste en 'preparing' tant que ce signal n'a
// pas été reçu (Vincent, fix timing micro 2026-09-30).
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static deferOnstart = false
  state: 'inactive' | 'recording' = 'recording'
  mimeType = 'audio/webm'
  ondataavailable: ((ev: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onstart: (() => void) | null = null
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
    if (!FakeMediaRecorder.deferOnstart) queueMicrotask(() => this.onstart?.())
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: nextChunk })
    this.onstop?.()
  }
}

let nextChunk = new Blob(['audio-data'], { type: 'audio/webm' })
let getUserMediaMock: ReturnType<typeof vi.fn>

const holderRef: { current: ReturnType<typeof useCaptionDictation> | null } = { current: null }

function Harness({ siteId }: { siteId: string }) {
  const api = useCaptionDictation(siteId)
  useEffect(() => { holderRef.current = api })
  return <span data-testid="state">{api.state}</span>
}

function currentState(): DictationState {
  return screen.getByTestId('state').textContent as DictationState
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.deferOnstart = false
  nextChunk = new Blob(['audio-data'], { type: 'audio/webm' })
  Object.defineProperty(global, 'MediaRecorder', { value: FakeMediaRecorder, configurable: true, writable: true })
  getUserMediaMock = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream)
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: getUserMediaMock },
    configurable: true,
  })
})

describe('useCaptionDictation', () => {
  it('start() démarre l’enregistrement — un seul MediaRecorder créé', async () => {
    render(<Harness siteId="site-1" />)
    await act(async () => {
      const ok = await holderRef.current!.start()
      expect(ok).toBe(true)
    })
    expect(currentState()).toBe('recording')
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('double tap : un second start() pendant le premier est ignoré (test #10)', async () => {
    render(<Harness siteId="site-1" />)
    let results: boolean[] = []
    await act(async () => {
      results = await Promise.all([holderRef.current!.start(), holderRef.current!.start()])
    })
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  })

  it('stop() transcrit et renvoie le texte (test #2)', async () => {
    transcribeDictationAction.mockResolvedValue({ ok: true, text: 'Fissure au plafond' })
    render(<Harness siteId="site-1" />)
    await act(async () => { await holderRef.current!.start() })
    let text: string | null = null
    await act(async () => { text = await holderRef.current!.stop() })
    expect(text).toBe('Fissure au plafond')
    expect(currentState()).toBe('idle')
  })

  it('silence (blob vide) → aucune modification, transcription jamais appelée (test #8)', async () => {
    nextChunk = new Blob([], { type: 'audio/webm' })
    render(<Harness siteId="site-1" />)
    await act(async () => { await holderRef.current!.start() })
    let text: string | null = 'not-null'
    await act(async () => { text = await holderRef.current!.stop() })
    expect(text).toBeNull()
    expect(transcribeDictationAction).not.toHaveBeenCalled()
  })

  it('échec STT / coupure réseau → résout null, ne bloque jamais l’appelant (test #9)', async () => {
    transcribeDictationAction.mockResolvedValue({ ok: false, error: 'Coupure réseau' })
    render(<Harness siteId="site-1" />)
    await act(async () => { await holderRef.current!.start() })
    let text: string | null = 'not-null'
    await act(async () => { text = await holderRef.current!.stop() })
    expect(text).toBeNull()
    expect(currentState()).toBe('error')
  })

  it('cancel() en cours d’enregistrement : aucune transcription, retour à idle', async () => {
    render(<Harness siteId="site-1" />)
    await act(async () => { await holderRef.current!.start() })
    act(() => { holderRef.current!.cancel() })
    expect(currentState()).toBe('idle')
    expect(transcribeDictationAction).not.toHaveBeenCalled()
  })

  it('reste en \'preparing\' tant que l’événement onstart réel du MediaRecorder n’est pas reçu', async () => {
    FakeMediaRecorder.deferOnstart = true
    render(<Harness siteId="site-1" />)
    let startResult: Promise<boolean> = Promise.resolve(false)
    act(() => {
      startResult = holderRef.current!.start()
    })
    await waitFor(() => expect(currentState()).toBe('preparing'))
    expect(currentState()).not.toBe('recording')

    await act(async () => {
      FakeMediaRecorder.instances[0].onstart?.()
      await startResult
    })
    expect(currentState()).toBe('recording')
  })
})
