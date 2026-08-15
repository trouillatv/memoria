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

function emit(event: string, fields: Record<string, unknown>) {
  console.info('[voice-turn]', JSON.stringify({
    turn,
    event,
    at: turnStartedAt ? Math.round(now() - turnStartedAt) : 0,
    ...fields,
  }))
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
