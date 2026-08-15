'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Volume2, VolumeX } from 'lucide-react'
import { createVad, DEFAULT_VAD_CONFIG, type Vad } from '@/lib/voice/vad'
import type { VoiceTurnResult } from '@/app/(field)/m/VoiceOrbContext'
import {
  voiceReducer,
  voiceErrorMessage,
  INITIAL_VOICE_STATE,
  type EndReason,
  type VoiceEvent,
  type VoicePhase,
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
import { VoiceTracePanel } from '@/components/field/VoiceTracePanel'
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
   *
   * Le `answer` renvoyé alimente le fil affiché DANS l'orbe : en session
   * continue on ne ferme plus pour lire.
   */
  onResult: (text: string) => void | Promise<void | VoiceTurnResult>
  onClose: () => void
}

/**
 * Délai avant de rouvrir le micro après un tour. Sans lui, MemorIA réentendrait
 * la queue de sa propre voix : `speechSynthesis` signale la fin de l'énoncé
 * quelques dizaines de millisecondes avant que le haut-parleur soit réellement
 * silencieux, et la VAD calibre son bruit de fond dans ses toutes premières
 * frames. 400 ms est le milieu de la fenêtre arbitrée (300–500).
 */
const REARM_DELAY_MS = 400

/**
 * Silence au bout duquel on relâche le micro sans fermer l'orbe. Garder un micro
 * ouvert indéfiniment est un coût batterie et une promesse d'écoute que personne
 * n'a demandée ; fermer serait plus brutal encore. Entre les deux : `ready`.
 */
const IDLE_TIMEOUT_MS = 18_000

