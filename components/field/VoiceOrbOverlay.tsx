'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Volume2, VolumeX } from 'lucide-react'
import { createVad, type Vad } from '@/lib/voice/vad'
import {
  voiceReducer,
  voiceErrorMessage,
  INITIAL_VOICE_STATE,
  type EndReason,
  type VoiceEvent,
  type VoiceState,
} from '@/lib/voice/voice-session'
import {
  useSpeechOutput,
  isSpeaking,
  stopSpeaking,
  toggleVoiceMuted,
  primeSpeechOutput,
} from '@/lib/voice/speech-output'
import { markVoice } from '@/lib/voice/voice-latency'
import { beginVoiceTurn, traceVoice } from '@/lib/voice/voice-trace'
import {
  browserWakeLockEnv,
  createWakeLockController,
  phaseNeedsWakeLock,
} from '@/lib/voice/wake-lock'

interface Props {
  open: boolean
  siteId: string
  siteName?: string
  /**
   * Envoi de la question au copilote. Peut renvoyer une promesse : l'orbe reste
   * alors à l'écran, en état « réflexion », jusqu'à ce que la réponse arrive.
   * C'est l'appelant qui déclenche la lecture vocale ; l'orbe se contente
   * d'observer le contrôleur audio et d'en refléter l'état.
   */
  onResult: (text: string) => void | Promise<void>
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

// Signal haptique de « phrase prise » : le blob se contracte et le téléphone
// répond très brièvement. Pas de second son — en chantier il serait inaudible
// et, dans le calme, redondant.
function vibrateEndOfSpeech() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12)
  } catch { /* vibrate non disponible (iOS) */ }
}

