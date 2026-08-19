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
// une amplitude propre à la phase — bornée par construction — et le facteur
// de rayon de CORPS est reclampé fermement en sortie (MIN/MAX_BLOB_FACTOR).
//
// EXCROISSANCES — pseudopode organique, jamais un filament ni une géométrie
// séparée : une bosse locale sur le MÊME contour fermé, soudée au corps.
//   - RÉSOLUTION : POINT_COUNT=24 (au lieu de 16) donne assez de points pour
//     qu'un groupe de voisins dessine une silhouette de langue plutôt qu'une
//     simple bosse — toujours un seul path fermé.
//   - PROFIL DE POIDS : discret, indexé par distance entière en pas de point
//     depuis l'ancre (0/1/2/3 → 1.00/0.65/0.25/0), interpolé linéairement
//     entre pas entiers (utile pendant la dérive angulaire, cf. plus bas). Un
//     groupe de 5 points (centre + 2 voisins de chaque côté) porte la bosse,
//     jamais un point isolé — d'où « base large et arrondie », jamais une
//     pointe.
//   - HIÉRARCHIE : 3 ancres, mais un seul « hero » à poids plein (1.0), les
//     deux autres nettement plus faibles (0.55 / 0.35) — un pseudopode
//     principal lisible, pas trois tentacules équivalents qui brouillent la
//     lecture.
//   - DÉRIVE ANGULAIRE : l'angle de l'ancre dévie légèrement (± quelques
//     degrés, nul en dormance, maximal à mi-cycle actif) pour que la langue
//     semble fléchir plutôt que pulser radialement à l'identique.
//   - ENVELOPPE 4 PHASES, durées ABSOLUES en ms (indépendantes de la période
//     de désync) : naissance (montée douce vers une fraction partielle),
//     extension (montée jusqu'au maximum), maintien (plateau), rétraction.
//     Naissance et rétraction utilisent toutes deux `smoothstep` — départ ET
//     arrivée doux aux deux bouts, jamais une courbe qui accélère brutalement
//     en fin de rétraction (effet « aspiration » à éviter).
//   - PLAFOND : le facteur final (corps + bosse) reste borné par
//     EXCROISSANCE_MAX_FACTOR (1.9, plafond de sécurité — pas une amplitude
//     visée systématiquement).

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
   * oscillation.
   */
  prevPhase?: VoiceBlobPhase | null
  phaseElapsedMs?: number
}

export const POINT_COUNT = 24
export const MIN_BLOB_FACTOR = 0.74
export const MAX_BLOB_FACTOR = 1.26
/** Plafond du facteur de rayon UNE FOIS la bosse d'excroissance ajoutée au corps. */
export const EXCROISSANCE_MAX_FACTOR = 1.9
const PHASE_TRANSITION_MS = 280

const TWO_PI = Math.PI * 2
const ANGLES = Array.from({ length: POINT_COUNT }, (_, i) => i * (TWO_PI / POINT_COUNT))
const STEP_RAD = TWO_PI / POINT_COUNT

// 3 ancres sur l'anneau de POINT_COUNT points, écartement fortement irrégulier
// (9/7/8 pas sur 24) pour éviter toute répartition régulière et empêcher les
// zones d'influence (± 2 pas) de se chevaucher.
const EXCROISSANCE_COUNT = 3
const EXCROISSANCE_INDICES = [1, 10, 17]
const EXCROISSANCE_ANGLES = EXCROISSANCE_INDICES.map((i) => i * (TWO_PI / POINT_COUNT))
// Un seul pseudopode « hero » à poids plein, les deux autres nettement plus
// faibles — la première recette doit permettre de juger UN pseudopode
// convaincant, pas trois lectures concurrentes.
const EXCROISSANCE_HERO_WEIGHTS = [1.0, 0.55, 0.35]
// Profil de poids discret par distance entière en pas de point depuis
// l'ancre — reproduit la cible « 0.25 / 0.65 / 1.00 / 0.65 / 0.25 » (5 points
// : centre + 2 voisins de chaque côté), interpolé linéairement entre pas
// entiers pour rester continu pendant la dérive angulaire.
const WEIGHT_PROFILE = [1.0, 0.65, 0.25, 0]
// Dérive angulaire très légère (~8°) — le pseudopode doit sembler fléchir,
// pas glisser autour du blob. Signe alterné par ancre pour l'asymétrie.
const EXCROISSANCE_DRIFT_RAD = 0.14
const EXCROISSANCE_DRIFT_SIGN = [1, -1, 1]
// Périodes et déphasages désynchronisés par excroissance (ms) — mouvement
// visqueux et lent, jamais deux excroissances qui respirent à l'unisson.
// Duty-cycle (ACTIVE_MS / période) volontairement bas sur les trois ancres :
// une excroissance en pleine sortie doit rester l'exception, pas la norme.
const EXCROISSANCE_PERIODS = [16_000, 19_000, 22_000]
const EXCROISSANCE_OFFSETS = [0, 5_000, 11_000]
// Durées ABSOLUES (ms) des 4 phases actives — indépendantes de la période de
// désync, cible « 25% naissance / 35% extension / 15% maintien / 25%
// rétraction ». La naissance monte à une fraction partielle (cf.
// EXCROISSANCE_NAISSANCE_PEAK) avant que l'extension ne prenne le relais
// jusqu'au maximum ; la rétraction redescend avec la même douceur `smoothstep`
// que la naissance, jamais une chute qui accélère en fin de course.
const EXCROISSANCE_NAISSANCE_MS = 650
const EXCROISSANCE_EXTENSION_MS = 910
const EXCROISSANCE_MAINTIEN_MS = 390
const EXCROISSANCE_RETRACT_MS = 650
const EXCROISSANCE_NAISSANCE_PEAK = 0.3
const EXCROISSANCE_ACTIVE_MS =
  EXCROISSANCE_NAISSANCE_MS + EXCROISSANCE_EXTENSION_MS + EXCROISSANCE_MAINTIEN_MS + EXCROISSANCE_RETRACT_MS

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
  /** Amplitude du pseudopode hero à pleine extension (voir EXCROISSANCE_*). */
  excroissanceAmplitude: number
}

