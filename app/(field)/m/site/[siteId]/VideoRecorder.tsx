'use client'

// Caméra vidéo INTÉGRÉE (MOB-VID2a) — filmer une preuve DANS MemorIA, pas via
// « Studio → Partager » (qui traverse une fonction Vercel et se fait rejeter en
// 413 dès qu'une vidéo dépasse ~4,5 Mo).
//
// Trois règles de terrain :
//   1. Séquences COURTES : 20 s maximum par clip, arrêt automatique. Une preuve
//      n'a pas besoin de durer ; plusieurs clips courts s'envoient et se
//      reprennent mieux qu'une seule vidéo fragile. La limite est PAR SÉQUENCE,
//      pas par visite — on enchaîne autant de clips qu'on veut.
//   2. Qualité MAÎTRISÉE dès la prise : 720p, débit borné. Filmer léger vaut
//      mieux que filmer en 4K puis recompresser sur l'A52 de Guillaume (batterie,
//      chauffe, mémoire).
//   3. Rien ne se coupe EN SILENCE : compte à rebours visible, avertissement à
//      5 s de la fin.
//
// Le clip fini est un `File` remis au parent (`onClip`), qui le téléverse EN
// DIRECT vers Supabase (URL signée) — jamais par le corps d'une requête Vercel.
// Repli : si la caméra in-app est indisponible (WebView restreinte, permission
// refusée, MediaRecorder absent), on bascule sur l'appareil natif.

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Video as VideoIcon, Square, Check, RotateCcw } from 'lucide-react'

/** Durée maximale d'un clip, en secondes. Limite par SÉQUENCE. */
const MAX_SECONDS = 20
/** À partir de ce temps écoulé, on prévient que ça va s'arrêter. */
const WARN_AT = MAX_SECONDS - 5
/** Débit vidéo borné (~2,5 Mb/s) : 720p net, fichier léger pour le réseau mobile. */
const VIDEO_BITS_PER_SECOND = 2_500_000
const AUDIO_BITS_PER_SECOND = 128_000

/** Le meilleur conteneur réellement supporté par CE navigateur. */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const prefs = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const m of prefs) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* isTypeSupported peut lever sur certains WebView : on continue. */
    }
  }
  return ''
}

