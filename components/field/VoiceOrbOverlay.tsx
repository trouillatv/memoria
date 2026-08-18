'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Volume2, VolumeX } from 'lucide-react'
import { createVad, DEFAULT_VAD_CONFIG, type Vad } from '@/lib/voice/vad'
import { useVoiceOrb, type VoiceTurnHandlers, type VoiceTurnResult } from '@/app/(field)/m/VoiceOrbContext'
import type { VoiceTurnPayload } from '@/lib/voice/copilot-stream-client'
import { openLiveStt, type LiveSttOutcome, type LiveSttSession } from '@/lib/voice/live-stt'
import { attachPcmTap, openPcmTapCount, type PcmTap } from '@/lib/voice/pcm-tap'
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
import { VoiceThreadAnswer } from '@/components/field/VoiceThreadAnswer'
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
   * Un tour vocal complet. L'orbe fournit un transcript déjà normalisé quand
   * Gemini Live a transcrit sur le téléphone (P3-B), l'audio capturé sinon —
   * repli de panne, où le serveur transcrit et répond en une seule requête
   * (P2-C). L'orbe apprend le transcript par `handlers.onTranscript` dans les
   * deux cas. C'est l'appelant qui déclenche la lecture vocale ; l'orbe se
   * contente d'observer le contrôleur audio et d'en refléter l'état.
   *
   * Le `answer` renvoyé alimente le fil affiché DANS l'orbe : en session
   * continue on ne ferme plus pour lire.
   */
  onVoiceTurn: (turn: VoiceTurnPayload, handlers: VoiceTurnHandlers) => Promise<void | VoiceTurnResult>
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
 * Délai de réarmement après un tour qui a produit une PROPOSITION. Plus long
 * que `REARM_DELAY_MS` : rouvrir le micro instantanément donnerait l'impression
 * que rien ne s'est passé, alors qu'une décision humaine reste en attente dans
 * le bandeau. Aucun blocage pour autant — si l'utilisateur reparle avant, le
 * flux vocal continue normalement (Lot A, Vincent, 2026-08-18).
 */
const PROPOSAL_REARM_DELAY_MS = 1100

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

