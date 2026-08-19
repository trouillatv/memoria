// Silhouette organique de l'orbe vocale — module pur, sans DOM, sans état
// mutable partagé. `computeBlobPath` ne fait qu'évaluer une fonction
// déterministe de (temps, phase, niveau audio) : la RAF de l'appelant reste
// la seule boucle d'animation, ce module n'en crée jamais.
//
// Principe : POINT_COUNT points radiaux fixes, chacun déformé par la somme de
// trois groupes d'harmoniques sinusoïdales — fréquences spatiales (k) et
// temporelles fixes, aucun random par frame :
//   - REST     respiration de fond, toujours active, asymétrique (k=2,3) —
//              certaines zones avancent pendant que d'autres se rétractent,
//              contrairement à un `scale()` uniforme.
//   - AUDIO    réaction à la voix : l'harmonique k=3 croît linéairement avec
//              `audioLevel`, l'harmonique k=5 croît en `audioLevel²` — elle
//              n'émerge qu'aux niveaux élevés. Contour quasi rond à faible
//              niveau, 2-4 lobes au niveau moyen, mouvements plus amples et
//              plus fins au niveau fort.
//   - INTERNAL mouvement "vivant" non corrélé à l'audio (k=2,4), utilisé en
//              thinking/speaking, avec rotation lente optionnelle des lobes.
//
// Chaque groupe est normalisé (coefficients internes ≤ 1) puis multiplié par
// une amplitude propre à la phase — bornée par construction — et l'facteur de
// rayon final est reclampé fermement en sortie : double filet, jamais de
// pointe fine ni de tentacule.

export type VoiceBlobPhase =
  | 'idle'
  | 'entering'
  | 'listening'
  | 'finalizing'
  | 'sending'
  | 'thinking'
  | 'speaking'
  | 'ready'
  | 'error'
  | 'exiting'

export type ComputeBlobPathInput = {
  /** Horodatage en ms — typiquement le `ts` de la RAF appelante. */
  time: number
  phase: VoiceBlobPhase
  /** Niveau audio lissé [0,1] — `smoothedRef.current` de l'overlay. */
  audioLevel: number
  reducedMotion: boolean
  /** Diamètre du SVG en px. Le rayon de base est `size / 2`. */
  size: number
  /**
   * Phase précédente et temps écoulé depuis la transition (ms). Optionnels :
   * sans eux, aucun fondu — les paramètres de `phase` s'appliquent
   * intégralement. Avec eux, un fondu de ~280 ms évite le saut de valeur
   * qu'un changement brutal de table de paramètres produirait en pleine
   * oscillation (déviation disclosée par rapport à la signature conceptuelle
   * du mandat, nécessaire pour respecter « aucune cassure visible »).
   */
  prevPhase?: VoiceBlobPhase | null
  phaseElapsedMs?: number
}

export const POINT_COUNT = 16
export const MIN_BLOB_FACTOR = 0.74
export const MAX_BLOB_FACTOR = 1.26
const PHASE_TRANSITION_MS = 280

const TWO_PI = Math.PI * 2
const ANGLES = Array.from({ length: POINT_COUNT }, (_, i) => i * (TWO_PI / POINT_COUNT))

// Fréquences temporelles fixes (rad/ms). Périodes en commentaire pour
// lisibilité — aucune de ces valeurs ne varie pendant la vie du composant.
const REST_W1 = TWO_PI / 7400 // ~7.4 s
const REST_W2 = TWO_PI / 5300 // ~5.3 s — échonne le binôme orb-breathe existant
const AUDIO_W1 = TWO_PI / 850
const AUDIO_W2 = TWO_PI / 620
const INTERNAL_W1 = TWO_PI / 4000
const INTERNAL_W2 = TWO_PI / 2900

// Déphasages fixes — évitent que les harmoniques de groupes différents ne
// s'alignent systématiquement au même instant.
const REST_PHASE1 = 0.6
const REST_PHASE2 = 2.1
const AUDIO_PHASE1 = 0
const AUDIO_PHASE2 = 1.4
const INTERNAL_PHASE1 = 0.9
const INTERNAL_PHASE2 = 3.4

