'use client'

// Dictée de légende photo — modalité de saisie partagée par les deux points
// d'entrée (juste après la prise, dans le triage). Un seul micro à la fois :
// enregistre → transcrit → rend le texte brut à l'appelant, qui décide où
// l'attacher (client_uuid post-shutter, capture_id triage). Ne crée jamais de
// visit_capture, ne détecte jamais « quelle photo » — l'appelant sait déjà.

import { useCallback, useRef, useState } from 'react'
import { transcribeDictationAction } from '@/app/(field)/m/site/[siteId]/capture-actions'

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error'

export function useCaptionDictation(siteId: string) {
  const [state, setState] = useState<DictationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startingRef = useRef(false)

  // Garde anti double-tap : un enregistrement déjà en cours (ou en cours de
  // démarrage) ignore un second appel plutôt que d'en superposer un autre.
  // Retourne `false` si le micro n'a pas pu démarrer — l'appelant ne doit pas
  // se fier à son propre état React (stale dans la même fonction async).
  const start = useCallback(async (): Promise<boolean> => {
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
      return true
    } catch {
      setError('Micro indisponible')
      setState('error')
      return false
    } finally {
      startingRef.current = false
    }
  }, [])

  // Annule un enregistrement EN COURS (navigation, fermeture) — aucune
  // transcription déclenchée, aucun texte rendu. Sans effet une fois transcrit.
  const cancel = useCallback(() => {
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
    setState('idle')
  }, [])

  // Arrête, transcrit, renvoie le texte (trim). null = rien d'utilisable
  // (silence, échec STT, coupure réseau) — jamais bloquant pour l'appelant.
  const stop = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current
      if (!rec || rec.state === 'inactive') { resolve(null); return }
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const mime = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        recorderRef.current = null
        chunksRef.current = []
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
  }, [siteId])

  return { state, error, start, stop, cancel }
}