/** Un échange affiché dans le fil. `answer === null` = réponse en cours. */
type Turn = { id: number; question: string; answer: string | null }

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

  // Fil de la conversation. Chaque question garde SA place : on n'écrase jamais
  // la transcription précédente par la suivante — c'est ce qui distingue une
  // conversation d'un champ de saisie qu'on recycle.
  const [turns, setTurns] = useState<Turn[]>([])
  const turnSeqRef  = useRef(0)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const orbAudioRef  = useRef<HTMLDivElement>(null)
  const haloOuterRef = useRef<HTMLDivElement>(null)
  const rafRef       = useRef<number | null>(null)
  const cleanupRef   = useRef<() => void>(() => {})
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      setTurns([])
      turnSeqRef.current = 0
      // Second filet pour le déverrouillage iOS : le trigger l'a normalement
      // déjà fait dans le geste, et l'appel est idempotent.
      primeSpeechOutput()
      const t = setTimeout(() => { void startListening() }, 220)
      return () => clearTimeout(t)
    }
    if (stateRef.current.phase !== 'idle') {
      clearRearmTimer()
      cleanupRef.current()
      stopSpeaking()
      // CANCEL est désormais accepté depuis toutes les phases actives, `thinking`
      // compris : la sortie du mode vocal est une seule affirmation.
      dispatch({ type: 'CANCEL' })
      const t = setTimeout(() => dispatch({ type: 'EXITED' }), 250)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => {
    cleanupRef.current()
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current)
  }, [])

  // Le fil grandit vers le bas : la dernière réponse doit rester visible sans
  // geste, y compris quand elle arrive pendant que MemorIA parle.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

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
  // en échec : une seule et même suite — on retourne écouter. La voix ne peut
  // donc jamais bloquer la conversation, ni dans un sens ni dans l'autre.
  //
  // `phase` fait partie des dépendances par sécurité : `useSyncExternalStore`
  // ne restitue pas les valeurs intermédiaires. Si une lecture démarrait et
  // s'achevait avant le premier rendu, `speech.speaking` n'aurait jamais été
  // observé à `true` et l'orbe resterait figée en `speaking`.
  useEffect(() => {
    if (phase !== 'speaking' || speech.speaking) return
    if (dispatch({ type: 'SPEECH_ENDED' })) scheduleRearm()
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
        if (firstFrameMs == null) {
          firstFrameMs = ts
          // Le délai « personne ne parle » n'est plus celui d'un outil qu'on
          // vient d'ouvrir volontairement (6 s), mais celui d'une session qui
          // reste ouverte entre deux questions.
          vadRef.current = createVad(ts, { ...DEFAULT_VAD_CONFIG, noSpeechTimeoutMs: IDLE_TIMEOUT_MS })
        }
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
          // Rien n'a été dit pendant tout le délai. Ce n'est pas une erreur en
          // session continue : c'est la fin naturelle d'une conversation. On
          // relâche le micro, l'orbe reste. `onstop` suivra, mais AUDIO_READY
          // sera refusé depuis `ready`.
          dispatch({ type: 'IDLE_TIMEOUT' })
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
    // Lu dans une variable locale, sinon le typage garderait la phase du ref
    // « narrowée » à `thinking` de l'autre côté du `await` — alors qu'elle a
    // précisément le droit de changer pendant ce temps.
    const phaseBeforeSend: VoicePhase = stateRef.current.phase
    if (phaseBeforeSend !== 'thinking') return

    // La question entre dans le fil AVANT la réponse : elle doit être lisible
    // pendant toute la réflexion, et le rester quand la suivante arrivera.
    const turnId = ++turnSeqRef.current
    setTurns((prev) => [...prev, { id: turnId, question: text, answer: null }])

    // Envoi direct au copilote, exactement comme une question saisie au clavier.
    // L'orbe reste à l'écran pendant toute la réflexion.
    traceVoice('orb-before-send', { phase: stateRef.current.phase, turnId })
    let result: void | VoiceTurnResult = undefined
    try {
      result = await onResult(text)
    } catch { /* la feuille affiche elle-même l'échec de la réponse */ }
    markVoice('answer')
    traceVoice('orb-after-send', { phase: stateRef.current.phase, isSpeaking: isSpeaking() })

    // La croix a pu être touchée pendant l'attente. La feuille, elle, a déjà
    // lancé la lecture : sans cette coupure, MemorIA parlerait après la sortie
    // du mode vocal. C'est l'invalidation de la génération audio en vol.
    // Annotation explicite : la phase a pu changer PENDANT le `await`, ce que le
    // typage ne peut pas savoir depuis le garde `thinking` posé plus haut.
    const p: VoicePhase = stateRef.current.phase
    if (p === 'exiting' || p === 'idle') { stopSpeaking(); return }

    const answer = result?.answer?.trim()
    if (answer) setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, answer } : t)))

    // L'orbe ne décide pas de parler : la feuille a déjà déclenché la lecture si
    // elle avait une synthèse orale à prononcer. Ici on ne fait qu'observer le
    // contrôleur audio. Pas de voix — sourdine, moteur absent, synthèse vide —
    // on ne fabrique pas une phase `speaking` fictive : on réécoute tout de
    // suite.
    if (isSpeaking() && dispatch({ type: 'SPEECH_STARTED' })) return
    if (dispatch({ type: 'ANSWER_SETTLED' })) scheduleRearm()
  }

  function clearRearmTimer() {
    if (rearmTimerRef.current) { clearTimeout(rearmTimerRef.current); rearmTimerRef.current = null }
  }

  /**
   * Retour en écoute après un tour. Le réducteur est déjà revenu en `entering` ;
   * ce délai n'existe que pour l'audio. Le garde relit la phase au moment du
   * déclenchement : entre-temps l'utilisateur a pu fermer.
   */
  function scheduleRearm(delay = REARM_DELAY_MS) {
    clearRearmTimer()
    rearmTimerRef.current = setTimeout(() => {
      rearmTimerRef.current = null
      if (stateRef.current.phase !== 'entering') return
      void startListening()
    }, delay)
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
    // Pendant la parole, le tap interrompt MemorIA pour enchaîner : la lecture
    // s'arrête, l'effet de fin de lecture réarme l'écoute. Rien n'est perdu, la
    // réponse écrite reste dans le fil.
    if (p === 'speaking') { stopSpeaking(); return }
    // Micro relâché après un long silence : on le remet, sans délai d'anti-écho
    // puisque rien ne parle.
    if (p === 'ready' && dispatch({ type: 'WAKE' })) scheduleRearm(120)
  }

  function handleClose() {
    // Sortie unique et explicite : tout est démonté ici. Le Wake Lock se relâche
    // seul par l'effet de phase, `exiting` n'en faisant pas partie.
    clearRearmTimer()
    cleanupRef.current()
    stopSpeaking()
    dispatch({ type: 'CANCEL' })
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
    phase === 'ready'                              ? 'Touchez pour reprendre' :
    speaking                                       ? 'Je vous réponds…' :
    phase === 'thinking'                           ? 'Je prépare ça…' :
    heard                                          ? 'Je vous ai entendu…' :
    /* entering | listening */                       'MemorIA écoute…'

  // Dès le premier échange l'orbe cède la place au fil : elle remonte et se
  // réduit au lieu de disparaître, parce qu'elle reste l'indicateur d'état de la
  // session — c'est elle qui dit si MemorIA écoute, réfléchit ou parle.
  const hasThread = turns.length > 0

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center select-none"
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

      {/* Groupe orbe + label. Sans fil : centré, légèrement au-dessus du milieu.
          Dès le premier échange : ancré en haut et réduit, pour laisser au fil
          la plus grande part de l'écran. */}
      <div
        className={hasThread
          ? 'flex-none flex w-full flex-col items-center pt-[76px]'
          : 'flex-1 flex w-full flex-col items-center justify-center'}
        style={hasThread ? undefined : { marginTop: '-6vh' }}
      >
        {/* Hauteur réservée constante par état : c'est la MISE À L'ÉCHELLE qui
            anime, pas le flux. Sans cela, le fil sauterait à chaque transition. */}
        <div
          className="flex items-center justify-center"
          style={{ height: hasThread ? 132 : 248, transition: 'height 0.45s ease' }}
        >
        <div style={{ transform: hasThread ? 'scale(0.52)' : 'scale(1)', transition: 'transform 0.45s ease' }}>

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
          disabled={phase !== 'listening' && !speaking && phase !== 'ready'}
          aria-label={
            speaking          ? 'Toucher pour arrêter la lecture' :
            phase === 'ready' ? 'Toucher pour reprendre la conversation' :
                                'Toucher pour terminer'
          }
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
        </div>
        </div>

        {/* Label d'état + contexte en dessous */}
        <div className={`${hasThread ? 'mt-4' : 'mt-10'} text-center`}>
          <p className="text-[16px] font-medium text-white/88 tracking-tight">{statusLabel}</p>

          {/* Chantier sous le statut — hiérarchie : présence → état → contexte.
              Une fois la conversation engagée, le contexte est établi : le
              rappeler à chaque tour prendrait la place du fil. */}
          {siteName && !hasThread && !isError && phase !== 'thinking' && !speaking && (
            <p
              className="mt-1 text-[13px] text-white/38 transition-all duration-400"
              style={{ opacity: phase === 'entering' ? 0 : 0.38 }}
            >
              {siteName}
            </p>
          )}

          {phase === 'listening' && !hasThread && (
            <p className="mt-2 text-[12px] text-white/35">Touchez pour terminer plus tôt</p>
          )}

          {speaking && (
            <p className="mt-2 text-[12px] text-white/35">Touchez pour enchaîner</p>
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

      {/* ── Fil de la conversation ──
          Chaque question conserve SA ligne. Il ne s'agit pas d'une zone de
          transcription réutilisée : sur trois tours, les trois questions et les
          trois réponses restent lisibles sans rien rouvrir. La réponse affichée
          ici est la réponse écrite complète — la voix, elle, n'en dit que
          l'essentiel. */}
      {hasThread && (
        <div className="flex-1 min-h-0 w-full overflow-y-auto px-6 pb-10">
          <div className="mx-auto flex max-w-[520px] flex-col gap-5">
            {turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-2">
                <p className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-violet-500/22 px-4 py-2.5 text-[15px] leading-snug text-white/90">
                  {turn.question}
                </p>
                {turn.answer && (
                  <p className="max-w-[92%] whitespace-pre-line text-[15px] leading-relaxed text-white/72">
                    {turn.answer}
                  </p>
                )}
              </div>
            ))}
            <div ref={threadEndRef} />
          </div>
        </div>
      )}

      {/* Recette uniquement (`?voicedebug=1`) : sans écran de lecture sur le
          téléphone, la trace du P0 multi-tours ne prouve rien. */}
      <VoiceTracePanel />
    </div>
  )
}
