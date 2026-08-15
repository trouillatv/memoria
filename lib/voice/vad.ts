// Détection de fin de parole (VAD) — module pur, sans DOM ni horloge.
//
// L'orbe calcule déjà, à chaque frame RAF, un niveau audio lissé dans [0,1]
// (`smoothedRef` → `--audio-delta`). Ce module ne fait que *lire* ce niveau :
// il ne touche ni au micro, ni au MediaRecorder, ni au rendu. Toutes les
// décisions dépendent uniquement de (niveau, instant) fournis par l'appelant,
// ce qui rend le comportement entièrement testable sans navigateur.
//
// Échelle du niveau attendu
// -------------------------
// PAS le RMS brut. Sur téléphone réel le RMS brut reste dans 0,01–0,08, ce qui
// rend tout seuil absolu illisible. L'orbe normalise déjà (plancher 0,012, max
// attendu 0,28) puis applique une courbe sqrt : c'est cette valeur, dans [0,1],
// qu'il faut pousser ici. Le 0,10 évoqué comme point de départ vit sur cette
// échelle normalisée, pas sur le RMS.
//
// Pourquoi le niveau *lissé* et non la valeur instantanée : le lissage
// asymétrique de l'orbe (montée rapide, descente douce) comble déjà les creux
// entre syllabes. Un signal brut ferait clignoter la détection à chaque
// consonne occlusive.

export type VadConfig = {
  /** Nombre de frames RAF mesurées avant d'armer la détection (~500 ms à 60 fps). */
  calibrationFrames: number
  /** Facteur appliqué au bruit mesuré pour en déduire le seuil de parole. */
  noiseMultiplier: number
  /** Marge ajoutée au bruit mesuré — évite un seuil nul en pièce silencieuse. */
  noiseMargin: number
  /** Bornes du seuil calibré. */
  minThreshold: number
  maxThreshold: number
  /** Durée au-dessus du seuil avant de considérer que la parole a commencé. */
  speechOnsetMs: number
  /** Silence à tenir après la parole pour conclure la phrase. */
  silenceMs: number
  /** Sans aucune parole détectée passé ce délai, on abandonne. */
  noSpeechTimeoutMs: number
  /** Garde-fou absolu : au-delà, on coupe quoi qu'il arrive. */
  maxDurationMs: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  calibrationFrames: 30,
  noiseMultiplier: 2,
  noiseMargin: 0.06,
  // Borne basse = le seuil de départ retenu par Vincent. En dessous, un bruit
  // de chantier continu serait lu comme de la parole et le silence ne
  // surviendrait jamais. Borne haute = symétrique : au-delà, c'est la voix
  // elle-même qui ne franchirait plus le seuil.
  minThreshold: 0.1,
  maxThreshold: 0.35,
  speechOnsetMs: 180,
  // Paramètre qui protège les micro-pauses : une respiration ou une hésitation
  // d'environ 1 s au milieu d'une phrase ne doit pas couper l'enregistrement.
  silenceMs: 1400,
  noSpeechTimeoutMs: 6000,
  maxDurationMs: 30000,
}

/** Signal terminal : émis une seule fois, la VAD devient ensuite inerte. */
export type VadSignal = 'speech-ended' | 'no-speech' | 'max-duration'

export type VadPhase = 'calibrating' | 'waiting' | 'speaking' | 'done'

export type VadSnapshot = {
  phase: VadPhase
  /** null tant que la calibration n'est pas terminée. */
  threshold: number | null
  /** Vrai dès qu'une parole a été reconnue, même si elle s'est arrêtée depuis. */
  speechDetected: boolean
}

export type Vad = {
  /**
   * À appeler à chaque frame RAF avec le niveau lissé [0,1] et l'instant courant.
   * Renvoie un signal terminal la première fois qu'une condition d'arrêt est
   * remplie, `null` sinon — y compris après le signal (la VAD est alors inerte).
   */
  push: (level: number, nowMs: number) => VadSignal | null
  snapshot: () => VadSnapshot
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function clampThreshold(noiseLevel: number, config: VadConfig = DEFAULT_VAD_CONFIG): number {
  const raw = noiseLevel * config.noiseMultiplier + config.noiseMargin
  return Math.min(config.maxThreshold, Math.max(config.minThreshold, raw))
}

export function createVad(startedAtMs: number, config: VadConfig = DEFAULT_VAD_CONFIG): Vad {
  const samples: number[] = []
  let phase: VadPhase = 'calibrating'
  let threshold: number | null = null
  let speechDetected = false
  // Instant depuis lequel le niveau est continûment au-dessus du seuil.
  let aboveSinceMs: number | null = null
  // Dernier instant où de la voix a été entendue (en phase `speaking`).
  let lastVoiceMs = startedAtMs

  const finish = (signal: VadSignal): VadSignal => {
    phase = 'done'
    return signal
  }

  return {
    push(level, nowMs) {
      if (phase === 'done') return null

      // Calibration : on mesure le fond sonore réel avant d'armer quoi que ce
      // soit. La médiane absorbe un claquement isolé ; les bornes absorbent le
      // cas où l'utilisateur parle déjà pendant la mesure.
      if (phase === 'calibrating') {
        samples.push(level)
        if (samples.length >= config.calibrationFrames) {
          threshold = clampThreshold(median(samples), config)
          phase = 'waiting'
        }
        return null
      }

      const elapsed = nowMs - startedAtMs
      const speaking = level >= (threshold ?? config.minThreshold)

      if (phase === 'waiting') {
        if (speaking) {
          if (aboveSinceMs == null) aboveSinceMs = nowMs
          if (nowMs - aboveSinceMs >= config.speechOnsetMs) {
            phase = 'speaking'
            speechDetected = true
            lastVoiceMs = nowMs
          }
        } else {
          aboveSinceMs = null
        }
        // Le compte à rebours « rien dit » part de l'ouverture du micro, pas de
        // la fin de calibration : c'est ce que l'utilisateur perçoit.
        if (phase === 'waiting' && elapsed >= config.noSpeechTimeoutMs) return finish('no-speech')
        if (elapsed >= config.maxDurationMs) return finish('max-duration')
        return null
      }

      // phase === 'speaking'
      if (speaking) {
        lastVoiceMs = nowMs
      } else if (nowMs - lastVoiceMs >= config.silenceMs) {
        return finish('speech-ended')
      }
      // La fin naturelle prime sur le garde-fou quand les deux tombent ensemble.
      if (elapsed >= config.maxDurationMs) return finish('max-duration')
      return null
    },

    snapshot: () => ({ phase, threshold, speechDetected }),
  }
}
