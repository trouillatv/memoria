'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Mic, Square, Trash2, Save, X, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  saveVoiceNoteAction,
  deleteVoiceNoteAction,
} from './voice-note-actions'
import { VoiceNotePlayer } from './VoiceNotePlayer'

/**
 * Voice note DG sur AO finalisé — doctrine V5 cas validé.
 *
 * Comportements clés :
 * - Si voice note existe déjà → player + boutons "Remplacer" / "Supprimer".
 * - Sinon → bouton "Ajouter une note vocale".
 * - Pendant enregistrement : timer + bouton stop. Stop auto à 3 minutes.
 * - Preview du blob enregistré + "Sauvegarder" / "Annuler".
 *
 * Compatibilité MediaRecorder : Chrome/Edge/Firefox/Safari 14.5+.
 * Format : audio/webm préféré, audio/mp4 fallback Safari.
 *
 * Wording strictement sobre. Pas d'« insight », pas de « confidence »,
 * pas de « réflexion ». Archive personnelle, pas une conversation.
 */

const MAX_DURATION_SECONDS = 180
const MIN_DURATION_SECONDS = 1

type RecorderState =
  | { kind: 'idle' }
  | { kind: 'recording'; elapsedSeconds: number }
  | { kind: 'preview'; blob: Blob; objectUrl: string; durationSeconds: number }
  | { kind: 'saving' }

interface VoiceNoteRecorderProps {
  tenderId: string
  existingSignedUrl: string | null
  existingDurationSeconds: number | null
  existingRecordedAt: string | null
}