type PhaseParams = {
  /** Multiplicateur de rayon avant déformation (contraction/recentrage). */
  baseScale: number
  restAmplitude: number
  audioAmplitude: number
  /** Petite composante de scale global secondaire, jamais primaire. */
  audioScale: number
  internalAmplitude: number
  /** rad/ms — rotation lente des lobes internes (thinking). */
  rotationSpeed: number
  /** Profondeur de la modulation rythmique interne (speaking). */
  rhythmDepth: number
  /** rad/ms de l'enveloppe rythmique (speaking). */
  rhythmSpeed: number
}

const RESTING: PhaseParams = {
  baseScale: 1.0,
  restAmplitude: 0.02,
  audioAmplitude: 0,
  audioScale: 0,
  internalAmplitude: 0,
  rotationSpeed: 0,
  rhythmDepth: 0,
  rhythmSpeed: 0,
}

// Table phase → paramètres. `idle`/`ready`/`exiting` partagent la respiration
// la plus neutre : `idle` ne rend jamais rien côté composant (l'overlay est
// démonté), mais la fonction doit rester définie pour toute valeur du type.
const PHASE_PARAMS: Record<VoiceBlobPhase, PhaseParams> = {
  idle: RESTING,
  ready: RESTING,
  exiting: RESTING,
  entering: {
    baseScale: 1.0,
    restAmplitude: 0.026,
    audioAmplitude: 0.05,
    audioScale: 0.02,
    internalAmplitude: 0.015,
    rotationSpeed: 0.00006,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
  listening: {
    baseScale: 1.0,
    restAmplitude: 0.022,
    audioAmplitude: 0.12,
    audioScale: 0.03,
    internalAmplitude: 0,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
  finalizing: {
    baseScale: 0.94,
    restAmplitude: 0.02,
    audioAmplitude: 0.06,
    audioScale: 0.02,
    internalAmplitude: 0.01,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
  sending: {
    baseScale: 0.94,
    restAmplitude: 0.02,
    audioAmplitude: 0.06,
    audioScale: 0.02,
    internalAmplitude: 0.01,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
  thinking: {
    baseScale: 0.9,
    restAmplitude: 0.016,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.055,
    rotationSpeed: 0.00035,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
  speaking: {
    baseScale: 0.95,
    restAmplitude: 0.018,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.045,
    rotationSpeed: 0.00012,
    rhythmDepth: 0.35,
    rhythmSpeed: 0.0045,
  },
  error: {
    baseScale: 1.0,
    restAmplitude: 0.012,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.008,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
  },
}

// Amortissement `prefers-reduced-motion` : la respiration reste perceptible
// (« ne pas retourner à un élément totalement statique »), l'audio et le
// mouvement interne sont fortement réduits.
const REDUCED_REST = 0.5
const REDUCED_AUDIO = 0.15
const REDUCED_INTERNAL = 0.35

function smoothstep(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * (3 - 2 * x)
}

function resolvePhaseParams(phase: VoiceBlobPhase): PhaseParams {
  return PHASE_PARAMS[phase] ?? RESTING
}

function blendParams(a: PhaseParams, b: PhaseParams, t: number): PhaseParams {
  const m = smoothstep(t)
  const lerp = (x: number, y: number) => x + (y - x) * m
  return {
    baseScale: lerp(a.baseScale, b.baseScale),
    restAmplitude: lerp(a.restAmplitude, b.restAmplitude),
    audioAmplitude: lerp(a.audioAmplitude, b.audioAmplitude),
    audioScale: lerp(a.audioScale, b.audioScale),
    internalAmplitude: lerp(a.internalAmplitude, b.internalAmplitude),
    rotationSpeed: lerp(a.rotationSpeed, b.rotationSpeed),
    rhythmDepth: lerp(a.rhythmDepth, b.rhythmDepth),
    rhythmSpeed: lerp(a.rhythmSpeed, b.rhythmSpeed),
  }
}

function resolveParams(input: ComputeBlobPathInput): PhaseParams {
  const current = resolvePhaseParams(input.phase)
  const elapsed = input.phaseElapsedMs ?? PHASE_TRANSITION_MS
  if (!input.prevPhase || input.prevPhase === input.phase || elapsed >= PHASE_TRANSITION_MS) {
    return current
  }
  const previous = resolvePhaseParams(input.prevPhase)
  return blendParams(previous, current, elapsed / PHASE_TRANSITION_MS)
}

/** Somme normalisée (coefficients ≤ 1) — respiration asymétrique, jamais scale-like. */
function restTerm(angle: number, t: number): number {
  return (
    0.62 * Math.sin(2 * angle + t * REST_W1 + REST_PHASE1) +
    0.38 * Math.sin(3 * angle - t * REST_W2 + REST_PHASE2)
  )
}

/** k=3 croît avec audioLevel, k=5 avec audioLevel² — n'émerge qu'au niveau fort. */
function audioTerm(angle: number, t: number, audioLevel: number): number {
  const main = Math.sin(3 * angle + t * AUDIO_W1 + AUDIO_PHASE1)
  const fine = Math.sin(5 * angle - t * AUDIO_W2 + AUDIO_PHASE2)
  return audioLevel * main + 0.6 * audioLevel * audioLevel * fine
}

/** Mouvement interne (thinking/speaking) — rotation lente et indépendante de l'audio. */
function internalTerm(angle: number, t: number, rotation: number): number {
  const a = Math.sin(2 * angle + rotation + t * INTERNAL_W1 + INTERNAL_PHASE1)
  const b = Math.sin(4 * angle - rotation * 1.3 + t * INTERNAL_W2 + INTERNAL_PHASE2)
  return 0.65 * a + 0.35 * b
}

function radiusFactor(angle: number, t: number, audioLevel: number, p: PhaseParams): number {
  const rotation = t * p.rotationSpeed
  const rhythm = p.rhythmDepth > 0 ? 1 + p.rhythmDepth * (0.5 + 0.5 * Math.sin(t * p.rhythmSpeed)) : 1
  const raw =
    p.baseScale +
    p.restAmplitude * restTerm(angle, t) +
    p.audioAmplitude * audioTerm(angle, t, audioLevel) +
    p.internalAmplitude * rhythm * internalTerm(angle, t, rotation) +
    p.audioScale * audioLevel
  return Math.min(MAX_BLOB_FACTOR, Math.max(MIN_BLOB_FACTOR, raw))
}

/** Catmull-Rom (tension 1) → Bézier cubique, courbe fermée — continuité de tangente garantie. */
function pointsToClosedPath(points: Array<[number, number]>): string {
  const n = points.length
  const [x0, y0] = points[0]
  let d = `M${x0.toFixed(2)},${y0.toFixed(2)}`
  for (let i = 0; i < n; i++) {
    const [px0, py0] = points[(i - 1 + n) % n]
    const [px1, py1] = points[i]
    const [px2, py2] = points[(i + 1) % n]
    const [px3, py3] = points[(i + 2) % n]
    const c1x = px1 + (px2 - px0) / 6
    const c1y = py1 + (py2 - py0) / 6
    const c2x = px2 - (px3 - px1) / 6
    const c2y = py2 - (py3 - py1) / 6
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${px2.toFixed(2)},${py2.toFixed(2)}`
  }
  return `${d}Z`
}

export function computeBlobPath(input: ComputeBlobPathInput): string {
  const params = resolveParams(input)
  const audioLevel = Math.min(1, Math.max(0, input.audioLevel))
  const damped: PhaseParams = input.reducedMotion
    ? {
        ...params,
        restAmplitude: params.restAmplitude * REDUCED_REST,
        audioAmplitude: params.audioAmplitude * REDUCED_AUDIO,
        audioScale: params.audioScale * REDUCED_AUDIO,
        internalAmplitude: params.internalAmplitude * REDUCED_INTERNAL,
      }
    : params

  const center = input.size / 2
  const points = ANGLES.map((angle): [number, number] => {
    const factor = radiusFactor(angle, input.time, audioLevel, damped)
    const r = center * factor
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)]
  })
  return pointsToClosedPath(points)
}
