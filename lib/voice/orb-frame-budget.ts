// Budget de frame pour la couche décorative de l'orbe vocale (mandat Vincent,
// second retour 2026-08-19) : le blob/filaments ne doivent JAMAIS ajouter de
// latence perceptible au pipeline vocal. Ce module ne fait rien seul — il
// n'a ni RAF, ni timer, ni DOM : l'appelant (VoiceOrbOverlay.tsx) mesure le
// coût réel de son propre calcul (`performance.now()` avant/après) et
// l'envoie ici via `record()`. La dégradation (sauter le détail des
// filaments certaines frames) reste une DÉCISION de l'appelant, prise en lisant
// `shouldSkipDetail()` — jamais une action que ce module effectue lui-même.
//
// Moyenne mobile exponentielle (EMA) plutôt qu'une fenêtre glissante : O(1)
// par frame, pas de tableau à faire tourner sur le chemin chaud. Hystérésis
// (seuils DEGRADE/RECOVER distincts) pour éviter un flip-flop entre deux
// frames proches du seuil.
//
// L'historique détaillé (pour `snapshot()`) n'est alloué que si
// `collectHistory` est vrai — en pratique piloté par `voiceDebugEnabled()`
// côté appelant, pour ne jamais payer ce coût en production normale.

const EMA_ALPHA = 0.15
const DEGRADE_THRESHOLD_MS = 4
const RECOVER_THRESHOLD_MS = 2
const HISTORY_SIZE = 120

export type FrameBudgetSnapshot = {
  count: number
  avgMs: number
  p95Ms: number
  over16Count: number
  over33Count: number
}

export type FrameBudget = {
  /** À appeler une fois par frame avec le coût mesuré (ms) du calcul décoratif — jamais celui du pipeline vocal. */
  record(durationMs: number): void
  /** true si l'EMA récente dépasse le seuil de dégradation — l'appelant peut alors sauter le détail (ex. filaments) cette frame. */
  shouldSkipDetail(): boolean
  /** Statistiques debug uniquement — {count:0,...} si l'historique n'a pas été activé. */
  snapshot(): FrameBudgetSnapshot
}

export function createFrameBudget(collectHistory: boolean): FrameBudget {
  let ema = 0
  let hasEma = false
  let degraded = false

  const history: number[] = collectHistory ? new Array(HISTORY_SIZE).fill(0) : []
  let historyCount = 0
  let historyIndex = 0
  let over16Count = 0
  let over33Count = 0

  return {
    record(durationMs: number) {
      ema = hasEma ? ema + (durationMs - ema) * EMA_ALPHA : durationMs
      hasEma = true

      if (!degraded && ema > DEGRADE_THRESHOLD_MS) degraded = true
      else if (degraded && ema < RECOVER_THRESHOLD_MS) degraded = false

      if (collectHistory) {
        history[historyIndex] = durationMs
        historyIndex = (historyIndex + 1) % HISTORY_SIZE
        historyCount = Math.min(HISTORY_SIZE, historyCount + 1)
        if (durationMs > 16.7) over16Count++
        if (durationMs > 33) over33Count++
      }
    },

    shouldSkipDetail() {
      return degraded
    },

    snapshot(): FrameBudgetSnapshot {
      if (!collectHistory || historyCount === 0) {
        return { count: 0, avgMs: 0, p95Ms: 0, over16Count: 0, over33Count: 0 }
      }
      const samples = history.slice(0, historyCount).sort((a, b) => a - b)
      const sum = samples.reduce((acc, v) => acc + v, 0)
      const p95Index = Math.min(samples.length - 1, Math.floor(samples.length * 0.95))
      return {
        count: historyCount,
        avgMs: sum / samples.length,
        p95Ms: samples[p95Index],
        over16Count,
        over33Count,
      }
    },
  }
}
