'use client'

// Trace de la chaîne vocale, tour par tour — instrument de diagnostic, pas
// journalisation applicative.
//
// Constat terrain (2026-08-15) : la voix ne se fait entendre qu'au PREMIER tour
// d'une conversation ; au deuxième, la réponse écrite arrive mais aucun son ne
// sort. Quatre causes possibles, mutuellement exclusives :
//
//   A. `spokenText` absent au tour 2            → défaut serveur / contrat LLM
//   B. `speak()` refuse le tour 2               → défaut de contrôleur
//   C. `speechSynthesis.speak()` appelé, aucun `start` → moteur Web Speech
//   D. `start` émis, aucun son                  → audio / volume / session OS
//
// Corriger sans savoir laquelle se produit reviendrait à ajouter une
// temporisation au hasard. Ce module ne corrige donc rien : il rend la chaîne
// LISIBLE sur un téléphone réel, en une ligne par événement, toutes estampillées
// du numéro de tour. Le numéro de tour est ce qui compte : c'est lui qui montre
// que la chaîne se comporte différemment au deuxième passage.
//
// Strictement fermé par défaut : rien n'est écrit hors `?voicedebug=1`. Les logs
// normaux ne bougent pas.

import { voiceDebugEnabled } from './voice-debug'

let turn = 0
let turnStartedAt = 0

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Ouvre un tour. Appelé à la fin de parole — le même instant que l'origine des
 * temps de `voice-latency`, pour que les deux instruments se lisent ensemble.
 */
export function beginVoiceTurn(): void {
  if (!voiceDebugEnabled()) return
  turn++
  turnStartedAt = now()
  emit('turn-start', {})
}

export function traceVoice(event: string, fields: Record<string, unknown> = {}): void {
  if (!voiceDebugEnabled()) return
  emit(event, fields)
}

// ── Journal lisible SUR l'appareil ───────────────────────────────────────────
//
// La console suffit sur un poste de développement ; sur le téléphone de terrain
// elle n'existe pas. Sans écran de lecture, la trace ne prouve rien et l'on
// retomberait sur une correction spéculative — exactement ce que ce lot refuse.
// D'où ce tampon circulaire : mêmes lignes, exposées à un panneau de recette.
//
// Borné à 200 entrées : au-delà, ce n'est plus un diagnostic, c'est une fuite.

export type VoiceTraceEntry = { turn: number; event: string; at: number; fields: Record<string, unknown> }

const MAX_ENTRIES = 200
let entries: VoiceTraceEntry[] = []
let listeners: Array<() => void> = []

export function subscribeVoiceTrace(listener: () => void): () => void {
  listeners.push(listener)
  return () => { listeners = listeners.filter((l) => l !== listener) }
}

/** Référence stable tant que rien n'est ajouté — contrat `useSyncExternalStore`. */
export function voiceTraceSnapshot(): VoiceTraceEntry[] {
  return entries
}

/** Le journal complet, en texte, pour être recopié depuis le téléphone. */
export function voiceTraceText(): string {
  return entries
    .map((e) => `[${e.turn}] +${e.at}ms ${e.event} ${JSON.stringify(e.fields)}`)
    .join('\n')
}

export function clearVoiceTrace(): void {
  entries = []
  listeners.forEach((l) => l())
}

function emit(event: string, fields: Record<string, unknown>) {
  const entry: VoiceTraceEntry = {
    turn,
    event,
    at: turnStartedAt ? Math.round(now() - turnStartedAt) : 0,
    fields,
  }
  console.info('[voice-turn]', JSON.stringify({ turn: entry.turn, event, at: entry.at, ...fields }))
  entries = [...entries, entry].slice(-MAX_ENTRIES)
  listeners.forEach((l) => l())
}

/**
 * État interne du moteur Web Speech. C'est la seule fenêtre sur le cas C : un
 * `pending` qui reste vrai sans `start` désigne une file bloquée, pas un défaut
 * applicatif. Lu uniquement en debug — la lecture de `speaking` a un coût non
 * nul sur certains moteurs.
 */
export function synthState(): Record<string, unknown> | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  try {
    const s = window.speechSynthesis
    return { speaking: s.speaking, pending: s.pending, paused: s.paused }
  } catch {
    return null
  }
}
