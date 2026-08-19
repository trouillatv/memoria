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
// EXCROISSANCES (mandat Vincent, 2026-08-19 — remplace le chantier filaments
// abandonné) : 4 points fixes du même anneau de POINT_COUNT points reçoivent,
// en plus, un terme additif indépendant qui naît et se rétracte lentement
// (cycle dormant→grow→hold→retract→dormant, désynchronisé par excroissance).
// Ce n'est jamais une géométrie séparée : c'est une bosse locale sur le MÊME
// contour fermé, avec une portée angulaire étroite (falloff cosinus sur
// quelques points voisins seulement) — d'où « soudée au corps », jamais un
// filament indépendant. Le facteur final (corps + bosse) reste borné par
// EXCROISSANCE_MAX_FACTOR, volontairement modeste : excroissances courtes,
// pas des tentacules.

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
/** Plafond du facteur de rayon UNE FOIS la bosse d'excroissance ajoutée au corps. */
export const EXCROISSANCE_MAX_FACTOR = 1.48
const PHASE_TRANSITION_MS = 280

const TWO_PI = Math.PI * 2
const ANGLES = Array.from({ length: POINT_COUNT }, (_, i) => i * (TWO_PI / POINT_COUNT))

// 4 points du même anneau, écartement irrégulier (5/3/4/4) pour éviter une
// croix parfaitement symétrique. Ce sont des ANGLES fixes, pas des indices de
// points — la fonction reste continue en angle comme le reste du module.
const EXCROISSANCE_COUNT = 4
const EXCROISSANCE_INDICES = [1, 6, 9, 13]
const EXCROISSANCE_ANGLES = EXCROISSANCE_INDICES.map((i) => i * (TWO_PI / POINT_COUNT))
// Portée angulaire de la bosse : ~1.4 pas de point de large, donc seuls le
// point central et son voisin immédiat de chaque côté sont concernés — bosse
// courte et contenue, jamais un lobe qui gagne tout le contour.
const EXCROISSANCE_WIDTH_RAD = (TWO_PI / POINT_COUNT) * 1.4
// Périodes et déphasages désynchronisés par excroissance (ms) — mouvement
// visqueux et lent, jamais deux excroissances qui respirent à l'unisson.
const EXCROISSANCE_PERIODS = [11_000, 12_700, 14_400, 16_100]
const EXCROISSANCE_OFFSETS = [0, 2_600, 5_300, 8_100]
// Fractions du cycle (dormant la majorité du temps → rare, jamais 4 excroissances
// pleinement sorties en même temps) : dormant 0-60%, grow 60-72%, hold 72-84%,
// retract 84-96%, dormant 96-100%.
const EXCROISSANCE_DORMANT_END = 0.6
const EXCROISSANCE_GROW_END = 0.72
const EXCROISSANCE_HOLD_END = 0.84
const EXCROISSANCE_RETRACT_END = 0.96

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
  /** Profondeur de la bosse d'excroissance à pleine extension (voir EXCROISSANCE_*). */
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
  excroissanceAmplitude: 0.05,
}

// Table phase → paramètres. `idle`/`ready`/`exiting` partagent la respiration
// la plus neutre : `idle` ne rend jamais rien côté composant (l'overlay est
// démonté), mais la fonction doit rester définie pour toute valeur du type.
//
// Recalibrage post-recette téléphone (retour Vincent, 2026-08-19) : la
// première passe (restAmplitude ~0.02, audioAmplitude listening 0.12) était
// sous le seuil de perception à 112px — une capture au repos ressemblait à un
// cercle parfait. `restAmplitude` de chaque phase est remontée en conservant
// son ratio relatif à `RESTING` ; seul `listening.audioAmplitude` (voix) et
// `thinking`/`speaking.internalAmplitude` (mouvement interne) sont montés
// séparément, sur demande explicite. Fréquences, `baseScale` et clamps
// inchangés.
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
    excroissanceAmplitude: 0.06,
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
    excroissanceAmplitude: 0.09,
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
    excroissanceAmplitude: 0.05,
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
    excroissanceAmplitude: 0.05,
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
    excroissanceAmplitude: 0.12,
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
    excroissanceAmplitude: 0.08,
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

/** Enveloppe 0..1 d'une excroissance : dormant → grow → hold → retract → dormant, cycle propre. */
function excroissanceEnvelope(t: number, index: number): number {
  const period = EXCROISSANCE_PERIODS[index]
  const offset = EXCROISSANCE_OFFSETS[index]
  const u = (((t + offset) % period) + period) % period / period
  if (u < EXCROISSANCE_DORMANT_END) return 0
  if (u < EXCROISSANCE_GROW_END) {
    return smoothstep((u - EXCROISSANCE_DORMANT_END) / (EXCROISSANCE_GROW_END - EXCROISSANCE_DORMANT_END))
  }
  if (u < EXCROISSANCE_HOLD_END) return 1
  if (u < EXCROISSANCE_RETRACT_END) {
    return 1 - smoothstep((u - EXCROISSANCE_HOLD_END) / (EXCROISSANCE_RETRACT_END - EXCROISSANCE_HOLD_END))
  }
  return 0
}

function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % TWO_PI
  return d > Math.PI ? TWO_PI - d : d
}

/** Bosse locale (jamais un lobe global) : falloff cosinus autour de chaque excroissance active. */
function excroissanceTerm(angle: number, t: number, amplitude: number): number {
  if (amplitude <= 0) return 0
  let sum = 0
  for (let e = 0; e < EXCROISSANCE_COUNT; e++) {
    const dist = angularDistance(angle, EXCROISSANCE_ANGLES[e])
    if (dist > EXCROISSANCE_WIDTH_RAD) continue
    const falloff = 0.5 * (1 + Math.cos((Math.PI * dist) / EXCROISSANCE_WIDTH_RAD))
    sum += falloff * excroissanceEnvelope(t, e)
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
