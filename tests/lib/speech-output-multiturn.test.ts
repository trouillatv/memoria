import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { voiceReducer, INITIAL_VOICE_STATE, type VoiceState } from '@/lib/voice/voice-session'

/**
 * P0 « la voix ne parle qu'au premier tour ».
 *
 * Ce fichier n'est pas une couverture de confort : c'est l'INSTRUMENT de
 * diagnostic. Le contrôleur audio est exercé sur trois tours consécutifs contre
 * un moteur `speechSynthesis` simulé qui reproduit les sémantiques réelles du
 * navigateur (file d'attente, démarrage asynchrone, `end` émis par `cancel()`).
 *
 * Objectif explicite : distinguer par la PREUVE le cas B (défaut de contrôleur /
 * génération monotone devenue compteur à usage unique) des cas A (serveur), C
 * (moteur Web Speech) et D (audio système), qui ne sont pas observables ici.
 *
 * Corollaire : si tout ce fichier passe sur le contrôleur non modifié, le cas B
 * est éliminé — pas « peu probable », éliminé.
 */

// ── Moteur de synthèse simulé ─────────────────────────────────────────────────

type Handler = (() => void) | null

class FakeUtterance {
  text: string
  lang = ''
  voice: unknown = null
  volume = 1
  onstart: Handler = null
  onend: Handler = null
  onerror: Handler = null
  constructor(text: string) { this.text = text }
}

/**
 * `endOnCancel` reproduit Chrome : `cancel()` interrompt l'énoncé en cours ET
 * émet son `end`. C'est précisément ce que le contrôleur doit encaisser sans
 * invalider le tour SUIVANT.
 */
function createFakeSynth(opts: { endOnCancel?: boolean } = {}) {
  const { endOnCancel = true } = opts
  const spoken: FakeUtterance[] = []
  let queue: FakeUtterance[] = []
  let current: FakeUtterance | null = null
  let startScheduled = false
  let startCount = 0

  function scheduleStart() {
    if (startScheduled || current || queue.length === 0) return
    startScheduled = true
    // Le moteur ne démarre jamais dans le même tick que `speak()` : c'est là que
    // vivent les bugs de séquence `cancel()` puis `speak()`.
    setTimeout(() => {
      startScheduled = false
      if (current || queue.length === 0) return
      current = queue.shift()!
      synth.speaking = true
      synth.pending = queue.length > 0
      startCount++
      current.onstart?.()
    }, 0)
  }

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [] as unknown[],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak(u: FakeUtterance) {
      spoken.push(u)
      queue.push(u)
      synth.pending = current !== null || queue.length > 1
      scheduleStart()
    },
    cancel() {
      const c = current
      queue = []
      current = null
      synth.speaking = false
      synth.pending = false
      if (c && endOnCancel) c.onend?.()
    },
  }

  return {
    synth,
    /** Énoncés réellement passés au moteur — l'appel, pas le son. */
    spoken,
    /** Nombre de `onstart` réellement émis. */
    starts: () => startCount,
    current: () => current,
    /** Fin naturelle de l'énoncé en cours. */
    finishCurrent() {
      const c = current
      current = null
      synth.speaking = false
      c?.onend?.()
      scheduleStart()
    },
  }
}

type Controller = typeof import('@/lib/voice/speech-output')

let engine: ReturnType<typeof createFakeSynth>
let ctl: Controller

async function loadController(opts: { endOnCancel?: boolean } = {}) {
  engine = createFakeSynth(opts)
  // @ts-expect-error — moteur simulé injecté dans jsdom, qui n'implémente pas l'API.
  window.speechSynthesis = engine.synth
  // @ts-expect-error — idem pour le constructeur d'énoncé.
  globalThis.SpeechSynthesisUtterance = FakeUtterance
  vi.resetModules()
  ctl = await import('@/lib/voice/speech-output')
  return ctl
}

/** Démarrage effectif du moteur (le tick que le navigateur prend toujours). */
function letEngineStart() {
  vi.advanceTimersByTime(1)
}

