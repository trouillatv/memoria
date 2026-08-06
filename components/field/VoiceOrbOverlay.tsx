'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'

type OrbPhase = 'idle' | 'entering' | 'listening' | 'transcribing' | 'error' | 'exiting'

interface Props {
  open: boolean
  siteId: string
  siteName?: string
  onResult: (text: string) => void
  onClose: () => void
}

// Tone de bienvenue généré par Web Audio API — aucun fichier externe.
// Deux AudioContext distincts : un pour le son d'activation (court, fermé
// immédiatement), un pour l'AnalyserNode qui vit pendant toute la capture.
function playActivationCue() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(900, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.07, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.25)
    setTimeout(() => ctx.close().catch(() => {}), 600)
  } catch { /* AudioContext non disponible ou mute */ }
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(20)
  } catch { /* vibrate non disponible (iOS) */ }
}

export function VoiceOrbOverlay({ open, siteId, siteName, onResult, onClose }: Props) {
  // Ref pour éviter les fermetures stales dans les effets liés à open.
  const [phase, _setPhase] = useState<OrbPhase>('idle')
  const phaseRef = useRef<OrbPhase>('idle')
  const setPhase = useCallback((p: OrbPhase) => { phaseRef.current = p; _setPhase(p) }, [])

  const [errorMsg, setErrorMsg]     = useState('')
  const [slowLabel, setSlowLabel]   = useState(false)
  const [reducedMotion, setReduced] = useState(false)

  const orbAudioRef  = useRef<HTMLDivElement>(null)
  const rafRef       = useRef<number | null>(null)
  const cleanupRef   = useRef<() => void>(() => {})

  // Détection de prefers-reduced-motion côté client uniquement.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const h = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  // Cycle principal : open → entering → listening ; !open → exiting → idle.
  useEffect(() => {
    if (open) {
      setErrorMsg('')
      setSlowLabel(false)
      setPhase('entering')
      const t = setTimeout(() => {
        setPhase('listening')
        void startListening()
      }, 220)
      return () => clearTimeout(t)
    } else if (phaseRef.current !== 'idle') {
      cleanupRef.current()
      setPhase('exiting')
      const t = setTimeout(() => setPhase('idle'), 250)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Label "Je prépare ça…" seulement après 800 ms — évite d'afficher plusieurs
  // micro-états quand la transcription est rapide.
  useEffect(() => {
    if (phase === 'transcribing') {
      const t = setTimeout(() => setSlowLabel(true), 800)
      return () => { clearTimeout(t); setSlowLabel(false) }
    }
    setSlowLabel(false)
  }, [phase])

  function stopAudioLoop() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    orbAudioRef.current?.style.setProperty('--audio-delta', '0')
  }

  async function startListening() {
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null

    // Cleanup mis à jour à chaque étape pour toujours refléter l'état réel.
    const doCleanup = (recorder?: MediaRecorder) => {
      stopAudioLoop()
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((t) => t.stop())
      audioCtx?.close().catch(() => {})
    }
    cleanupRef.current = () => doCleanup()

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // L'utilisateur a peut-être fermé l'orbe pendant getUserMedia.
      if (phaseRef.current === 'exiting' || phaseRef.current === 'idle') {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      playActivationCue()

      // AnalyserNode sur le même stream — MediaRecorder n'est pas perturbé.
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      // Boucle RAF : --audio-delta mis à jour directement sur le DOM (pas de re-render).
      if (!reducedMotion) {
        const buf = new Uint8Array(analyser.fftSize)
        const loop = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const n = (buf[i] - 128) / 128
            sum += n * n
          }
          const rms = Math.sqrt(sum / buf.length)
          orbAudioRef.current?.style.setProperty('--audio-delta', rms.toFixed(3))
          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      }

      const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
      const mime = MIME.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      const startMs = Date.now()

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

      recorder.onstop = async () => {
        stopAudioLoop()
        stream!.getTracks().forEach((t) => t.stop())
        audioCtx!.close().catch(() => {})
        cleanupRef.current = () => {}

        const durationMs = Date.now() - startMs
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0 || durationMs < 200) {
          setErrorMsg("Je n'ai rien entendu")
          setPhase('error')
          return
        }
        setPhase('transcribing')
        await sendForTranscription(blob, recorder.mimeType)
      }

      recorder.start()
      cleanupRef.current = () => doCleanup(recorder)

    } catch (err) {
      const e = err as Error
      const isDenied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
      setErrorMsg(isDenied ? 'Le microphone n\'est pas accessible' : 'Le microphone n\'est pas disponible')
      setPhase('error')
    }
  }

  async function sendForTranscription(blob: Blob, mimeType: string) {
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `voice.${ext}`)
      form.append('siteId', siteId)

      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      if (!res.ok) {
        setErrorMsg('La transcription n\'a pas fonctionné')
        setPhase('error')
        return
      }
      const data = await res.json() as { text?: string }
      if (!data.text?.trim()) {
        setErrorMsg("Je n'ai rien entendu")
        setPhase('error')
        return
      }
      onResult(data.text.trim())
      doExit()
    } catch {
      setErrorMsg('La transcription n\'a pas fonctionné')
      setPhase('error')
    }
  }

  function doExit() {
    setPhase('exiting')
    setTimeout(() => { setPhase('idle'); onClose() }, 260)
  }

  function handleOrbTap() {
    if (phaseRef.current === 'listening') cleanupRef.current()
  }

  function handleClose() {
    cleanupRef.current()
    doExit()
  }

  function handleRetry() {
    setErrorMsg('')
    setPhase('entering')
    setTimeout(() => { setPhase('listening'); void startListening() }, 220)
  }

  if (phase === 'idle') return null

  const visible = phase !== 'exiting'

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center select-none"
      style={{
        backgroundColor: visible ? 'rgba(5,5,15,0.58)' : 'rgba(5,5,15,0)',
        backdropFilter: `blur(${visible ? 10 : 0}px)`,
        opacity: visible ? 1 : 0,
        transition: 'background-color 0.28s ease, backdrop-filter 0.28s ease, opacity 0.25s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Bouton fermer */}
      <button
        type="button"
        onClick={handleClose}
        aria-label="Fermer"
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Nom du chantier — apparaît légèrement décalé puis remonte */}
      {siteName && (
        <p
          className="mb-8 text-[13px] font-medium text-white/45 transition-all duration-400"
          style={{ opacity: phase === 'entering' ? 0 : 0.45, transform: phase === 'entering' ? 'translateY(6px)' : 'translateY(0)' }}
        >
          {siteName}
        </p>
      )}

      {/* ── Orbe ──
          Couche 1 (button) : animation CSS breathing — deux keyframes désynchronisés.
          Couche 2 (orbAudioRef) : scale piloté par --audio-delta via RAF.
          Halos : absolute, animations propres (désynchronisées du noyau). */}
      <button
        type="button"
        onClick={handleOrbTap}
        disabled={phase !== 'listening'}
        aria-label="Toucher pour terminer"
        className={[
          'relative flex items-center justify-center cursor-default disabled:cursor-default',
          reducedMotion ? 'orb-reduced-motion' : [
            'orb-breathing',
            phase === 'transcribing' && 'orb-transcribing',
            phase === 'entering'     && 'orb-enter',
            phase === 'exiting'      && 'orb-exit',
          ].filter(Boolean).join(' '),
        ].join(' ')}
      >
        <div
          ref={orbAudioRef}
          className="orb-audio-reactive relative flex items-center justify-center"
          style={{ ['--audio-delta' as string]: '0' }}
        >
          {/* Halo externe — animation lente désynchronisée */}
          <div className={`absolute h-56 w-56 rounded-full bg-violet-400/[0.06] ${reducedMotion ? '' : 'orb-halo-a'}`} />
          {/* Halo interne — légèrement plus vif, timing différent */}
          <div className={`absolute h-40 w-40 rounded-full bg-violet-400/[0.11] ${reducedMotion ? '' : 'orb-halo-b'}`} />
          {/* Noyau — gradient MemorIA violet/indigo ; rose en état d'erreur */}
          <div
            className={[
              'relative h-28 w-28 rounded-full transition-colors duration-500',
              'shadow-[0_0_70px_rgba(139,92,246,0.50),0_0_28px_rgba(99,102,241,0.35)]',
              phase === 'error'
                ? 'bg-gradient-to-br from-rose-400 to-rose-600'
                : 'bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600',
            ].join(' ')}
          />
        </div>
      </button>

      {/* Label d'état */}
      <div className="mt-10 text-center">
        <p className="text-[16px] font-medium text-white/88 tracking-tight">
          {(phase === 'entering' || phase === 'listening') && 'MemorIA écoute…'}
          {phase === 'transcribing' && (slowLabel ? 'Je prépare ça…' : 'Je vous ai entendu…')}
          {phase === 'error' && errorMsg}
        </p>

        {phase === 'listening' && (
          <p className="mt-2 text-[12px] text-white/35">Touchez pour terminer</p>
        )}

        {phase === 'error' && (
          <button
            type="button"
            onClick={handleRetry}
            className="mt-5 rounded-full border border-white/22 px-6 py-2.5 text-[14px] font-medium text-white/80 active:bg-white/10"
          >
            Réessayer
          </button>
        )}
      </div>
    </div>
  )
}
