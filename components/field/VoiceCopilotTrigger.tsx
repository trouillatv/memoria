'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, StopCircle, Loader2 } from 'lucide-react'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

interface Props {
  siteId: string
  onTranscriptionReady: (text: string) => void
  disabled?: boolean
}

export function VoiceCopilotTrigger({ siteId, onTranscriptionReady, disabled }: Props) {
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // Compteur de durée — s'arrête automatiquement hors état recording.
  useEffect(() => {
    if (state === 'recording') {
      setElapsed(0)
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [state])

  const startRecording = useCallback(async () => {
    if (disabled || state !== 'idle') return
    try {
      console.log('[Voice] getUserMedia requested')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[Voice] getUserMedia_ok')

      const recorder = new MediaRecorder(stream)
      console.log('[Voice] recorder_started mimeType:', recorder.mimeType)
      chunksRef.current = []
      startTimeRef.current = Date.now()

      recorder.ondataavailable = (e) => {
        console.log('[Voice] data_available blob.size:', e.data.size)
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const audioDurationMs = Date.now() - startTimeRef.current
        console.log('[Voice] recorder_stopped audioDurationMs:', audioDurationMs)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        console.log('[Voice] blob ready size:', blob.size, 'type:', blob.type)
        await sendForTranscription(blob, recorder.mimeType || 'audio/webm')
      }

      recorderRef.current = recorder
      recorder.start()
      setState('recording')
    } catch (err) {
      console.error('[Voice] getUserMedia error:', err)
      setErrorMsg('Microphone non accessible')
      setState('error')
    }
  }, [disabled, state, siteId])

  const stopRecording = useCallback(() => {
    console.log('[Voice] stop_requested recorder.state:', recorderRef.current?.state)
    if (recorderRef.current?.state === 'recording') {
      setState('transcribing')
      recorderRef.current.stop()
    }
  }, [])

  async function sendForTranscription(blob: Blob, mimeType: string) {
    try {
      console.log('[Voice] transcribe_request_started')
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')
      form.append('siteId', siteId)

      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      console.log('[Voice] transcribe_response status:', res.status)

      if (!res.ok) {
        const body = await res.text()
        console.error('[Voice] transcribe_error body:', body)
        throw new Error(`HTTP ${res.status}`)
      }

      const data = (await res.json()) as { text?: string; error?: string }
      console.log('[Voice] transcription_ready:', data.text?.slice(0, 80))

      if (!data.text?.trim()) {
        setErrorMsg('Audio non compris — réessayez')
        setState('error')
        return
      }

      setState('idle')
      onTranscriptionReady(data.text.trim())
    } catch (err) {
      console.error('[Voice] voice_error:', err)
      setErrorMsg('Transcription impossible — réessayez')
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setErrorMsg('')
    setElapsed(0)
  }

  // ── recording : indicateur clair + bouton Stop carré ──────────────────────
  if (state === 'recording') {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[12px] font-medium text-red-500 tabular-nums whitespace-nowrap animate-pulse">
          ● {elapsed}s
        </span>
        <button
          type="button"
          onClick={stopRecording}
          aria-label="Arrêter l'enregistrement"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white active:bg-red-600"
        >
          <StopCircle className="h-4 w-4" />
        </button>
      </div>
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
        aria-label={`Erreur : ${errorMsg}. Appuyer pour réessayer.`}
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