function pickMimeType(): { mimeType: string | undefined; extension: string } {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return { mimeType: undefined, extension: 'webm' }
  }
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm',             ext: 'webm' },
    { mime: 'audio/mp4',              ext: 'mp4'  },
    { mime: 'audio/ogg;codecs=opus',  ext: 'ogg'  },
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c.mime)) {
      return { mimeType: c.mime, extension: c.ext }
    }
  }
  return { mimeType: undefined, extension: 'webm' }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VoiceNoteRecorder({
  tenderId,
  existingSignedUrl,
  existingDurationSeconds,
  existingRecordedAt,
}: VoiceNoteRecorderProps) {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' })
  const [hasExisting, setHasExisting] = useState<boolean>(!!existingSignedUrl)
  const [isReplacing, setIsReplacing] = useState<boolean>(false)
  const [isDeletePending, startDeleteTransition] = useTransition()

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordedExtensionRef = useRef<string>('webm')

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      if (state.kind === 'preview') URL.revokeObjectURL(state.objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopTicker() {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  function teardownStream() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
    mediaRecorderRef.current = null
  }

  async function handleStart() {
    if (state.kind !== 'idle' && state.kind !== 'preview') return
    if (state.kind === 'preview') {
      URL.revokeObjectURL(state.objectUrl)
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const { mimeType, extension } = pickMimeType()
      recordedExtensionRef.current = extension
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      mr.onstop = () => {
        const elapsedMs = Date.now() - startTimeRef.current
        const durationSeconds = Math.max(
          MIN_DURATION_SECONDS,
          Math.min(MAX_DURATION_SECONDS, Math.round(elapsedMs / 1000)),
        )
        const blob = new Blob(chunksRef.current, {
          type: mimeType ?? 'audio/webm',
        })
        const objectUrl = URL.createObjectURL(blob)
        teardownStream()
        stopTicker()
        setState({ kind: 'preview', blob, objectUrl, durationSeconds })
      }

      startTimeRef.current = Date.now()
      mr.start()
      setState({ kind: 'recording', elapsedSeconds: 0 })

      tickRef.current = setInterval(() => {
        setState((s) => {
          if (s.kind !== 'recording') return s
          const next = s.elapsedSeconds + 1
          if (next >= MAX_DURATION_SECONDS) {
            // Stop auto à la limite.
            try { mr.stop() } catch { /* noop */ }
            return s
          }
          return { kind: 'recording', elapsedSeconds: next }
        })
      }, 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'mic_denied'
      toast.error(`Micro indisponible (${msg})`)
      setState({ kind: 'idle' })
    }
  }

  function handleStop() {
    if (state.kind !== 'recording') return
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      try { mr.stop() } catch { /* noop */ }
    } else {
      teardownStream()
      stopTicker()
      setState({ kind: 'idle' })
    }
  }

  function handleCancel() {
    if (state.kind === 'preview') {
      URL.revokeObjectURL(state.objectUrl)
    }
    teardownStream()
    stopTicker()
    setState({ kind: 'idle' })
    setIsReplacing(false)
  }

  async function handleSave() {
    if (state.kind !== 'preview') return
    const { blob, durationSeconds } = state
    setState({ kind: 'saving' })

    const fd = new FormData()
    fd.append('tenderId', tenderId)
    fd.append(
      'audio',
      blob,
      `voice-note.${recordedExtensionRef.current}`,
    )
    fd.append('durationSeconds', String(durationSeconds))

    const result = await saveVoiceNoteAction(fd)
    if (state.kind === 'preview') {
      URL.revokeObjectURL((state as { objectUrl: string }).objectUrl)
    }
    if (!result.ok) {
      toast.error(result.error ?? 'Échec de l\'enregistrement')
      setState({ kind: 'idle' })
      return
    }
    toast.success('Note vocale enregistrée')
    setHasExisting(true)
    setIsReplacing(false)
    setState({ kind: 'idle' })
  }

  function handleDelete() {
    if (!confirm('Supprimer la note vocale ?')) return
    startDeleteTransition(async () => {
      const r = await deleteVoiceNoteAction(tenderId)
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de la suppression')
        return
      }
      toast.success('Note vocale supprimée')
      setHasExisting(false)
      setIsReplacing(false)
    })
  }

  // =================================
  // RENDER
  // =================================

  // Cas 1 : une voice note existe ET on n'est pas en mode "Remplacer".
  if (hasExisting && !isReplacing && state.kind === 'idle') {
    return (
      <div
        className="rounded-xl border bg-card p-4 space-y-3"
        data-slot="voice-note-existing"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Mic className="h-4 w-4 text-muted-foreground" />
            Note vocale
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setIsReplacing(true)}
              data-slot="voice-note-replace"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Remplacer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={handleDelete}
              disabled={isDeletePending}
              data-slot="voice-note-delete"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {isDeletePending ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        </div>
        {existingSignedUrl && (
          <VoiceNotePlayer
            signedUrl={existingSignedUrl}
            durationSeconds={existingDurationSeconds}
            recordedAt={existingRecordedAt}
          />
        )}
      </div>
    )
  }

  // Cas 2 : preview après enregistrement.
  if (state.kind === 'preview') {
    return (
      <div
        className="rounded-xl border bg-card p-4 space-y-3"
        data-slot="voice-note-preview"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mic className="h-4 w-4 text-muted-foreground" />
          Note vocale · {formatElapsed(state.durationSeconds)}
        </div>
        <audio
          controls
          src={state.objectUrl}
          className="w-full"
          data-slot="voice-note-preview-audio"
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleCancel}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Annuler
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={handleSave}
            data-slot="voice-note-save"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Sauvegarder
          </Button>
        </div>
      </div>
    )
  }

  // Cas 3 : en cours d'enregistrement.
  if (state.kind === 'recording') {
    return (
      <div
        className="rounded-xl border bg-card p-4 space-y-3"
        data-slot="voice-note-recording"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
            </span>
            Enregistrement… {formatElapsed(state.elapsedSeconds)}
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleStop}
            data-slot="voice-note-stop"
          >
            <Square className="h-3.5 w-3.5 mr-1" />
            Arrêter
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Limite 3 minutes. Arrêt automatique à la fin.
        </p>
      </div>
    )
  }

  if (state.kind === 'saving') {
    return (
      <div
        className="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
        data-slot="voice-note-saving"
      >
        Sauvegarde en cours…
      </div>
    )
  }

  // Cas 4 (idle) : pas de voice note, ou utilisateur a cliqué "Remplacer".
  return (
    <div
      className="rounded-xl border bg-card p-4 space-y-3"
      data-slot="voice-note-idle"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mic className="h-4 w-4 text-muted-foreground" />
          Note vocale
        </div>
        {isReplacing && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setIsReplacing(false)}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Annuler
          </Button>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={handleStart}
        data-slot="voice-note-start"
      >
        <Mic className="h-3.5 w-3.5 mr-1" />
        {isReplacing ? 'Enregistrer une nouvelle note' : 'Ajouter une note vocale'}
      </Button>
    </div>
  )
}