const RESTING: PhaseParams = {
  baseScale: 1.0,
  restAmplitude: 0.07,
  audioAmplitude: 0,
  audioScale: 0,
  internalAmplitude: 0,
  rotationSpeed: 0,
  rhythmDepth: 0,
  rhythmSpeed: 0,
  excroissanceAmplitude: 0.2,
}

// Table phase → paramètres. `idle`/`ready`/`exiting` partagent la respiration
// la plus neutre : `idle` ne rend jamais rien côté composant (l'overlay est
// démonté), mais la fonction doit rester définie pour toute valeur du type.
//
// `excroissanceAmplitude` est le pic du pseudopode HERO (poids 1.0) ; les deux
// ancres secondaires sont automatiquement plus faibles via
// EXCROISSANCE_HERO_WEIGHTS. `thinking` reste la plus haute (mouvement interne
// le plus marqué) ; volontairement expressive — le plafond
// EXCROISSANCE_MAX_FACTOR (1.9) garde une marge confortable à tout instant,
// la validation se fait sur téléphone plutôt qu'en réduisant préventivement.
const PHASE_PARAMS: Record<VoiceBlobPhase, PhaseParams> = {
  idle: RESTING,
  ready: RESTING,
  exiting: RESTING,
  entering: {
    baseScale: 1.0,
    restAmplitude: 0.09,
    audioAmplitude: 0.05,
    audioScale: 0.02,
    internalAmplitude: 0.015,
    rotationSpeed: 0.00006,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.26,
  },
  listening: {
    baseScale: 1.0,
    restAmplitude: 0.08,
    audioAmplitude: 0.24,
    audioScale: 0.03,
    internalAmplitude: 0,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.4,
  },
  finalizing: {
    baseScale: 0.94,
    restAmplitude: 0.07,
    audioAmplitude: 0.06,
    audioScale: 0.02,
    internalAmplitude: 0.01,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.2,
  },
  sending: {
    baseScale: 0.94,
    restAmplitude: 0.07,
    audioAmplitude: 0.06,
    audioScale: 0.02,
    internalAmplitude: 0.01,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.2,
  },
  thinking: {
    baseScale: 0.9,
    restAmplitude: 0.06,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.083,
    rotationSpeed: 0.00035,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.6,
  },
  speaking: {
    baseScale: 0.95,
    restAmplitude: 0.06,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.068,
    rotationSpeed: 0.00012,
    rhythmDepth: 0.35,
    rhythmSpeed: 0.0045,
    excroissanceAmplitude: 0.38,
  },
  error: {
    baseScale: 1.0,
    restAmplitude: 0.04,
    audioAmplitude: 0,
    audioScale: 0,
    internalAmplitude: 0.008,
    rotationSpeed: 0,
    rhythmDepth: 0,
    rhythmSpeed: 0,
    excroissanceAmplitude: 0.03,
  },
}

// Amortissement `prefers-reduced-motion` : la respiration reste perceptible
// (« ne pas retourner à un élément totalement statique »), l'audio et le
// mouvement interne sont fortement réduits.
const REDUCED_REST = 0.5
const REDUCED_AUDIO = 0.15
const REDUCED_INTERNAL = 0.35
const REDUCED_EXCROISSANCE = 0.35

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
    excroissanceAmplitude: lerp(a.excroissanceAmplitude, b.excroissanceAmplitude),
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