beforeEach(async () => {
  vi.useFakeTimers()
  window.localStorage.clear()
  await loadController()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Les sept non-régressions exigées ──────────────────────────────────────────

describe('P0 — la voix doit fonctionner sur N tours, pas seulement au premier', () => {
  it('trois réponses vocales consécutives → trois lectures acceptées ET démarrées', () => {
    for (let turn = 1; turn <= 3; turn++) {
      // Ce que fait réellement l'orbe avant chaque tour : `startListening()`
      // coupe toute voix en cours pour que le micro ne s'ouvre pas dessus.
      ctl.stopSpeaking()

      expect(ctl.speak(`Réponse du tour ${turn}`), `tour ${turn} refusé par le contrôleur`).toBe(true)
      letEngineStart()

      expect(engine.starts(), `tour ${turn} : aucun son émis`).toBe(turn)
      expect(ctl.isSpeaking()).toBe(true)

      engine.finishCurrent()
      expect(ctl.isSpeaking()).toBe(false)
    }
    expect(engine.spoken.map((u) => u.text)).toEqual([
      'Réponse du tour 1', 'Réponse du tour 2', 'Réponse du tour 3',
    ])
  })

  it('la fin du tour 1 laisse immédiatement un état permettant le tour 2', () => {
    ctl.speak('Premier tour')
    letEngineStart()
    engine.finishCurrent()

    // Aucune temporisation : le tour 2 doit être acceptable à l'instant même.
    expect(ctl.isSpeaking()).toBe(false)
    expect(ctl.speak('Deuxième tour')).toBe(true)
    letEngineStart()
    expect(engine.starts()).toBe(2)
  })

  it('SPEECH_ENDED ne détruit pas la capacité à parler au tour suivant', () => {
    // Le cycle complet de la machine à états, tel que l'orbe l'exécute.
    let s: VoiceState = INITIAL_VOICE_STATE
    const run = (turn: number) => {
      s = voiceReducer(s, { type: 'OPEN' })
      s = voiceReducer(s, { type: 'MIC_READY' })
      s = voiceReducer(s, { type: 'END_OF_SPEECH', reason: 'silence' })
      s = voiceReducer(s, { type: 'AUDIO_READY' })
      s = voiceReducer(s, { type: 'TRANSCRIPT', text: `question ${turn}` })
      expect(s.phase).toBe('thinking')

      ctl.stopSpeaking()
      expect(ctl.speak(`réponse ${turn}`)).toBe(true)
      letEngineStart()
      expect(ctl.isSpeaking()).toBe(true)

      s = voiceReducer(s, { type: 'SPEECH_STARTED' })
      expect(s.phase).toBe('speaking')

      engine.finishCurrent()
      s = voiceReducer(s, { type: 'SPEECH_ENDED' })
      expect(s.phase).toBe('exiting')
      s = voiceReducer(s, { type: 'EXITED' })
      expect(s.phase).toBe('idle')
    }
    run(1); run(2); run(3)
    expect(engine.starts()).toBe(3)
  })

  it('stopSpeaking() pendant le tour 1, puis nouvelle réponse → le tour 2 parle', () => {
    ctl.speak('Réponse longue interrompue')
    letEngineStart()
    expect(ctl.isSpeaking()).toBe(true)

    // Tap sur l'orbe pendant la lecture.
    ctl.stopSpeaking()
    expect(ctl.isSpeaking()).toBe(false)

    expect(ctl.speak('Réponse du tour 2')).toBe(true)
    letEngineStart()
    expect(engine.starts()).toBe(2)
    expect(ctl.isSpeaking()).toBe(true)
  })

  it('sourdine puis réactivation → la réponse suivante parle', () => {
    ctl.setVoiceMuted(true)
    expect(ctl.speak('Réponse en sourdine')).toBe(false)
    letEngineStart()
    expect(engine.starts()).toBe(0)

    ctl.setVoiceMuted(false)
    expect(ctl.speak('Réponse audible')).toBe(true)
    letEngineStart()
    expect(engine.starts()).toBe(1)
  })

  it('génération monotone : elle bloque la VIEILLE réponse, jamais la nouvelle', () => {
    // C'est le piège que Vincent a nommé : un compteur anti-réponse obsolète qui
    // deviendrait un compteur à usage unique interdirait TOUS les tours suivants.
    ctl.speak('Réponse A (périmée)')
    const utteranceA = engine.spoken[0]
    letEngineStart()

    expect(ctl.speak('Réponse B (courante)')).toBe(true)
    letEngineStart()
    expect(ctl.isSpeaking()).toBe(true)

    // La vieille réponse se réveille tardivement : elle ne doit rien écrire.
    utteranceA.onend?.()
    expect(ctl.isSpeaking(), 'un callback périmé a éteint la lecture courante').toBe(true)
    utteranceA.onstart?.()

    // Et la génération suivante doit rester capable de parler.
    engine.finishCurrent()
    expect(ctl.speak('Réponse C')).toBe(true)
    letEngineStart()
    expect(engine.starts()).toBe(3)
  })

  it('fermeture puis réouverture de l’orbe → la voix fonctionne encore', () => {
    // Tour 1 complet, jusqu'à la fermeture de l'orbe.
    ctl.speak('Réponse tour 1')
    letEngineStart()
    engine.finishCurrent()
    ctl.stopSpeaking()          // démontage / fermeture

    // Réouverture : `primeSpeechOutput` est idempotent et n'a plus d'effet.
    ctl.primeSpeechOutput()
    ctl.stopSpeaking()          // startListening du nouveau tour

    expect(ctl.speak('Réponse tour 2')).toBe(true)
    letEngineStart()
    expect(ctl.isSpeaking()).toBe(true)
  })
})

describe('P0 — garde de démarrage et moteurs partiels', () => {
  it('un moteur qui n’émet jamais `start` libère l’orbe sans bloquer le tour suivant', () => {
    // Moteur bridé : `speak()` est accepté, aucun événement ne vient.
    window.speechSynthesis.speak = () => {}
    expect(ctl.speak('Réponse jamais prononcée')).toBe(true)
    expect(ctl.isSpeaking()).toBe(true)

    vi.advanceTimersByTime(1600)
    expect(ctl.isSpeaking(), 'le garde de démarrage n’a pas libéré l’orbe').toBe(false)
  })

  it('`cancel()` qui n’émet PAS `end` (moteurs non-Chrome) ne bloque pas le tour suivant', async () => {
    await loadController({ endOnCancel: false })
    ctl.speak('Tour 1')
    letEngineStart()
    ctl.stopSpeaking()
    expect(ctl.speak('Tour 2')).toBe(true)
    letEngineStart()
    expect(engine.starts()).toBe(2)
    expect(ctl.isSpeaking()).toBe(true)
  })
})
