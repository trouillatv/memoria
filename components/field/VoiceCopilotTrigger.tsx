'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, Loader2 } from 'lucide-react'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

interface Props {
  siteId: string
  onTranscriptionReady: (text: string) => void
  disabled?: boolean
}

/**
 * Bouton micro isolé pour le Copilote vocal V1.
 *
 * États : idle → recording → transcribing → [callback onTranscriptionReady | error]
 *
 * Indépendant de CopilotMobileSheet pour permettre l'évolution vers l'appui long
 * sur le déclencheur principal sans refactoring.
 */
export function VoiceCopilotTrigger({ siteId, onTranscriptionReady, disabled }: Props) {
  const [state, setState] = useState<VoiceState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    if (disabled || state !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        await sendForTranscription(blob, recorder.mimeType || 'audio/webm')
      }

      recorderRef.current = recorder
      recorder.start()
      setState('recording')
    } catch {
      setErrorMsg('Microphone non accessible')
      setState('error')
    }
  }, [disabled, state, siteId])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      setState('transcribing')
      recorderRef.current.stop()
    }
  }, [])

  async function sendForTranscription(blob: Blob, mimeType: string) {
    try {
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')
      form.append('siteId', siteId)

      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })

      if (!res.ok) throw new Error(`${res.status}`)
      const data = (await res.json()) as { text?: string; error?: string }

      if (!data.text?.trim()) {
        setErrorMsg('Audio non compris — réessayez')
        setState('error')
        return
      }

      setState('idle')
      onTranscriptionReady(data.text.trim())
    } catch {
      setErrorMsg('Transcription impossible — réessayez')
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setErrorMsg('')
  }

  if (state === 'recording') {
    return (
      <button
        type="button"
        onClick={stopRecording}
        aria-label="Arrêter l'enregistrement"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white animate-pulse"
      >
        <Mic className="h-4 w-4" />
      </button>
    )
  }

  if (state === 'transcribing') {
    return (
      <div
        aria-label="Transcription en cours"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-950/30"
      >
        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={reset}
        title={errorMsg}
        aria-label={`Erreur vocale : ${errorMsg}. Appuyer pour réessayer.`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
      >
        <Mic className="h-4 w-4" />
      </button>
    )
  }

  // idle
  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      aria-label="Commande vocale"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-300 dark:border-violet-700 text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-40 transition-colors"
    >
      <Mic className="h-4 w-4" />
    </button>
  )
}