type ExcroissanceState = {
  /** 0..1, enveloppe naissance→extension→maintien→rétraction. */
  value: number
  /** 0..1, progression continue sur toute la fenêtre active — pilote la dérive angulaire. */
  activeProgress: number
}

/**
 * État d'une excroissance à l'instant t : dormant → naissance → extension →
 * maintien → rétraction → dormant. Les 4 phases actives ont des durées
 * ABSOLUES en ms placées en fin de période ; le reste (dormant) occupe
 * toujours la majorité du cycle. Naissance et rétraction utilisent
 * `smoothstep` aux deux bouts — jamais une courbe qui traîne puis accélère
 * brutalement (effet « aspiration » explicitement à éviter).
 */
function excroissanceState(t: number, index: number): ExcroissanceState {
  const period = EXCROISSANCE_PERIODS[index]
  const offset = EXCROISSANCE_OFFSETS[index]
  const u = (((t + offset) % period) + period) % period
  const dormantEnd = period - EXCROISSANCE_ACTIVE_MS
  if (u < dormantEnd) return { value: 0, activeProgress: 0 }

  const activeProgress = (u - dormantEnd) / EXCROISSANCE_ACTIVE_MS
  const naissanceEnd = dormantEnd + EXCROISSANCE_NAISSANCE_MS
  const extensionEnd = naissanceEnd + EXCROISSANCE_EXTENSION_MS
  const maintienEnd = extensionEnd + EXCROISSANCE_MAINTIEN_MS
  const retractEnd = maintienEnd + EXCROISSANCE_RETRACT_MS

  if (u < naissanceEnd) {
    const local = smoothstep((u - dormantEnd) / EXCROISSANCE_NAISSANCE_MS)
    return { value: local * EXCROISSANCE_NAISSANCE_PEAK, activeProgress }
  }
  if (u < extensionEnd) {
    const local = smoothstep((u - naissanceEnd) / EXCROISSANCE_EXTENSION_MS)
    return { value: EXCROISSANCE_NAISSANCE_PEAK + local * (1 - EXCROISSANCE_NAISSANCE_PEAK), activeProgress }
  }
  if (u < maintienEnd) {
    return { value: 1, activeProgress }
  }
  if (u < retractEnd) {
    const local = smoothstep((u - maintienEnd) / EXCROISSANCE_RETRACT_MS)
    return { value: 1 - local, activeProgress }
  }
  return { value: 0, activeProgress: 1 }
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % TWO_PI
  return d > Math.PI ? TWO_PI - d : d
}

/** Poids discret par distance en pas de point, interpolé entre pas entiers. */
function profileWeight(stepDist: number): number {
  const maxStep = WEIGHT_PROFILE.length - 1
  if (stepDist >= maxStep) return 0
  const lo = Math.floor(stepDist)
  const hi = lo + 1
  const frac = stepDist - lo
  const a = WEIGHT_PROFILE[lo] ?? 0
  const b = WEIGHT_PROFILE[hi] ?? 0
  return a + (b - a) * frac
}

/**
 * Bosse locale (jamais un lobe global) : groupe de points voisins autour de
 * chaque ancre active, poids décroissant par le profil discret, hiérarchie
 * hero/secondaires, légère dérive angulaire pendant la fenêtre active.
 */
function excroissanceTerm(angle: number, t: number, amplitude: number): number {
  if (amplitude <= 0) return 0
  let sum = 0
  for (let e = 0; e < EXCROISSANCE_COUNT; e++) {
    const { value, activeProgress } = excroissanceState(t, e)
    if (value <= 0) continue
    const drift = EXCROISSANCE_DRIFT_SIGN[e] * EXCROISSANCE_DRIFT_RAD * Math.sin(Math.PI * activeProgress)
    const driftedAngle = EXCROISSANCE_ANGLES[e] + drift
    const stepDist = angularDistance(angle, driftedAngle) / STEP_RAD
    const weight = profileWeight(stepDist)
    if (weight <= 0) continue
    sum += weight * EXCROISSANCE_HERO_WEIGHTS[e] * value
  }
  return amplitude * sum
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
  const body = Math.min(MAX_BLOB_FACTOR, Math.max(MIN_BLOB_FACTOR, raw))
  const bump = excroissanceTerm(angle, t, p.excroissanceAmplitude)
  return Math.min(EXCROISSANCE_MAX_FACTOR, body + bump)
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
        excroissanceAmplitude: params.excroissanceAmplitude * REDUCED_EXCROISSANCE,
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
