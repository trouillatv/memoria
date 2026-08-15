'use client'

// Sortie vocale de MemorIA — contrôleur UNIQUE.
//
// Raison d'être : il n'existe qu'un seul haut-parleur. Si chaque surface
// appelait `speechSynthesis` de son côté, deux réponses pourraient se
// superposer, et le micro pourrait se rouvrir pendant que MemorIA parle — donc
// se réenregistrer elle-même. Toutes les surfaces passent par ici ; l'orbe lit
// l'état, les feuilles déclenchent la lecture.
//
// V1 = Web Speech API (`speechSynthesis`) : latence quasi nulle, interruption
// synchrone, zéro dépendance, fonctionne en réseau faible. L'API publique
// (`speak` / `stop` / `isSpeechSupported`) est délibérément indépendante de
// cette implémentation : un TTS backend se substituerait ici, sans toucher à un
// seul consommateur.
//
// Deux protections structurelles :
//   1. `generation` monotone — une lecture dont la génération a été dépassée ne
//      peut plus rien écrire. Interdit le double TTS et la lecture tardive
//      d'une réponse périmée, sans dépendre d'un timing.
//   2. `stop()` est synchrone — appelé avant `getUserMedia`, il garantit que le
//      micro ne s'ouvre jamais sur une voix en cours.

import { useSyncExternalStore } from 'react'
import { markVoice } from './voice-latency'
import { traceVoice, synthState } from './voice-trace'

const MUTE_KEY = 'memoria:voice-output-muted'

/**
 * Certains moteurs (iOS non déverrouillé, WebView bridée) n'émettent NI
 * `start` NI `error` : la promesse de parole est simplement perdue. Sans ce
 * garde, l'orbe resterait bloquée en `speaking` pour toujours.
 */
const START_TIMEOUT_MS = 1500

export type VoiceLike = {
  name: string
  lang: string
  voiceURI: string
  localService: boolean
  default: boolean
}

/** Marqueurs de qualité observés chez Apple, Google et Microsoft. */
const QUALITY_MARKERS = /premium|enhanced|neural|siri|wavenet|natural|amélior/i

/**
 * Choix de la voix française, par score et jamais par nom en dur : les noms
 * (« Thomas », « Amélie », « Google français ») varient selon l'OS, la version
 * et les voix téléchargées par l'utilisateur.
 *
 * fr-FR d'abord, puis une voix de qualité si elle est réellement installée,
 * puis la voix par défaut. `localService` n'est qu'un départage : à qualité
 * égale, une voix embarquée continue de fonctionner en réseau faible.
 */
export function pickFrenchVoice<T extends VoiceLike>(voices: T[]): T | null {
  let best: T | null = null
  let bestScore = -1
  for (const v of voices) {
    const lang = (v.lang ?? '').replace('_', '-').toLowerCase()
    if (!lang.startsWith('fr')) continue
    let score = 0
    if (lang === 'fr-fr') score += 100
    if (QUALITY_MARKERS.test(`${v.name ?? ''} ${v.voiceURI ?? ''}`)) score += 40
    if (v.default) score += 5
    if (v.localService) score += 2
    if (score > bestScore) { best = v; bestScore = score }
  }
  return best
}

// ── État observable ───────────────────────────────────────────────────────────

export type SpeechSnapshot = {
  speaking: boolean
  muted: boolean
  supported: boolean
}

const SERVER_SNAPSHOT: SpeechSnapshot = { speaking: false, muted: false, supported: false }

let snapshot: SpeechSnapshot = SERVER_SNAPSHOT
const listeners = new Set<() => void>()

let initialized = false
let primed = false
let generation = 0
let startTimer: ReturnType<typeof setTimeout> | null = null

function emit(patch: Partial<SpeechSnapshot>) {
  const next = { ...snapshot, ...patch }
  if (next.speaking === snapshot.speaking && next.muted === snapshot.muted && next.supported === snapshot.supported) return
  snapshot = next
  listeners.forEach((l) => l())
}

function ensureInit() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const supported = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  let muted = false
  try { muted = window.localStorage.getItem(MUTE_KEY) === '1' } catch { /* stockage indisponible */ }
  emit({ supported, muted })
  if (supported) {
    // `getVoices()` renvoie souvent une liste vide au premier appel : cet
    // abonnement sert uniquement à la faire remplir avant la première lecture.
    try { window.speechSynthesis.getVoices() } catch { /* ignoré */ }
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      try { window.speechSynthesis.getVoices() } catch { /* ignoré */ }
    })
  }
}

function clearStartTimer() {
  if (startTimer) { clearTimeout(startTimer); startTimer = null }
}

/** Coupe toute lecture en cours et invalide ses callbacks. Synchrone. */
function cancelCurrent(origin: string) {
  const from = generation
  generation++
  clearStartTimer()
  if (snapshot.supported) {
    try { window.speechSynthesis.cancel() } catch { /* ignoré */ }
  }
  emit({ speaking: false })
  traceVoice('cancel', { origin, generationBefore: from, generationAfter: generation, synth: synthState() })
}

// ── API publique ──────────────────────────────────────────────────────────────

export function isSpeechSupported(): boolean {
  ensureInit()
  return snapshot.supported
}

