// Micro juste après le shutter — Continuer/Décrire ne doit jamais bloquer
// l'agent (test #9), et n'attache la légende QUE si un texte a été dicté
// (test #1/#8), toujours sur `client_uuid` de LA capture qui vient d'être
// prise (test #2/#3/#4).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

const appendCaptionByClientUuidAction = vi.fn()
vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  appendCaptionByClientUuidAction: (...args: unknown[]) => appendCaptionByClientUuidAction(...args),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

const dictationMock = {
  state: 'idle' as const,
  error: null as string | null,
  start: vi.fn(async () => true),
  stop: vi.fn(async () => null as string | null),
  cancel: vi.fn(),
}
vi.mock('@/lib/field/use-caption-dictation', () => ({
  useCaptionDictation: () => dictationMock,
}))

import { PostShutterDictation } from '@/app/(field)/m/site/[siteId]/PostShutterDictation'

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  dictationMock.start.mockResolvedValue(true)
  dictationMock.stop.mockResolvedValue(null)
  appendCaptionByClientUuidAction.mockResolvedValue({ ok: true, captureId: 'cap-1', body: 'texte' })
})

describe('PostShutterDictation', () => {
  it('« Continuer » sans dicter : ferme immédiatement, aucune attache déclenchée (test #1)', () => {
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} onDone={onDone} />)
    fireEvent.click(screen.getByText('Continuer'))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(dictationMock.start).not.toHaveBeenCalled()
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalled()
  })

  it('« Décrire » puis « Terminer » : attache la légende dictée à LA bonne capture (test #2)', async () => {
    dictationMock.stop.mockResolvedValue('Fissure au plafond')
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-42" previewUrl={null} onDone={onDone} />)

    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))

    await act(async () => {
      fireEvent.click(screen.getByText('Terminer'))
    })

    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledWith({
      client_uuid: 'uuid-42',
      text: 'Fissure au plafond',
    }))
  })

  it('transcription vide : aucune modification envoyée (test #8)', async () => {
    dictationMock.stop.mockResolvedValue(null)
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByText('Terminer')) })
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalled()
  })

  it('coupure réseau à l’attachement : la capture reste, le parcours n’est jamais bloqué (test #9)', async () => {
    dictationMock.stop.mockResolvedValue('Fissure au plafond')
    appendCaptionByClientUuidAction.mockResolvedValue({ ok: false, error: 'Réseau coupé' })
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} onDone={onDone} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByText('Terminer')) })
    // L'écran « transcription… » propose déjà Continuer — l'agent n'est jamais coincé,
    // même si l'attachement retente encore en fond (backoff réel jusqu'à ~4,5 s).
    fireEvent.click(screen.getByText('Continuer'))
    expect(onDone).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toastError).toHaveBeenCalled(), { timeout: 8000 })
  }, 10000)

  it('deux instances successives (deux photos) n’attachent jamais l’une sur l’autre (test #3/#4)', async () => {
    dictationMock.stop.mockResolvedValue('Photo un')
    const { unmount } = render(<PostShutterDictation siteId="site-1" clientUuid="uuid-photo-1" previewUrl={null} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByText('Terminer')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenLastCalledWith({ client_uuid: 'uuid-photo-1', text: 'Photo un' }))
    unmount()

    dictationMock.stop.mockResolvedValue('Photo deux')
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-photo-2" previewUrl={null} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(2))
    await act(async () => { fireEvent.click(screen.getByText('Terminer')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenLastCalledWith({ client_uuid: 'uuid-photo-2', text: 'Photo deux' }))
    expect(appendCaptionByClientUuidAction).toHaveBeenCalledTimes(2)
  })

  it('ne crée jamais de visit_capture — seule l’action d’attache par client_uuid est appelée (test #11)', async () => {
    dictationMock.stop.mockResolvedValue('Texte dicté')
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByText('Terminer')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledTimes(1))
    // Aucune autre action (upload/création de capture) n'est disponible dans ce module.
  })
})