export function VoiceOrbOverlay({ open, siteId, siteName, onVoiceTurn, onClose }: Props) {
  const { pendingProposals, viewPendingProposal } = useVoiceOrb()

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
    // Voie Live : ouverte à l'ouverture du micro, close à la fin de parole.
    // `null` partout = Live indisponible sur cet appareil ou ce tour, et l'orbe
    // repart sur l'audio sans que rien d'autre ne change.
    let live: LiveSttSession | null = null
    let pcm: PcmTap | null = null
    /** Transcript Live en vol, armé à la fin de parole. `null` = pas de voie Live. */
    let livePending: Promise<LiveSttOutcome | null> | null = null

    /**
     * P0-3 (17/08) — propriété du tap PCM.
     *
     * `attachPcmTap` est asynchrone (chargement du worklet). Un tour court se
     * terminait donc AVANT que `pcm` soit affecté : `pcm?.stop()` ne trouvait
     * rien, puis le `.then` affectait un tap que plus personne ne pouvait
     * arrêter — un `AudioContext` 16 kHz branché sur le micro, fuité par tour.
     * Ce drapeau exprime le fait manquant : « ce tour ne veut plus de tap »,
     * indépendamment du fait qu'il en ait déjà un.
     */
    let pcmWanted = true
    const stopPcm = () => {
      pcmWanted = false
      pcm?.stop()
      pcm = null
    }

    const doCleanup = (recorder?: MediaRecorder) => {
      stopAudioLoop()
      if (recorder?.state === 'recording') recorder.stop()
      stopPcm()
      live?.abort()
      live = null
      stream?.getTracks().forEach((t) => t.stop())
      audioCtx?.close().catch(() => {})
    }
    cleanupRef.current = () => doCleanup()

    /** État réel des ressources audio, pour la trace P0-3. Aucune décision n'en dépend. */
    const audioSnapshot = (recorder?: MediaRecorder) => ({
      tracks: (stream?.getAudioTracks() ?? []).map(
        (t) => `${t.readyState}/${t.enabled ? 'on' : 'off'}/${t.muted ? 'muted' : 'live'}`,
      ),
      tapsOpen: openPcmTapCount(),
      tapHeld: pcm !== null,
      ctx: audioCtx?.state ?? 'none',
      recorder: recorder?.state ?? 'none',
      liveHeld: live !== null,
    })

    // Quelle opération a levé. Le `catch` couvre tout le démarrage : sans ce
    // repère, un refus du micro et un `AudioContext` impossible à créer
    // arrivaient dans la même branche et produisaient le même écran rouge.
    let stage = 'start'
    try {
      // Anti-écho, avant toute chose : le micro ne doit jamais s'ouvrir sur une
      // voix en cours. `stopSpeaking()` est synchrone, donc la coupure est
      // effective avant même la demande d'autorisation. Cela protège aussi la
      // calibration du bruit de fond de la VAD, qui mesurerait sinon le
      // haut-parleur de MemorIA elle-même.
      stopSpeaking()

      // P0-3 : ce que le tour PRÉCÉDENT a laissé derrière lui, relevé juste
      // avant la demande. Si `tapsOpen` n'est pas 0 ici, la cause du refus micro
      // est dans le tour d'avant, pas dans celui-ci.
      traceVoice('mic-open-before', { tapsOpen: openPcmTapCount() })
      stage = 'getUserMedia'
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      traceVoice('mic-open-after', {
        tracks: stream.getAudioTracks().map(
          (t) => `${t.readyState}/${t.enabled ? 'on' : 'off'}/${t.muted ? 'muted' : 'live'}`,
        ),
      })

      // L'utilisateur a pu fermer pendant l'attente d'autorisation.
      if (stateRef.current.phase !== 'entering') {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      playActivationCue()

      // ── Voie Live (P3-B) ────────────────────────────────────────────────────
      // Rien de tout cela n'est attendu : `openLiveStt` rend la main
      // immédiatement et `attachPcmTap` est lancé sans `await`. Le micro s'ouvre
      // donc exactement au même instant qu'avant. Le PCM capté avant que la
      // session Gemini soit prête est tamponné puis renvoyé d'un bloc — sinon la
      // latence gagnée en fin de tour serait repayée à son début.
      live = openLiveStt(siteId)
      const liveSession = live
      void attachPcmTap(stream, (chunk) => liveSession.push(chunk)).then((tap) => {
        if (!tap) {
          // Pas de 16 kHz sur cet appareil : inutile de tenir une session Gemini
          // qui ne recevra jamais d'audio.
          traceVoice('live-stt-unavailable', { reason: 'pcm-tap' })
          liveSession.abort()
          if (live === liveSession) live = null
          return
        }
        // Le tour a pu se conclure PENDANT le chargement du worklet. C'est le
        // cas qui fuitait : `live` reste non nul après `conclude`, donc le test
        // sur la session ne suffisait pas à détecter un tour déjà fini.
        if (!pcmWanted || live !== liveSession) { tap.stop(); return }
        pcm = tap
      })

      stage = 'audioContext'
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.85
      source.connect(analyser)

      stage = 'mediaRecorder'
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
        // `audioStreamEnd` part ICI, à l'instant exact de la fin de parole :
        // c'est de lui que se compte la latence Live mesurée le 16/08. On coupe
        // le tap d'abord pour qu'aucun bloc ne parte après la fin du flux.
        stopPcm()
        livePending = live?.finish() ?? null
        if (recorder.state === 'recording') recorder.stop()
        traceVoice('turn-teardown', { at: 'conclude', reason, ...audioSnapshot(recorder) })
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
        // Le tap est normalement déjà arrêté par `conclude`. Pas sur tous les
        // chemins : un `stop()` venu d'ailleurs (nettoyage, arrêt du recorder
        // par le navigateur) passait ici SANS relâcher le contexte 16 kHz.
        // `stopPcm` est idempotent — le rappeler ne coûte rien, l'omettre
        // laissait le micro détenu.
        stopPcm()
        stream!.getTracks().forEach((t) => t.stop())
        audioCtx!.close().catch(() => {})
        traceVoice('turn-teardown', { at: 'onstop', ...audioSnapshot(recorder) })
        cleanupRef.current = () => {}
        concludeRef.current = null

        const durationMs = firstFrameMs == null ? 0 : lastFrameMs - firstFrameMs
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0 || durationMs < 200) {
          live?.abort()
          live = null
          dispatch({ type: 'AUDIO_EMPTY' })
          return
        }
        // Refusé si `onstop` est délivré deux fois, ou après une annulation.
        if (!dispatch({ type: 'AUDIO_READY' })) { live?.abort(); live = null; return }
        await transcribeAndSend(blob, recorder.mimeType, livePending)
      }

      recorder.start()
      cleanupRef.current = () => doCleanup(recorder)
      dispatch({ type: 'MIC_READY' })

    } catch (err) {
      const e = err as Error
      // Mandat P0-3 : le nom ET le message exacts de la DOMException, plus
      // l'état des ressources au moment du refus. Sans eux, « le micro n'est
      // pas accessible » ne dit rien de ce qu'il faut réparer.
      traceVoice('mic-error', {
        stage,
        name: e.name,
        message: (e.message || '').slice(0, 120),
        ...audioSnapshot(),
      })
      // Le tour avorté ne doit rien laisser derrière lui — c'est précisément la
      // faute que ce lot corrige : un échec silencieux empilait les ressources.
      doCleanup()
      const isDenied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
      dispatch({ type: 'MIC_FAILED', kind: isDenied ? 'mic-denied' : 'mic-unavailable' })
    }
  }

  async function transcribeAndSend(
    blob: Blob,
    mimeType: string,
    livePending: Promise<LiveSttOutcome | null> | null,
  ) {
    // Une seule frontière STT (P3-B) : on attend d'abord le transcript Live,
    // déjà normalisé contre le vocabulaire du chantier. S'il arrive, l'audio
    // n'est JAMAIS envoyé — pas de seconde transcription pour le même tour. S'il
    // n'arrive pas (session non prête, socket coupée, silence), l'orbe repart
    // sur le chemin P2-C exactement comme avant : le blob est déjà enregistré,
    // rien à recommencer.
    const liveOutcome = livePending ? await livePending.catch(() => null) : null
    const turn: VoiceTurnPayload = liveOutcome
      ? { kind: 'transcript', text: liveOutcome.text, rawText: liveOutcome.rawText, corrections: liveOutcome.corrections, abstentions: liveOutcome.abstentions }
      : { kind: 'audio', audio: blob, mimeType }
    traceVoice('orb-stt-route', {
      route: liveOutcome ? 'live' : 'server',
      corrections: liveOutcome?.corrections.length ?? 0,
      abstentions: liveOutcome?.abstentions ?? 0,
    })

    let transcriptSeen = false
    let turnId: number | null = null

    const onTranscript = (text: string): boolean => {
      transcriptSeen = true
      // Une transcription vide bascule en erreur au lieu d'ouvrir la réflexion :
      // c'est la machine qui l'impose, pas ce fichier.
      if (!dispatch({ type: 'TRANSCRIPT', text })) return false
      markVoice('transcript')
      // La croix a pu être touchée pendant le STT : si la machine n'est plus en
      // réflexion, le tour est abandonné — la feuille jette la réponse.
      if (stateRef.current.phase !== 'thinking') return false

      // La question entre dans le fil AVANT la réponse : elle doit être lisible
      // pendant toute la réflexion, et le rester quand la suivante arrivera.
      turnId = ++turnSeqRef.current
      const id = turnId
      setTurns((prev) => [...prev, { id, question: text, answer: null }])
      traceVoice('orb-before-send', { phase: stateRef.current.phase, turnId: id })
      return true
    }

    let result: void | VoiceTurnResult = undefined
    try {
      result = await onVoiceTurn(turn, { onTranscript })
    } catch {
      // Échec AVANT transcript (réseau, provider) → même erreur qu'avant la
      // fusion des requêtes. Après transcript, la feuille affiche elle-même
      // l'échec de la réponse.
      if (!transcriptSeen) { dispatch({ type: 'TRANSCRIBE_FAILED' }); return }
    }
    if (!transcriptSeen) { dispatch({ type: 'TRANSCRIBE_FAILED' }); return }
    // Tour refusé par la machine (orbe fermée, transcription vide) : tout est
    // déjà géré, la réponse a été jetée par la feuille.
    if (turnId === null) return
    const settledTurnId = turnId

    markVoice('answer')
    traceVoice('orb-after-send', { phase: stateRef.current.phase, isSpeaking: isSpeaking() })

    // La croix a pu être touchée pendant l'attente. La feuille, elle, a déjà
    // lancé la lecture : sans cette coupure, MemorIA parlerait après la sortie
    // du mode vocal. C'est l'invalidation de la génération audio en vol.
    // Annotation explicite : la phase a pu changer PENDANT le `await`, ce que le
    // typage ne peut pas savoir depuis le garde `thinking` du callback.
    const p: VoicePhase = stateRef.current.phase
    if (p === 'exiting' || p === 'idle') { stopSpeaking(); return }

    const answer = result?.answer?.trim()
    if (answer) setTurns((prev) => prev.map((t) => (t.id === settledTurnId ? { ...t, answer } : t)))

    // L'orbe ne décide pas de parler : la feuille a déjà déclenché la lecture si
    // elle avait une synthèse orale à prononcer. Ici on ne fait qu'observer le
    // contrôleur audio. Pas de voix — sourdine, moteur absent, synthèse vide —
    // on ne fabrique pas une phase `speaking` fictive : on réécoute tout de
    // suite.
    if (isSpeaking() && dispatch({ type: 'SPEECH_STARTED' })) return
    if (dispatch({ type: 'ANSWER_SETTLED' })) {
      scheduleRearm(result?.proposalPending ? PROPOSAL_REARM_DELAY_MS : REARM_DELAY_MS)
    }
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

  // Le libellé est l'état courant, formulé du point de vue de l'utilisateur : ce
  // que MemorIA fait, ou ce qu'il peut faire. En `ready` on dit l'action
  // disponible (« parler »), pas la mécanique interne (« reprendre ») : le micro
  // s'est relâché, mais rien n'est interrompu de son point de vue.
  const statusLabel =
    isError                                        ? voiceErrorMessage(state.error) :
    phase === 'ready'                              ? 'Touchez pour parler' :
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
      {/* ── Contrôles système : quitter et couper le son ──────────────────────
          Le blob est de la signature visuelle ; ces deux boutons sont du
          CONTRÔLE. Ils doivent rester visibles et touchables dans les cinq
          états — écoute, fin de parole, réflexion, parole, attente.

          Défaut corrigé : ils étaient frères du groupe d'état, qui porte
          `z-10`, occupe toute la largeur et démarre en haut de l'écran. Ils
          passaient donc DESSOUS — peints sous son dégradé dès qu'un fil
          existait, et surtout inatteignables au doigt puisque le groupe
          recouvrait leurs deux coins. D'où la barre dédiée : un seul plan,
          au-dessus du fond, du fil et de l'orbe, transparent aux gestes
          partout sauf sur les boutons eux-mêmes.

          Aucune de leurs propriétés visuelles ne dépend de la phase : un
          contrôle qui pâlit pendant l'écoute se lit comme désactivé. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-5">
        {/* Sourdine — préférence d'appareil, persistante, indépendante du micro.
            Elle ne pilote QUE la sortie vocale : pendant l'écoute le réglage est
            accepté sans rien interrompre, pendant la parole il coupe
            immédiatement la lecture en cours (`setVoiceMuted` annule la
            génération). Le déverrouillage iOS n'est déclenché qu'en RÉACTIVANT
            le son : rien ne doit être envoyé au moteur de parole au moment où
            l'utilisateur demande le silence. */}
        {speech.supported ? (
          <button
            type="button"
            onClick={() => { if (speech.muted) primeSpeechOutput(); toggleVoiceMuted() }}
            aria-label={speech.muted ? 'Activer la réponse vocale' : 'Couper la réponse vocale'}
            aria-pressed={speech.muted}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 active:bg-white/30"
          >
            {speech.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        ) : (
          // Réserve la place : sans moteur de parole, la croix reste à droite.
          <span className="h-11 w-11" aria-hidden />
        )}

        {/* Sortie ABSOLUE : micro, VAD et boucle audio démontés, lecture en cours
            coupée et génération invalidée, Wake Lock relâché par l'effet de
            phase (`exiting` n'en fait pas partie), overlay fermé. Recevable
            depuis les huit phases actives — y compris `thinking`, où la question
            est déjà partie : quitter le mode vocal est une autre affirmation que
            annuler la réponse. */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fermer"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 active:bg-white/30"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Groupe orbe + label = ÉTAT COURANT. Sans fil : centré, légèrement
          au-dessus du milieu. Dès le premier échange : ancré en haut et réduit,
          pour laisser au fil la plus grande part de l'écran.
          Il est au-dessus du fil dans l'empilement, avec un dégradé sous lui :
          la conversation passée glisse DERRIÈRE l'état live au lieu de le
          concurrencer. Sans cela, « MemorIA écoute… » flottait au-dessus d'un
          bloc de texte plus dense que lui, et l'œil partait sur le texte. */}
      <div
        className={hasThread
          ? 'relative z-10 flex-none flex w-full flex-col items-center pt-[70px] pb-4'
          : 'relative z-10 flex-1 flex w-full flex-col items-center justify-center'}
        style={hasThread
          ? { background: 'linear-gradient(to bottom, rgba(5,5,15,0.62) 62%, rgba(5,5,15,0))' }
          : { marginTop: '-6vh' }}
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
            phase === 'ready' ? 'Toucher pour parler' :
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

        {/* Label d'état + contexte en dessous. En session engagée il monte d'un
            cran en contraste et en graisse : c'est la seule ligne de l'écran qui
            dit ce qui se passe MAINTENANT. */}
        <div className={`${hasThread ? 'mt-3' : 'mt-10'} text-center`}>
          <p
            className={`tracking-tight ${hasThread ? 'text-[17px] font-semibold text-white' : 'text-[16px] font-medium text-white/88'}`}
            style={hasThread ? { textShadow: '0 1px 12px rgba(5,5,15,0.65)' } : undefined}
          >
            {statusLabel}
          </p>

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
        <div
          className="flex-1 min-h-0 w-full overflow-y-auto px-6 pb-10 -mt-2"
          // Le haut du fil s'efface sous le groupe d'état : rien ne « touche »
          // le libellé courant, et le défilement ne produit pas de bord franc.
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0, black 40px)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 40px)',
          }}
        >
          <div className="mx-auto flex max-w-[520px] flex-col gap-5 pt-2">
            {turns.map((turn, i) => {
              // Seul le tour courant est pleinement lisible. Les précédents ne
              // sont ni masqués ni repliés — ils reculent. L'historique reste
              // consultable d'un regard sans disputer l'attention à l'état live.
              const isCurrent = i === turns.length - 1
              return (
                <div
                  key={turn.id}
                  className="flex flex-col gap-2 transition-opacity duration-500"
                  style={{ opacity: isCurrent ? 1 : 0.4 }}
                >
                  <p className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-violet-500/22 px-4 py-2.5 text-[15px] leading-snug text-white/90">
                    {turn.question}
                  </p>
                  {turn.answer && (
                    <div className="max-w-[92%]">
                      <VoiceThreadAnswer text={turn.answer} />
                    </div>
                  )}
                </div>
              )
            })}
            <div ref={threadEndRef} />
          </div>
        </div>
      )}

      {/* ── Bandeau propositions en attente ──
          Ne ferme jamais tout seul et ne se fait jamais recouvrir par un
          nouveau tour : c'est le point de départ du Lot A — sans lui, une
          proposition créée à la voix disparaissait dès l'échange suivant sans
          qu'aucune trace visuelle ne reste (Vincent, 2026-08-18). Modélisé en
          collection dès maintenant pour préparer P6-B, même si un seul tour
          ne produit aujourd'hui qu'une proposition. */}
      {pendingProposals.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="pointer-events-auto mx-auto flex max-w-[520px] flex-col gap-2 rounded-2xl border border-white/15 bg-[rgba(20,20,32,0.94)] px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur">
            {pendingProposals.length > 1 && (
              <p className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                {pendingProposals.length} propositions en attente
              </p>
            )}
            {pendingProposals.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-violet-300/80">{p.kindLabel}</p>
                  <p className="truncate text-[14px] text-white/90">{p.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => viewPendingProposal(p.id)}
                  className="flex min-h-[46px] shrink-0 items-center justify-center rounded-full bg-violet-500 px-5 py-3 text-[15px] font-semibold text-white shadow-[0_2px_10px_rgba(139,92,246,0.4)] active:bg-violet-600"
                >
                  Voir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recette uniquement (`?voicedebug=1`) : sans écran de lecture sur le
          téléphone, la trace du P0 multi-tours ne prouve rien. */}
      <VoiceTracePanel />
    </div>
  )
}