function extFor(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type Phase = 'loading' | 'ready' | 'recording' | 'error'

export function VideoRecorder({
  onClip,
  onClose,
  onFallbackNative,
}: {
  /** Reçoit chaque séquence filmée — le parent la téléverse en direct. */
  onClip: (file: File) => void
  onClose: () => void
  /** Caméra in-app indisponible → le parent ouvre l'appareil natif. */
  onFallbackNative: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Miroir non-réactif du temps écoulé, lu dans onstop (la closure figerait l'état).
  const elapsedRef = useRef(0)

  const [phase, setPhase] = useState<Phase>('loading')
  const [clipCount, setClipCount] = useState(0)
  const [lastClipSeconds, setLastClipSeconds] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Ouverture de la caméra — une seule tentative. Échec → appareil natif.
  useEffect(() => {
    let cancelled = false
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      onFallbackNative()
      return
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        mimeRef.current = pickMimeType()
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {
            /* politique autoplay : écran noir → l'utilisateur peut fermer. */
          })
        }
        setPhase('ready')
      })
      .catch(() => {
        if (!cancelled) onFallbackNative()
      })
    return () => {
      cancelled = true
      if (tickRef.current) clearInterval(tickRef.current)
      if (autoStopRef.current) clearTimeout(autoStopRef.current)
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop()
        }
      } catch {
        /* déjà arrêté */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // onFallbackNative hors deps : une seule ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    stopTimers()
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        /* déjà arrêté */
      }
    }
  }, [stopTimers])

  const start = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    const mime = mimeRef.current
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
    } catch {
      // Un navigateur qui ouvre la caméra mais refuse MediaRecorder : repli natif.
      onFallbackNative()
      return
    }
    chunksRef.current = []
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const type = (mime || rec.mimeType || 'video/webm').split(';')[0]
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      // Un clip vide (autorisation coupée en cours) : on ne remonte rien.
      if (blob.size > 0) {
        const file = new File([blob], `sequence-${Date.now()}.${extFor(type)}`, { type })
        setLastClipSeconds(Math.max(1, Math.round(elapsedRef.current)))
        setClipCount((n) => n + 1)
        onClip(file)
      }
      setElapsed(0)
      setPhase('ready')
    }
    recorderRef.current = rec
    rec.start()
    setElapsed(0)
    elapsedRef.current = 0
    setPhase('recording')
    const startedAt = Date.now()
    tickRef.current = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000
      elapsedRef.current = s
      setElapsed(s)
    }, 200)
    autoStopRef.current = setTimeout(stop, MAX_SECONDS * 1000)
  }, [onClip, onFallbackNative, stop])

  const recording = phase === 'recording'
  const shown = Math.min(elapsed, MAX_SECONDS)
  const remaining = Math.max(0, MAX_SECONDS - shown)
  const warning = recording && shown >= WARN_AT
  const pct = Math.min(100, (shown / MAX_SECONDS) * 100)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid="video-recorder">
      {/* En-tête : ce qu'on fait + fermer. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <span className="min-w-0 truncate text-sm font-medium">
          Vidéo de preuve
          {clipCount > 0 && (
            <span className="ml-2 text-white/60">
              {clipCount} séquence{clipCount > 1 ? 's' : ''} filmée{clipCount > 1 ? 's' : ''}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          disabled={recording}
          className="shrink-0 rounded-full bg-white/10 p-2 disabled:opacity-40"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Flux caméra. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Ouverture de la caméra…
          </div>
        )}

        {/* Compte à rebours — TRÈS visible : rien ne se coupe en silence. */}
        {recording && (
          <>
            <div className="absolute left-0 right-0 top-0 h-1 bg-white/15">
              <div
                className={warning ? 'h-full bg-rose-500' : 'h-full bg-white'}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-semibold tabular-nums text-white">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500 align-middle" />
              <span className="ml-2 align-middle">
                {fmt(Math.floor(shown))} / {fmt(MAX_SECONDS)}
              </span>
            </div>
            {warning && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-rose-600/90 px-4 py-1.5 text-sm font-medium text-white">
                La vidéo s’arrêtera dans {Math.ceil(remaining)} s
              </div>
            )}
          </>
        )}

        {/* Après un clip : dire ce qui vient d'être filmé, et proposer la suite. */}
        {phase === 'ready' && clipCount > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600/90 px-4 py-1.5 text-sm font-medium text-white">
            Séquence {clipCount} enregistrée
            {lastClipSeconds != null ? ` · ${lastClipSeconds} s` : ''} — envoi en cours
          </div>
        )}
      </div>

      {/* Commandes — cibles larges (gants). */}
      <div className="flex items-center justify-between px-8 py-6">
        {/* Terminer : visible dès qu'au moins un clip est pris. */}
        {clipCount > 0 && !recording ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white"
          >
            <Check className="h-4 w-4" /> Terminer
          </button>
        ) : (
          <span className="w-[104px]" aria-hidden />
        )}

        {/* Déclencheur central : filmer / arrêter. */}
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={phase !== 'ready' && phase !== 'recording'}
          aria-label={recording ? 'Arrêter la séquence' : 'Filmer une séquence'}
          data-testid="video-record-toggle"
          className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
        >
          {recording ? (
            <Square className="h-8 w-8 fill-rose-500 text-rose-500" />
          ) : (
            <VideoIcon className="h-8 w-8 text-white" />
          )}
        </button>

        {/* Rappel discret de l'usage. */}
        {clipCount > 0 && !recording ? (
          <span className="inline-flex w-[104px] items-center justify-end gap-1 text-xs text-white/60">
            <RotateCcw className="h-3.5 w-3.5" /> Autre clip
          </span>
        ) : (
          <span className="w-[104px]" aria-hidden />
        )}
      </div>
    </div>
  )
}
