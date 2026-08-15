'use client'

// Mesure du délai ressenti entre la fin de la phrase et le premier son de
// MemorIA — instrument, pas optimisation.
//
// Raison d'être : le délai perçu à l'usage ("je vous ai entendu…" → "je prépare
// ça…" → réponse) additionne au moins quatre étapes indépendantes, dont trois
// n'ont rien à voir avec la voix. Sans les séparer, toute optimisation serait
// une intuition — et le premier réflexe (raccourcir la VAD, alléger la
// transcription contextualisée PETRO/SSI) sacrifierait de la qualité pour
// peut-être rien.
//
// Ce module ne fait donc QUE mesurer :
//
//   fin de parole ──▶ transcription finale ──▶ réponse disponible ──▶ 1er son
//                 (1)                      (2)                    (3)
//
//   (1) arrêt du MediaRecorder + upload + STT backend (prompt lexical compris)
//   (2) aller-retour server action + génération Gemini
//   (3) démarrage réel de `speechSynthesis`
//
// Le seul point de mesure hors de ce fichier est `onstart` de l'utterance, dans
// le contrôleur audio : c'est le premier instant où un son sort réellement.

export type VoiceLatencyStep = 'endOfSpeech' | 'transcript' | 'answer' | 'firstSound'

export type VoiceLatencyReport = {
  /** Fin de parole → transcription finale reçue. */
  transcriptionMs: number | null
  /** Transcription → réponse du copilote disponible. */
  answerMs: number | null
  /** Réponse disponible → premier son réellement émis. `null` si silence. */
  speechStartMs: number | null
  /** Fin de parole → dernier jalon connu. */
  totalMs: number | null
}

const EMPTY: VoiceLatencyReport = {
  transcriptionMs: null,
  answerMs: null,
  speechStartMs: null,
  totalMs: null,
}

/**
 * Au-delà, on considère qu'aucun son ne viendra (sourdine, `spokenText` nul,
 * moteur absent) et on publie la mesure telle quelle.
 */
const SETTLE_MS = 2000

let marks: Partial<Record<VoiceLatencyStep, number>> = {}
let report: VoiceLatencyReport = EMPTY
let settleTimer: ReturnType<typeof setTimeout> | null = null
let published = false

const listeners = new Set<() => void>()

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function delta(from: VoiceLatencyStep, to: VoiceLatencyStep): number | null {
  const a = marks[from]
  const b = marks[to]
  return a == null || b == null ? null : Math.round(b - a)
}

function recompute() {
  const last = marks.firstSound ?? marks.answer ?? marks.transcript ?? null
  report = {
    transcriptionMs: delta('endOfSpeech', 'transcript'),
    answerMs: delta('transcript', 'answer'),
    speechStartMs: delta('answer', 'firstSound'),
    totalMs: last == null || marks.endOfSpeech == null ? null : Math.round(last - marks.endOfSpeech),
  }
  listeners.forEach((l) => l())
}

function publish() {
  if (published) return
  published = true
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  // Une seule ligne, lisible dans les logs du navigateur comme en inspection à
  // distance. Les valeurs sont en millisecondes ; `null` = jalon jamais atteint.
  console.info('[voice-latency]', JSON.stringify(report))
}

/**
 * Enregistre un jalon. Le premier passage gagne : un `onstop` délivré deux fois
 * ou une transcription rejouée ne doit pas fausser la mesure.
 *
 * `endOfSpeech` ouvre une nouvelle session ; tout jalon reçu hors session est
 * ignoré, ce qui évite de mesurer une réponse tapée au clavier.
 */
export function markVoice(step: VoiceLatencyStep) {
  if (typeof window === 'undefined') return

  if (step === 'endOfSpeech') {
    marks = { endOfSpeech: now() }
    published = false
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
    recompute()
    return
  }

  if (marks.endOfSpeech == null) return
  if (marks[step] != null) return
  marks[step] = now()
  recompute()

  if (step === 'firstSound') {
    publish()
    return
  }
  if (step === 'answer') {
    settleTimer = setTimeout(publish, SETTLE_MS)
  }
}

export function subscribeVoiceLatency(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVoiceLatencySnapshot(): VoiceLatencyReport {
  return report
}

export function getServerVoiceLatencySnapshot(): VoiceLatencyReport {
  return EMPTY
}

/** Rendu lisible en une ligne : `parole→texte 1240 · texte→réponse 3100 · …` */
export function formatVoiceLatency(r: VoiceLatencyReport): string | null {
  if (r.totalMs == null) return null
  const seg = (label: string, ms: number | null) => `${label} ${ms == null ? '—' : `${ms}`}`
  return [
    seg('parole→texte', r.transcriptionMs),
    seg('texte→réponse', r.answerMs),
    seg('réponse→son', r.speechStartMs),
    seg('total', r.totalMs),
  ].join(' · ')
}
