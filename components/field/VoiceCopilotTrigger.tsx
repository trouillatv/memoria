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

      const tracks = stream.getAudioTracks()
      const track = tracks[0]
      if (track) {
        console.log('[Voice] track_info enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState, 'label:', track.label)
      } else {
        console.warn('[Voice] no_audio_track_found — stream has 0 audio tracks')
      }

      const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
      const supportedMime = MIME_CANDIDATES.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? ''
      console.log('[Voice] getUserMedia_ok mime_elected:', supportedMime || '(browser default)')

      const recorderOpts = supportedMime ? { mimeType: supportedMime } : undefined
      const recorder = new MediaRecorder(stream, recorderOpts)
      console.log('[Voice] recorder_created mimeType:', recorder.mimeType)
      chunksRef.current = []
      startTimeRef.current = Date.now()

      recorder.ondataavailable = (e) => {
        console.log('[Voice] data_available chunk.size:', e.data.size, 'chunk.type:', e.data.type)
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const audioDurationMs = Date.now() - startTimeRef.current
        const totalChunks = chunksRef.current.length
        console.log('[Voice] recorder_stopped audioDurationMs:', audioDurationMs, 'chunks:', totalChunks)
        const blobType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: blobType })
        console.log('[Voice] blob_ready size:', blob.size, 'type:', blob.type, 'durationMs:', audioDurationMs)
        if (blob.size === 0) {
          console.error('[Voice] blob_empty — no audio data captured')
          setErrorMsg('Aucun audio capturé — réessayez')
          setState('error')
          return
        }
        await sendForTranscription(blob, blobType, audioDurationMs)
      }

      recorderRef.current = recorder
      recorder.start()
      console.log('[Voice] recording_started')
      setState('recording')
    } catch (err) {
      console.error('[Voice] getUserMedia_error:', err)
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

  async function sendForTranscription(blob: Blob, mimeType: string, durationMs: number) {
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      console.log('[Voice] upload_started size:', blob.size, 'type:', mimeType, 'ext:', ext, 'durationMs:', durationMs)
      const form = new FormData()
      form.append('audio', blob, `voice.${ext}`)
      form.append('siteId', siteId)

      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      console.log('[Voice] upload_response status:', res.status)

      if (!res.ok) {
        const body = await res.text()
        console.error('[Voice] upload_error body:', body)
        let code = `HTTP_${res.status}`
        try { const j = JSON.parse(body); code = j.code ?? code } catch { /* raw body */ }
        setErrorMsg(`Erreur serveur (${code})`)
        setState('error')
        return
      }

      const data = (await res.json()) as { text?: string; error?: string; code?: string }
      console.log('[Voice] transcription_text_len:', data.text?.length ?? 0, 'preview:', data.text?.slice(0, 60))

      if (!data.text?.trim()) {
        console.warn('[Voice] transcription_empty — server returned no text')
        setErrorMsg("Je n'ai rien entendu — réessayez plus près du téléphone")
        setState('error')
        return
      }

      console.log('[Voice] transcription_ready — calling onTranscriptionReady')
      setState('idle')
      onTranscriptionReady(data.text.trim())
    } catch (err) {
      console.error('[Voice] send_error:', err)
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
        aria-label={`Erreur : ${errorMsg}. Appuyer pour réessayer.`}
        className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-red-300 dark:border-red-800 px-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
      >
        <Mic className="h-4 w-4 shrink-0" />
        <span className="max-w-[100px] text-[11px] font-medium leading-tight">{errorMsg}</span>
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