export function VoiceOrbOverlay({ open, siteId, siteName, onResult, onClose }: Props) {
  // La machine à états est la seule autorité sur le parcours. `stateRef` en est
  // le miroir synchrone : les callbacks audio (RAF, `onstop`) se déclenchent
  // hors du cycle de rendu React et doivent lire l'état réel, pas celui de la
  // dernière frame rendue.
  const [state, setState] = useState<VoiceState>(INITIAL_VOICE_STATE)
  const stateRef = useRef<VoiceState>(INITIAL_VOICE_STATE)

  /** Renvoie `true` si la transition a été acceptée. C'est l'anti-double-envoi. */
  const dispatch = useCallback((event: VoiceEvent): boolean => {
    const prev = stateRef.current
    const next = voiceReducer(prev, event)
    if (next === prev) {
      // Un refus n'est pas une anomalie en soi (c'est le rôle de la machine),
      // mais un refus INATTENDU au deuxième tour serait le défaut cherché.
      traceVoice('phase-refused', { event: event.type, phase: prev.phase })
      return false
    }
    stateRef.current = next
    setState(next)
    traceVoice('phase', { event: event.type, from: prev.phase, to: next.phase })
    return true
  }, [])

  const [reducedMotion, setReduced] = useState(false)
  const speech = useSpeechOutput()

  const orbAudioRef  = useRef<HTMLDivElement>(null)
  const haloOuterRef = useRef<HTMLDivElement>(null)
  const rafRef       = useRef<number | null>(null)
  const cleanupRef   = useRef<() => void>(() => {})
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vadRef       = useRef<Vad | null>(null)
  // Conclusion de la phrase en cours — publiée par la session d'écoute pour que
  // le tap manuel emprunte exactement le même chemin que la VAD.
  const concludeRef  = useRef<((reason: EndReason) => void) | null>(null)
  // Lissage asymétrique du signal audio — persiste entre les frames RAF.
  const smoothedRef  = useRef(0)

  const phase = state.phase

  // Détection de prefers-reduced-motion côté client uniquement.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const h = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  // Cycle principal : open → entering → écoute ; !open → sortie propre.
  useEffect(() => {
    if (open) {
      if (!dispatch({ type: 'OPEN' })) return
      // Second filet pour le déverrouillage iOS : le trigger l'a normalement
      // déjà fait dans le geste, et l'appel est idempotent.
      primeSpeechOutput()
      const t = setTimeout(() => { void startListening() }, 220)
      return () => clearTimeout(t)
    }
    if (stateRef.current.phase !== 'idle') {
      cleanupRef.current()
      stopSpeaking()
      // Depuis `thinking`, CANCEL est refusé (la question est déjà partie) :
      // on referme alors par la voie normale.
      if (!dispatch({ type: 'CANCEL' })) dispatch({ type: 'ANSWER_SETTLED' })
      const t = setTimeout(() => dispatch({ type: 'EXITED' }), 250)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => {
    cleanupRef.current()
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
  }, [])

  // ── Écran maintenu allumé pendant l'échange vocal, et seulement là ──────────
  //
  // Constat terrain : avec une veille écran courte, l'écran s'éteint pendant
  // `thinking` ou `speaking` — l'utilisateur a parlé, il attend, il ne touche
  // plus rien, donc l'OS le croit inactif au moment précis où il est au cœur de
  // l'échange. Un seul branchement déclaratif : le contrôleur reçoit un état,
  // pas une suite d'ordres, et ne peut donc pas « oublier » de relâcher.
  const wakeLockRef = useRef<ReturnType<typeof createWakeLockController> | null>(null)
  if (wakeLockRef.current === null && typeof window !== 'undefined') {
    wakeLockRef.current = createWakeLockController(browserWakeLockEnv())
  }
  useEffect(() => {
    wakeLockRef.current?.sync(phaseNeedsWakeLock(phase))
  }, [phase])
  useEffect(() => () => { wakeLockRef.current?.dispose() }, [])

  // Fin de la lecture vocale. Fin naturelle, interruption au tap, moteur muet ou
  // en échec : une seule et même sortie. La voix ne peut donc jamais retenir
  // l'orbe à l'écran.
  //
  // `phase` fait partie des dépendances par sécurité : `useSyncExternalStore`
  // ne restitue pas les valeurs intermédiaires. Si une lecture démarrait et
  // s'achevait avant le premier rendu, `speech.speaking` n'aurait jamais été
  // observé à `true` et l'orbe resterait figée en `speaking`.
  useEffect(() => {
    if (phase !== 'speaking' || speech.speaking) return
    if (dispatch({ type: 'SPEECH_ENDED' })) scheduleClose()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speech.speaking])

  function stopAudioLoop() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    smoothedRef.current = 0
    vadRef.current = null
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
      // Anti-écho, avant toute chose : le micro ne doit jamais s'ouvrir sur une
      // voix en cours. `stopSpeaking()` est synchrone, donc la coupure est
      // effective avant même la demande d'autorisation. Cela protège aussi la
      // calibration du bruit de fond de la VAD, qui mesurerait sinon le
      // haut-parleur de MemorIA elle-même.
      stopSpeaking()

      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // L'utilisateur a pu fermer pendant l'attente d'autorisation.
      if (stateRef.current.phase !== 'entering') {
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

      const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
      const mime = MIME.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      let firstFrameMs: number | null = null
      let lastFrameMs = 0

      /** Conclut la phrase. Une seule des sources concurrentes sera acceptée. */
      const conclude = (reason: EndReason) => {
        if (!dispatch({ type: 'END_OF_SPEECH', reason })) return
        // Origine des temps du parcours vocal : c'est l'instant où l'utilisateur
        // considère avoir fini de parler, donc celui à partir duquel il attend.
        markVoice('endOfSpeech')
        // Même origine pour la trace : un tour de conversation commence ici.
        beginVoiceTurn()
        vibrateEndOfSpeech()
        if (recorder.state === 'recording') recorder.stop()
      }
      concludeRef.current = conclude

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
      //
      // Cette même valeur lissée alimente la VAD : la boucle tourne donc
      // toujours, y compris en `prefers-reduced-motion` où seule l'écriture des
      // variables CSS est suspendue. La détection de fin de parole n'est pas un
      // effet visuel.
      const NOISE_FLOOR   = 0.012
      const MAX_EXPECTED  = 0.28
      const ATTACK        = 0.80   // fraction du nouveau signal en montée
      const DECAY         = 0.14   // fraction du nouveau signal en descente

      const buf = new Uint8Array(analyser.fftSize)
      const loop = (ts: number) => {
        // L'horodatage RAF sert d'horloge unique à la VAD — même base de temps
        // que le signal qu'elle observe.
        if (firstFrameMs == null) { firstFrameMs = ts; vadRef.current = createVad(ts) }
        lastFrameMs = ts

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

        if (!reducedMotion) {
          const delta = smoothedRef.current.toFixed(3)
          orbAudioRef.current?.style.setProperty('--audio-delta', delta)
          haloOuterRef.current?.style.setProperty('--audio-delta', delta)
        }

        const signal = vadRef.current?.push(smoothedRef.current, ts) ?? null
        if (signal === 'no-speech') {
          // Rien n'a été dit : on coupe sans rien transmettre. `onstop` suivra,
          // mais AUDIO_READY sera refusé depuis l'état d'erreur.
          dispatch({ type: 'NO_SPEECH' })
          doCleanup(recorder)
          return
        }
        if (signal === 'speech-ended' || signal === 'max-duration') {
          conclude(signal === 'max-duration' ? 'max-duration' : 'silence')
          return
        }

        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

      recorder.onstop = async () => {
        stopAudioLoop()
        stream!.getTracks().forEach((t) => t.stop())
        audioCtx!.close().catch(() => {})
        cleanupRef.current = () => {}
        concludeRef.current = null

        const durationMs = firstFrameMs == null ? 0 : lastFrameMs - firstFrameMs
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0 || durationMs < 200) {
          dispatch({ type: 'AUDIO_EMPTY' })
          return
        }
        // Refusé si `onstop` est délivré deux fois, ou après une annulation.
        if (!dispatch({ type: 'AUDIO_READY' })) return
        await transcribeAndSend(blob, recorder.mimeType)
      }

      recorder.start()
      cleanupRef.current = () => doCleanup(recorder)
      dispatch({ type: 'MIC_READY' })

    } catch (err) {
      const e = err as Error
      const isDenied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
      dispatch({ type: 'MIC_FAILED', kind: isDenied ? 'mic-denied' : 'mic-unavailable' })
    }
  }

  async function transcribeAndSend(blob: Blob, mimeType: string) {
    let text: string
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `voice.${ext}`)
      form.append('siteId', siteId)

      const res = await fetch('/api/copilot/transcribe', { method: 'POST', body: form })
      if (!res.ok) { dispatch({ type: 'TRANSCRIBE_FAILED' }); return }
      const data = await res.json() as { text?: string }
      text = (data.text ?? '').trim()
    } catch {
      dispatch({ type: 'TRANSCRIBE_FAILED' })
      return
    }

    // Une transcription vide bascule en erreur au lieu d'ouvrir la réflexion :
    // c'est la machine qui l'impose, pas ce fichier.
    if (!dispatch({ type: 'TRANSCRIPT', text })) return
    markVoice('transcript')
    if (stateRef.current.phase !== 'thinking') return

    // Envoi direct au copilote, exactement comme une question saisie au clavier.
    // L'orbe reste à l'écran pendant toute la réflexion.
    traceVoice('orb-before-send', { phase: stateRef.current.phase })
    try {
      await onResult(text)
    } catch { /* la feuille affiche elle-même l'échec de la réponse */ }
    markVoice('answer')
    traceVoice('orb-after-send', { phase: stateRef.current.phase, isSpeaking: isSpeaking() })

    // L'orbe ne décide pas de parler : la feuille a déjà déclenché la lecture si
    // elle avait une synthèse orale à prononcer. Ici on ne fait qu'observer le
    // contrôleur audio pour savoir s'il faut rester à l'écran. Pas de voix, ou
    // sourdine, ou moteur absent : on referme exactement comme avant ce lot.
    if (isSpeaking() && dispatch({ type: 'SPEECH_STARTED' })) return
    if (dispatch({ type: 'ANSWER_SETTLED' })) scheduleClose()
  }

  function scheduleClose() {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null
      dispatch({ type: 'EXITED' })
      onClose()
    }, 260)
  }

  function handleOrbTap() {
    const p = stateRef.current.phase
    // Le tap manuel reste possible : il court-circuite l'attente du silence.
    if (p === 'listening') { concludeRef.current?.('manual'); return }
    // Pendant la parole, le tap coupe la lecture — et rien d'autre : la réponse
    // écrite est déjà affichée dans la feuille, couper ne perd aucune
    // information. La fermeture suit par l'effet de fin de lecture.
    if (p === 'speaking') stopSpeaking()
  }

  function handleClose() {
    cleanupRef.current()
    stopSpeaking()
    // Pendant la réflexion, la question est déjà partie : le X referme l'orbe,
    // la réponse arrivera dans la feuille.
    if (!dispatch({ type: 'CANCEL' })) dispatch({ type: 'ANSWER_SETTLED' })
    scheduleClose()
  }

  function handleRetry() {
    if (!dispatch({ type: 'RETRY' })) return
    setTimeout(() => { void startListening() }, 220)
  }

  if (phase === 'idle') return null

  const visible = phase !== 'exiting'
  const isError = phase === 'error'
  const heard = phase === 'finalizing' || phase === 'sending'

  const speaking = phase === 'speaking'

  // Cinq comportements perceptibles sans texte supplémentaire :
  // écoute (réactif à la voix) → prise de la phrase (contraction) →
  // réflexion (pulsation lente) → parole (pulsation rythmée) → sortie.
  const orbClasses = reducedMotion
    ? 'orb-reduced-motion'
    : [
        'orb-breathing',
        heard                && 'orb-transcribing',
        phase === 'thinking' && 'orb-processing',
        speaking             && 'orb-speaking',
        phase === 'entering' && 'orb-enter',
        phase === 'exiting'  && 'orb-exit',
      ].filter(Boolean).join(' ')

  // Style du noyau : radial-gradient centré → lumière émise de l'intérieur,
  // sans effet 3D directionnel. Rose en état d'erreur.
  const coreStyle: React.CSSProperties = {
    background: isError
      ? 'radial-gradient(circle at 50% 42%, #fda4af, #e11d48 55%, #9f1239)'
      : 'radial-gradient(circle at 50% 42%, #ede9fe, #8b5cf6 52%, #4338ca)',
    boxShadow: isError
      ? '0 0 40px 6px rgba(225,29,72,0.35), 0 0 80px 16px rgba(225,29,72,0.10)'
      : '0 0 40px 6px rgba(139,92,246,0.38), 0 0 80px 16px rgba(139,92,246,0.10)',
  }

  const statusLabel =
    isError                                        ? voiceErrorMessage(state.error) :
    speaking                                       ? 'Je vous réponds…' :
    phase === 'thinking'                           ? 'Je prépare ça…' :
    heard                                          ? 'Je vous ai entendu…' :
    /* entering | listening */                       'MemorIA écoute…'

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
      {/* Sourdine — préférence d'appareil, persistante, indépendante du micro.
          Coupe la lecture en cours immédiatement. Miroir du bouton fermer. */}
      {speech.supported && (
        <button
          type="button"
          onClick={() => { primeSpeechOutput(); toggleVoiceMuted() }}
          aria-label={speech.muted ? 'Activer la réponse vocale' : 'Couper la réponse vocale'}
          aria-pressed={speech.muted}
          className="absolute left-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20"
        >
          {speech.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      )}

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
          disabled={phase !== 'listening' && !speaking}
          aria-label={speaking ? 'Toucher pour arrêter la lecture' : 'Toucher pour terminer'}
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
                phase === 'thinking' ? 'orb-halo-processing' :
                speaking             ? 'orb-halo-speaking' :
                                       'orb-halo-a orb-halo-outer-reactive',
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

        {/* Label d'état + contexte en dessous */}
        <div className="mt-10 text-center">
          <p className="text-[16px] font-medium text-white/88 tracking-tight">{statusLabel}</p>

          {/* Chantier sous le statut — hiérarchie : présence → état → contexte. */}
          {siteName && !isError && phase !== 'thinking' && !speaking && (
            <p
              className="mt-1 text-[13px] text-white/38 transition-all duration-400"
              style={{ opacity: phase === 'entering' ? 0 : 0.38 }}
            >
              {siteName}
            </p>
          )}

          {phase === 'listening' && (
            <p className="mt-2 text-[12px] text-white/35">Touchez pour terminer plus tôt</p>
          )}

          {speaking && (
            <p className="mt-2 text-[12px] text-white/35">Touchez pour arrêter</p>
          )}

          {/* Pendant la réflexion PUIS la parole : ce qui a été compris, en clair.
              Ce n'est pas une étape de confirmation — rien à valider, la question
              est partie. La question reste visible tant que MemorIA répond. */}
          {(phase === 'thinking' || speaking) && state.transcript && (
            <p className="mt-1 text-[14px] leading-snug text-white/55 max-w-[280px] mx-auto">
              {state.transcript}
            </p>
          )}

          {isError && (
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
    </div>
  )
}
