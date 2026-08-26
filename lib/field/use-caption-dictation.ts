'use client'

// Dictée de légende photo — modalité de saisie partagée par les deux points
// d'entrée (juste après la prise, dans le triage). Un seul micro à la fois :
// enregistre → transcrit → rend le texte brut à l'appelant, qui décide où
// l'attacher (client_uuid post-shutter, capture_id triage). Ne crée jamais de
// visit_capture, ne détecte jamais « quelle photo » — l'appelant sait déjà.
//
// Arrêt automatique sur silence (Vincent, lot post-shutter rework 2026-08-24) :
// analyse RMS du flux micro (Web Audio), jamais un service externe. Le
// décompte de silence ne démarre qu'APRÈS une première parole détectée — sans
// ça, le silence initial (le temps de trouver ses mots) couperait la dictée
// avant qu'elle commence. Web Audio indisponible (navigateur restreint) :
// dégradation silencieuse, seul l'arrêt manuel reste possible.

import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeDictationAction } from '@/app/(field)/m/site/[siteId]/capture-actions'

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error'

const SILENCE_TIMEOUT_MS = 2500
const SILENCE_RMS_THRESHOLD = 0.02

export function useCaptionDictation(siteId: string) {
  const [state, setState] = useState<DictationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startingRef = useRef(false)
  const stoppingRef = useRef(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const silenceRafRef = useRef<number | null>(null)
  const hasSpokenRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const autoStopCallbackRef = useRef<((text: string | null) => void) | null>(null)

  const stopRef = useRef<() => Promise<string | null>>(async () => null)

  const stopSilenceWatch = useCallback(() => {
    if (silenceRafRef.current != null) cancelAnimationFrame(silenceRafRef.current)
    silenceRafRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { /* déjà fermé — sans gravité */ })
      audioCtxRef.current = null
    }
  }, [])

  const startSilenceWatch = useCallback((stream: MediaStream) => {
    const AudioCtxCtor = typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
    if (!AudioCtxCtor) return
    try {
      const ctx = new AudioCtxCtor()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      audioCtxRef.current = ctx
      hasSpokenRef.current = false
      silenceStartRef.current = null
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        if (!audioCtxRef.current) return
        analyser.getByteTimeDomainData(data)
        let sumSquares = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sumSquares += v * v
        }
        const rms = Math.sqrt(sumSquares / data.length)
        const now = Date.now()
        if (rms > SILENCE_RMS_THRESHOLD) {
          hasSpokenRef.current = true
          silenceStartRef.current = null
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current == null) {
            silenceStartRef.current = now
          } else if (now - silenceStartRef.current > SILENCE_TIMEOUT_MS) {
            const cb = autoStopCallbackRef.current
            void stopRef.current().then((text) => cb?.(text))
            return
          }
        }
        silenceRafRef.current = requestAnimationFrame(tick)
      }
      silenceRafRef.current = requestAnimationFrame(tick)
    } catch {
      // Analyse silence indisponible — dictée toujours utilisable manuellement.
    }
  }, [])

  // Garde anti double-tap : un enregistrement déjà en cours (ou en cours de
  // démarrage) ignore un second appel plutôt que d'en superposer un autre.
  // Retourne `false` si le micro n'a pas pu démarrer — l'appelant ne doit pas
  // se fier à son propre état React (stale dans la même fonction async).
  // `onAutoStop` : appelé UNIQUEMENT si l'arrêt vient du silence détecté (pas
  // de doublon avec le retour de `stop()` sur un arrêt manuel).
  const start = useCallback(async (onAutoStop?: (text: string | null) => void): Promise<boolean> => {
    if (startingRef.current || recorderRef.current) return false
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      streamRef.current = stream
      chunksRef.current = []
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
      recorderRef.current = rec
      rec.start()
      setError(null)
      setState('recording')
      autoStopCallbackRef.current = onAutoStop ?? null
      startSilenceWatch(stream)
      return true
    } catch {
      setError('Micro indisponible')
      setState('error')
      return false
    } finally {
      startingRef.current = false
    }
  }, [startSilenceWatch])

  // Annule un enregistrement EN COURS (navigation, fermeture) — aucune
  // transcription déclenchée, aucun texte rendu. Sans effet une fois transcrit.
  const cancel = useCallback(() => {
    stopSilenceWatch()
    autoStopCallbackRef.current = null
    const rec = recorderRef.current
    if (rec) {
      rec.ondataavailable = null
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    stoppingRef.current = false
    setState('idle')
  }, [stopSilenceWatch])

  // Arrête, transcrit, renvoie le texte (trim). null = rien d'utilisable
  // (silence, échec STT, coupure réseau) — jamais bloquant pour l'appelant.
  const stop = useCallback((): Promise<string | null> => {
    stopSilenceWatch()
    if (stoppingRef.current) return Promise.resolve(null)
    return new Promise((resolve) => {
      const rec = recorderRef.current
      if (!rec || rec.state === 'inactive') { resolve(null); return }
      stoppingRef.current = true
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const mime = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        recorderRef.current = null
        chunksRef.current = []
        stoppingRef.current = false
        if (blob.size === 0) { setState('idle'); resolve(null); return }
        setState('transcribing')
        try {
          const fd = new FormData()
          fd.set('site_id', siteId)
          fd.set('audio', new File([blob], 'dictation.webm', { type: mime }))
          const res = await transcribeDictationAction(fd)
          if (!res.ok || !res.text) {
            setState(res.ok ? 'idle' : 'error')
            if (!res.ok) setError(res.error)
            resolve(null)
            return
          }
          setState('idle')
          resolve(res.text)
        } catch {
          setError('Transcription indisponible')
          setState('error')
          resolve(null)
        }
      }
      rec.stop()
    })
  }, [siteId, stopSilenceWatch])

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  return { state, error, start, stop, cancel }
}