export function isSpeaking(): boolean {
  return snapshot.speaking
}

export function isVoiceMuted(): boolean {
  ensureInit()
  return snapshot.muted
}

/**
 * Déverrouillage iOS : Safari n'autorise la synthèse que si une première
 * énonciation part d'un geste utilisateur. Appelé au tap qui ouvre l'orbe, donc
 * bien avant que la réponse existe. Volume nul : rien ne s'entend.
 */
export function primeSpeechOutput() {
  ensureInit()
  // Tracé même quand il ne fait rien : un déverrouillage qui n'a lieu qu'au
  // premier chargement de page est exactement le genre de « une seule fois »
  // qui expliquerait une voix muette au deuxième tour.
  traceVoice('prime', { supported: snapshot.supported, alreadyPrimed: primed })
  if (!snapshot.supported || primed) return
  primed = true
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.lang = 'fr-FR'
    window.speechSynthesis.speak(u)
  } catch { /* déverrouillage impossible : la voix échouera silencieusement */ }
}

/**
 * Prononce une synthèse orale. Renvoie `true` si une lecture a réellement
 * démarré — l'appelant s'en sert pour savoir s'il doit attendre la fin.
 *
 * Un appel annule toujours la lecture précédente, y compris avec un texte vide
 * ou en sourdine : « une seule sortie audio active à la fois » est une règle de
 * la fonction, pas une précaution de l'appelant.
 */
export function speak(text: string | null | undefined): boolean {
  ensureInit()
  cancelCurrent('speak')
  const clean = (text ?? '').trim()

  // Les trois refus sont tracés séparément : « refusé parce qu'en sourdine » et
  // « refusé parce que le serveur n'a rien envoyé » se corrigent à des endroits
  // opposés de la chaîne, et se ressemblent parfaitement à l'oreille.
  if (!snapshot.supported || snapshot.muted) {
    traceVoice('speak-refused', {
      reason: !snapshot.supported ? 'unsupported' : 'muted',
      supported: snapshot.supported, muted: snapshot.muted, textLength: clean.length,
    })
    return false
  }
  if (!clean) {
    traceVoice('speak-refused', { reason: 'empty-text', supported: true, muted: false, textLength: 0 })
    return false
  }

  const gen = generation
  let started = false

  try {
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.lang = 'fr-FR'
    const voice = pickFrenchVoice(window.speechSynthesis.getVoices())
    if (voice) utterance.voice = voice

    const settle = () => {
      if (gen !== generation) return
      clearStartTimer()
      emit({ speaking: false })
    }
    utterance.onstart = () => {
      // Tracé AVANT le contrôle de génération : un `start` périmé est une
      // information, et le taire donnerait à lire un silence du moteur.
      traceVoice('speak-start', { gen, current: generation, stale: gen !== generation, synth: synthState() })
      if (gen !== generation) return
      started = true
      clearStartTimer()
      // Seul instant où un son sort réellement — les autres jalons de la chaîne
      // sont posés par l'orbe. Mesure uniquement, aucun effet sur la lecture.
      markVoice('firstSound')
    }
    utterance.onend = () => {
      traceVoice('speak-end', { gen, current: generation, stale: gen !== generation, started, synth: synthState() })
      settle()
    }
    utterance.onerror = (event) => {
      const kind = (event as SpeechSynthesisErrorEvent)?.error ?? null
      traceVoice('speak-error', { gen, current: generation, error: kind, synth: synthState() })
      settle()
    }

    emit({ speaking: true })
    startTimer = setTimeout(() => {
      if (gen === generation && !started) {
        // Signature exacte du cas C : l'énoncé a été accepté par le moteur et
        // aucun `start` n'est venu.
        traceVoice('speak-start-timeout', { gen, synth: synthState() })
        settle()
      }
    }, START_TIMEOUT_MS)

    traceVoice('speak-call', {
      textLength: clean.length, gen, voice: voice?.name ?? null, synthBefore: synthState(),
    })
    window.speechSynthesis.speak(utterance)
    traceVoice('speak-queued', { gen, synthAfter: synthState() })
    return true
  } catch {
    // Échec TTS totalement non bloquant : le texte reste à l'écran, l'orbe se
    // referme normalement.
    traceVoice('speak-threw', { gen })
    emit({ speaking: false })
    return false
  }
}

/** Arrêt immédiat. Idempotent. */
export function stopSpeaking() {
  ensureInit()
  cancelCurrent('stopSpeaking')
}

/** Préférence d'APPAREIL, persistante, indépendante de l'entrée micro. */
export function setVoiceMuted(muted: boolean) {
  ensureInit()
  if (muted) cancelCurrent('mute')
  try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* stockage indisponible */ }
  emit({ muted })
}

export function toggleVoiceMuted() {
  setVoiceMuted(!isVoiceMuted())
}

// ── Abonnement React ──────────────────────────────────────────────────────────

export function subscribeSpeech(listener: () => void): () => void {
  ensureInit()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getSpeechSnapshot(): SpeechSnapshot {
  return snapshot
}

function getServerSnapshot(): SpeechSnapshot {
  return SERVER_SNAPSHOT
}

export function useSpeechOutput(): SpeechSnapshot {
  return useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, getServerSnapshot)
}
