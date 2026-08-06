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

// Ton de bienvenue généré par Web Audio API — aucun fichier externe.
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
  const [phase, _setPhase] = useState<OrbPhase>('idle')
  const phaseRef = useRef<OrbPhase>('idle')
  const setPhase = useCallback((p: OrbPhase) => { phaseRef.current = p; _setPhase(p) }, [])

  const [errorMsg, setErrorMsg]       = useState('')
  const [slowLabel, setSlowLabel]     = useState(false)
  const [reducedMotion, setReduced]   = useState(false)
  // Texte reconnu — affiché brièvement dans l'orbe avant fermeture.
  const [resultPreview, setResultPreview] = useState<string | null>(null)

  const orbAudioRef    = useRef<HTMLDivElement>(null)
  const haloOuterRef   = useRef<HTMLDivElement>(null)
  const rafRef         = useRef<number | null>(null)
  const cleanupRef     = useRef<() => void>(() => {})
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Lissage asymétrique du signal audio — persiste entre les frames RAF.
  const smoothedRef    = useRef(0)

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
      setResultPreview(null)
      setPhase('entering')
      const t = setTimeout(() => {
        setPhase('listening')
        void startListening()
      }, 220)
      return () => clearTimeout(t)
    } else if (phaseRef.current !== 'idle') {
      if (resultTimerRef.current) { clearTimeout(resultTimerRef.current); resultTimerRef.current = null }
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
    smoothedRef.current = 0
    orbAudioRef.current?.style.setProperty('--audio-delta', '0')
    haloOuterRef.current?.style.setProperty('--audio-delta', '0')
  }

  async function startListening() {
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null

    const doCleanup = (recorder?: MediaRecorder) => {
      stopAudioLoop()
      if (recorder?.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((t) => t.stop())
      audioCtx?.close().catch(() => {})
    }
    cleanupRef.current = () => doCleanup()

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (phaseRef.current === 'exiting' || phaseRef.current === 'idle') {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      playActivationCue()

      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      // Traitement audio — pipeline complet pour rendre la réactivité perceptible
      // sur téléphone réel où le RMS brut reste dans 0.01–0.08.
      //
      // 1. RMS sur la fenêtre temporelle (256 samples)
      // 2. Noise floor : ignorer le bruit de fond < NOISE_FLOOR
      // 3. Normalisation vers [0,1] (max RMS attendu ~MAX_EXPECTED)
      // 4. Courbe non-linéaire sqrt : amplifier les niveaux intermédiaires
      //    (voix normale → valeur normalisée ~0.4–0.7 au lieu de ~0.05)
      // 5. Smoothing asymétrique : montée rapide (ATTACK), descente douce (DECAY)
      //    → pas de tremblements, mais réaction immédiate à la voix
      //
      // --audio-delta résultant [0,1] est multiplié par les constantes CSS :
      //   core × 0.22, halo externe × 0.50
      if (!reducedMotion) {
        const NOISE_FLOOR   = 0.012
        const MAX_EXPECTED  = 0.28
        const ATTACK        = 0.80   // fraction du nouveau signal en montée
        const DECAY         = 0.14   // fraction du nouveau signal en descente

        const buf = new Uint8Array(analyser.fftSize)
        const loop = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const n = (buf[i] - 128) / 128
            sum += n * n
          }
          const rms = Math.sqrt(sum / buf.length)

          // Normalisation + courbe sqrt
          const normalized = Math.min(1, Math.max(0, (rms - NOISE_FLOOR) / (MAX_EXPECTED - NOISE_FLOOR)))
          const curved = Math.sqrt(normalized)

          // Smoothing asymétrique
          const alpha = curved > smoothedRef.current ? ATTACK : DECAY
          smoothedRef.current = alpha * curved + (1 - alpha) * smoothedRef.current

          const delta = smoothedRef.current.toFixed(3)
          orbAudioRef.current?.style.setProperty('--audio-delta', delta)
          haloOuterRef.current?.style.setProperty('--audio-delta', delta)
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

      // Flash du texte reconnu avant fermeture — moment fort de l'expérience.
      const text = data.text.trim()
      setResultPreview(text)
      resultTimerRef.current = setTimeout(() => {
        resultTimerRef.current = null
        onResult(text)
        doExit()
      }, 420)
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
    if (resultTimerRef.current) { clearTimeout(resultTimerRef.current); resultTimerRef.current = null }
    cleanupRef.current()
    doExit()
  }

  function handleRetry() {
    setErrorMsg('')
    setResultPreview(null)
    setPhase('entering')
    setTimeout(() => { setPhase('listening'); void startListening() }, 220)
  }

  if (phase === 'idle') return null

  const visible = phase !== 'exiting'

  // Classes CSS de l'orbe selon l'état.
  const orbClasses = reducedMotion
    ? 'orb-reduced-motion'
    : [
        'orb-breathing',
        phase === 'transcribing' && !slowLabel && 'orb-transcribing',
        phase === 'transcribing' && slowLabel  && 'orb-processing',
        phase === 'entering'                   && 'orb-enter',
        phase === 'exiting'                    && 'orb-exit',
      ].filter(Boolean).join(' ')

  // Style du noyau : radial-gradient centré → lumière émise de l'intérieur,
  // sans effet 3D directionnel. Rose en état d'erreur.
  const coreStyle: React.CSSProperties = {
    background: phase === 'error'
      ? 'radial-gradient(circle at 50% 42%, #fda4af, #e11d48 55%, #9f1239)'
      : 'radial-gradient(circle at 50% 42%, #ede9fe, #8b5cf6 52%, #4338ca)',
    boxShadow: phase === 'error'
      ? '0 0 40px 6px rgba(225,29,72,0.35), 0 0 80px 16px rgba(225,29,72,0.10)'
      : '0 0 40px 6px rgba(139,92,246,0.38), 0 0 80px 16px rgba(139,92,246,0.10)',
  }

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

      {/* Groupe orbe + label — légèrement au-dessus du centre (le siteName
          n'est plus au-dessus : il descend sous le label, libérant l'espace). */}
      <div style={{ marginTop: '-6vh' }} className="flex flex-col items-center">

        {/* ── Orbe ──
            Couche 1 (button) : animation CSS breathing.
            Couche 2 (haloOuterRef) : absolute, opacité animée (orb-halo-a)
              + scale audio-réactif fort (orb-halo-outer-reactive via --audio-delta).
            Couche 3 (orbAudioRef) : scale audio-réactif doux (orb-audio-reactive).
              Couche 4 (halo interne) : absolute, opacité + scale animés.
              Couche 5 (noyau) : radial-gradient centré, glow symétrique. */}
        <button
          type="button"
          onClick={handleOrbTap}
          disabled={phase !== 'listening'}
          aria-label="Toucher pour terminer"
          className={[
            'relative flex items-center justify-center cursor-default disabled:cursor-default',
            orbClasses,
          ].join(' ')}
        >
          {/* Halo externe — audio-réactif (écoute) ou circulation lente (réflexion). */}
          <div
            ref={haloOuterRef}
            className={[
              'absolute h-56 w-56 rounded-full bg-violet-400/[0.08]',
              reducedMotion ? '' :
                (phase === 'transcribing' && slowLabel)
                  ? 'orb-halo-processing'
                  : 'orb-halo-a orb-halo-outer-reactive',
            ].join(' ')}
            style={{ '--audio-delta': '0' } as React.CSSProperties}
          />

          {/* Wrapper audio-réactif doux — noyau + halo interne */}
          <div
            ref={orbAudioRef}
            className="orb-audio-reactive relative flex items-center justify-center"
            style={{ '--audio-delta': '0' } as React.CSSProperties}
          >
            {/* Halo interne */}
            <div className={`absolute h-40 w-40 rounded-full bg-violet-400/[0.14] ${reducedMotion ? '' : 'orb-halo-b'}`} />

            {/* Noyau */}
            <div
              className="relative h-28 w-28 rounded-full transition-[background] duration-500"
              style={coreStyle}
            />
          </div>
        </button>

        {/* Label d'état + siteName en dessous */}
        <div className="mt-10 text-center">
          {resultPreview ? (
            /* Flash transcription — texte reconnu visible brièvement avant fermeture. */
            <div
              className="transition-opacity duration-200"
              style={{ opacity: resultPreview ? 1 : 0 }}
            >
              <p className="text-[12px] text-white/45 mb-1.5">J'ai compris&nbsp;:</p>
              <p className="text-[16px] font-medium text-white/90 leading-snug max-w-[260px] mx-auto">
                {resultPreview}
              </p>
            </div>
          ) : (
            <>
              <p className="text-[16px] font-medium text-white/88 tracking-tight">
                {(phase === 'entering' || phase === 'listening') && 'MemorIA écoute…'}
                {phase === 'transcribing' && (slowLabel ? 'Je prépare ça…' : 'Je vous ai entendu…')}
                {phase === 'error' && errorMsg}
              </p>

              {/* Chantier sous le statut — hiérarchie : présence → état → contexte. */}
              {siteName && phase !== 'error' && (
                <p
                  className="mt-1 text-[13px] text-white/38 transition-all duration-400"
                  style={{ opacity: phase === 'entering' ? 0 : 0.38 }}
                >
                  {siteName}
                </p>
              )}

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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
