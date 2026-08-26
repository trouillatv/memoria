// Micro juste après le shutter — écran unique (Vincent, rework 2026-08-26) :
// « Continuer » ne doit jamais bloquer l'agent (test #9), la légende ne
// s'attache QUE si un texte a été dicté (test #1/#8), toujours sur le
// `client_uuid` de LA capture qui vient d'être prise (test #2/#3/#4), et deux
// captures traitées en parallèle ne doivent jamais mélanger leurs légendes
// (test #7 — non-fuite entre deux instances montées simultanément).
// « Reprendre » annule la capture (retake) et « GPS ±… » ouvre la correction
// d'emplacement uniquement quand une position exploitable existe.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

const appendCaptionByClientUuidAction = vi.fn()
const correctCaptureLocationByClientUuidAction = vi.fn()
const revertCaptureLocationByClientUuidAction = vi.fn()
vi.mock('@/app/(field)/m/site/[siteId]/capture-actions', () => ({
  appendCaptionByClientUuidAction: (...args: unknown[]) => appendCaptionByClientUuidAction(...args),
  correctCaptureLocationByClientUuidAction: (...args: unknown[]) => correctCaptureLocationByClientUuidAction(...args),
  revertCaptureLocationByClientUuidAction: (...args: unknown[]) => revertCaptureLocationByClientUuidAction(...args),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

// `dictation.state`/`error` ne pilotent plus l'écran (le composant garde sa
// propre phase locale) — seuls start/stop/cancel comptent ici. `start` renvoie
// `true` par défaut (micro disponible) et retient le callback d'arrêt
// automatique passé par le composant, pour que les tests puissent simuler un
// arrêt déclenché par le silence sans jamais appeler `stop` eux-mêmes.
let lastAutoStop: ((text: string | null) => void) | null = null
const dictationMock = {
  state: 'idle' as const,
  error: null as string | null,
  start: vi.fn(async (onAutoStop?: (text: string | null) => void) => {
    lastAutoStop = onAutoStop ?? null
    return true
  }),
  stop: vi.fn(async () => null as string | null),
  cancel: vi.fn(),
}
vi.mock('@/lib/field/use-caption-dictation', () => ({
  useCaptionDictation: () => dictationMock,
}))

vi.mock('@/components/LocationCorrectionMap', () => ({
  LocationCorrectionMap: () => null,
}))

import { PostShutterDictation } from '@/app/(field)/m/site/[siteId]/PostShutterDictation'

const GPS_SUCCESS = { status: 'success' as const, lat: -22.27, lng: 166.44, accuracyM: 11, altitudeM: 24 }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  lastAutoStop = null
  dictationMock.stop.mockResolvedValue(null)
  appendCaptionByClientUuidAction.mockResolvedValue({ ok: true, captureId: 'cap-1', body: 'texte' })
})

describe('PostShutterDictation', () => {
  it('« Continuer » sans dicter : ferme immédiatement, aucune attache déclenchée (test #1)', () => {
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByText('Continuer'))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(dictationMock.start).not.toHaveBeenCalled()
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalled()
  })

  it('« Décrire » puis retap du micro : attache la légende dictée à LA bonne capture (test #2)', async () => {
    dictationMock.stop.mockResolvedValue('Fissure au plafond')
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-42" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={onDone} />)

    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('Écoute…'))
    })

    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledWith({
      client_uuid: 'uuid-42',
      text: 'Fissure au plafond',
    }))
  })

  it('transcription vide : aucune modification envoyée (test #8)', async () => {
    dictationMock.stop.mockResolvedValue(null)
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Écoute…')) })
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalled()
  })

  it('coupure réseau à l’attachement : la capture reste, le parcours n’est jamais bloqué (test #9)', async () => {
    dictationMock.stop.mockResolvedValue('Fissure au plafond')
    appendCaptionByClientUuidAction.mockResolvedValue({ ok: false, error: 'Réseau coupé' })
    const onDone = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Écoute…')) })
    // L'agent n'est jamais coincé : Continuer reste disponible pendant que
    // l'attachement retente encore en fond (backoff réel jusqu'à ~4,5 s).
    fireEvent.click(screen.getByText('Continuer'))
    expect(onDone).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toastError).toHaveBeenCalled(), { timeout: 8000 })
  }, 10000)

  it('deux instances successives (deux photos) n’attachent jamais l’une sur l’autre (test #3/#4)', async () => {
    dictationMock.stop.mockResolvedValue('Photo un')
    const { unmount } = render(<PostShutterDictation siteId="site-1" clientUuid="uuid-photo-1" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Écoute…')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenLastCalledWith({ client_uuid: 'uuid-photo-1', text: 'Photo un' }))
    unmount()

    dictationMock.stop.mockResolvedValue('Photo deux')
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-photo-2" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Écoute…')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenLastCalledWith({ client_uuid: 'uuid-photo-2', text: 'Photo deux' }))
    expect(appendCaptionByClientUuidAction).toHaveBeenCalledTimes(2)
  })

  it('deux captures en cours de traitement SIMULTANÉMENT : chaque légende reste attachée à son propre client_uuid (test #7)', async () => {
    // Deux instances montées en même temps (capture 1 encore en train de
    // transcrire pendant que capture 2 démarre déjà sa propre dictée) — le seul
    // scénario où une fuite de fermeture (closure capturant le mauvais
    // clientUuid) pourrait se produire.
    let resolveStop1: ((text: string | null) => void) | null = null
    const stop1 = new Promise<string | null>((resolve) => { resolveStop1 = resolve })
    dictationMock.stop.mockReturnValueOnce(stop1)

    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-A" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    const [describeA] = screen.getAllByText('Décrire')
    fireEvent.click(describeA)
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByText('Écoute…').length).toBe(1))
    fireEvent.click(screen.getAllByText('Écoute…')[0])
    // capture A est maintenant en 'transcribing', en attente de resolveStop1

    dictationMock.stop.mockResolvedValueOnce('Texte B')
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-B" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    const describeButtons = screen.getAllByText('Décrire')
    fireEvent.click(describeButtons[describeButtons.length - 1])
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByText('Écoute…').length).toBe(1))
    await act(async () => { fireEvent.click(screen.getAllByText('Écoute…')[0]) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledWith({ client_uuid: 'uuid-B', text: 'Texte B' }))

    await act(async () => { resolveStop1?.(null) })
    // Capture A n'a jamais rien à dicter (transcription vide) : aucune attache
    // supplémentaire ne doit apparaître, et surtout jamais sur uuid-B.
    expect(appendCaptionByClientUuidAction).toHaveBeenCalledTimes(1)
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalledWith(expect.objectContaining({ client_uuid: 'uuid-A' }))
  })

  it('ne crée jamais de visit_capture — seule l’action d’attache par client_uuid est appelée (test #11)', async () => {
    dictationMock.stop.mockResolvedValue('Texte dicté')
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-1" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Écoute…')) })
    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledTimes(1))
    // Aucune autre action (upload/création de capture) n'est disponible dans ce module.
  })

  it('arrêt automatique sur silence : attache la légende exactement comme un arrêt manuel', async () => {
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-silence" previewUrl={null} gpsInfo={undefined} onRetake={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    expect(lastAutoStop).not.toBeNull()

    await act(async () => { lastAutoStop?.('Dicté puis silence') })

    await waitFor(() => expect(appendCaptionByClientUuidAction).toHaveBeenCalledWith({
      client_uuid: 'uuid-silence',
      text: 'Dicté puis silence',
    }))
    // Retombe en phase idle : le micro redevient « Décrire », pas coincé sur « Écoute… ».
    await waitFor(() => expect(screen.getByText('Décrire')).toBeTruthy())
  })

  it('« Reprendre » annule un enregistrement en cours et délègue au parent, sans attacher de légende', async () => {
    const onRetake = vi.fn()
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-retake" previewUrl="blob:preview" gpsInfo={undefined} onRetake={onRetake} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('Décrire'))
    await waitFor(() => expect(dictationMock.start).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Écoute…')).toBeTruthy())

    fireEvent.click(screen.getByText('Reprendre'))

    expect(dictationMock.cancel).toHaveBeenCalledTimes(1)
    expect(onRetake).toHaveBeenCalledWith('uuid-retake', 'blob:preview')
    expect(appendCaptionByClientUuidAction).not.toHaveBeenCalled()
  })

  it('chip GPS : position exploitable → texte formaté et tappable', () => {
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-gps" previewUrl={null} gpsInfo={GPS_SUCCESS} onRetake={vi.fn()} onDone={vi.fn()} />)
    const chip = screen.getByText('📍 GPS ±11 m · Alt. ~24 m')
    expect(chip).not.toBeDisabled()
  })

  it('chip GPS : pas de position exploitable → libellé neutre, non tappable', () => {
    render(<PostShutterDictation siteId="site-1" clientUuid="uuid-nogps" previewUrl={null} gpsInfo={{ status: 'unavailable', lat: null, lng: null, accuracyM: null, altitudeM: null }} onRetake={vi.fn()} onDone={vi.fn()} />)
    const chip = screen.getByText('📍 Localisation indisponible')
    expect(chip).toBeDisabled()
  })
})
