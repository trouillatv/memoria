// Filaments énergétiques de l'orbe vocale — module pur, sans DOM, sans état
// mutable partagé. Comme `blob-shape.ts`, `computeFilaments` n'évalue qu'une
// fonction déterministe de (temps, phase, niveau audio) : la RAF de
// l'appelant reste la seule boucle d'animation, et reste seule maîtresse du
// budget de frame — ce module ne fait jamais d'`await`, ne pose aucun timer,
// ne lit ni n'écrit le DOM.
//
// Direction (retour Vincent, 2026-08-19, deux passes) :
//   - un unique path fermé ne peut pas représenter des filaments indépendants
//     qui naissent, s'étirent, se rétractent et se ramifient — certains
//     devant le noyau, d'autres derrière ;
//   - « 7 filaments ≠ 7 tentacules visibles » : à un instant donné, seule une
//     fraction du pool doit être active (quelques prolongements courts, 2-3
//     plus affirmés), pas la totalité en permanence — d'où la phase DORMANT
//     ci-dessous, absente de la toute première ébauche ;
//   - un filament ne doit pas apparaître/disparaître par fondu d'opacité : il
//     doit sortir physiquement du noyau (longueur ET largeur qui croissent
//     ensemble depuis la base), vivre, puis y rentrer — d'où le rendu en
//     ruban effilé (`buildRibbon`) et non plus un simple trait à largeur
//     constante ;
//   - les branches doivent être occasionnelles, naître d'un filament
//     PRÉSENT (pas du noyau), rester plus courtes/fines que leur parent, et
//     disparaître avec lui.
//
// Contrainte non négociable (Vincent, 2026-08-19, second retour) : ce module
// reste décoratif et asynchrone du pipeline vocal. Aucun `Math.random()`,
// aucun état React, un nombre fixe et petit de filaments (5 primaires + 2
// ramifications), peu de points échantillonnés par courbe, aucune physique
// ni collision. La dégradation sous charge (sauter le calcul des filaments
// certaines frames) est la responsabilité de l'appelant — cf.
// `orb-frame-budget.ts` — jamais de ce module, qui reste un pur calcul
// géométrique sans notion de coût.
//
// Stade 1 (ce module) : squelette — géométrie, cycle de vie à quatre phases,
// ramification gatée sur le parent, ruban effilé, calque avant/arrière,
// réactivité de phase. Stade 2 (à venir, une fois le squelette validé au
// téléphone) : petits points lumineux voyageant vers le noyau pendant
// `thinking` et arcs de connexion transitoires entre deux pointes.
//
// Correction géométrique (retour recette téléphone, troisième passe
// 2026-08-19) : la première version du ruban lisait « épines/crochets », pas
// « fibres neurales » — base bien trop épaisse par rapport à la longueur,
// courbure trop faible (sortie quasi rectiligne du noyau), silhouette trop
// courte. `baseWidthFactor` est divisé par ~2,5, `bend` et les offsets de
// contrôle de courbe sont renforcés, `maxReachFactor`/`reachScale` sont
// remontés pour approcher 1,4–1,7× le rayon du noyau dans les phases
// actives, et l'opacité est réduite (aspect semi-transparent, lumineux)
// pour que le noyau reste dominant (~65-70 % du poids visuel).
//
// Stade 1.1 (mandat Vincent, 2026-08-19, quatrième passe) : le retour
// géométrique persistait même après la correction de paramètres ci-dessus —
// la cause n'était pas l'ampleur des paramètres mais la TECHNIQUE de rendu
// elle-même. Un ruban rempli (polygone fermé, `fill`) a toujours une base
// large et un contour net : à cette échelle il se lit comme un « triangle
// collé au noyau », jamais comme une fibre. `buildRibbon` est donc remplacé
// par `buildOpenPath` : un unique tracé de Bézier cubique OUVERT
// (`M origine C ctrl1 ctrl2 pointe`), peint en `stroke` (jamais `fill`), à
// largeur fine et CONSTANTE par filament (`strokeWidthFactor`, dérivé du
// seul index — aucune modulation par le cycle de vie : ce qui « grandit »
// pendant grow/hold reste la longueur et l'ondulation, jamais la largeur).
// La luminosité centre→pointe, le fondu base-dans-le-halo et
// `stroke-linecap: round` sont portés par le rendu (dégradé radial statique
// + arrondi SVG côté VoiceOrbOverlay), pas par ce module : `computeFilaments`
// n'a plus besoin de connaître la couleur, seulement la géométrie et une
// largeur de trait.

import type { VoiceBlobPhase } from './blob-shape'

export type FilamentLayer = 'back' | 'front'

export type Filament = {
  /** Path SVG OUVERT (Bézier cubique, `M...C...`), destiné à être peint en `stroke` — jamais `fill`. Chaîne vide si le filament est dormant — rien à peindre. */
  d: string
  /** Constante par calque/phase — jamais utilisée pour faire apparaître/disparaître un filament. */
  opacity: number
  layer: FilamentLayer
  /** Largeur de trait — constante pour un filament donné (dérivée de l'index, pas du cycle de vie). 0 si dormant. */
  strokeWidth: number
}

export type ComputeFilamentsInput = {
  /** Horodatage en ms — le `ts` de la RAF appelante, même horloge que le noyau. */
  time: number
  phase: VoiceBlobPhase
  /** Niveau audio lissé [0,1] — même source que le noyau (`smoothedRef.current`). */
  audioLevel: number
  reducedMotion: boolean
  centerX: number
  centerY: number
  /** Rayon de référence du noyau — ancre la base des filaments primaires nettement à l'intérieur de sa silhouette. */
  coreRadius: number
  /** Cf. `ComputeBlobPathInput` dans blob-shape.ts — même mécanique de fondu de phase. */
  prevPhase?: VoiceBlobPhase | null
  phaseElapsedMs?: number
}

export const PRIMARY_COUNT = 5
export const BRANCH_COUNT = 2
export const FILAMENT_COUNT = PRIMARY_COUNT + BRANCH_COUNT

/** Calque avant/arrière par slot — dérivé de l'index, stable, exposé pour que
 *  l'appelant partitionne son rendu (groupe `back` peint avant le noyau,
 *  `front` après) sans dupliquer la géométrie interne. */
export const FILAMENT_LAYERS: FilamentLayer[] = Array.from({ length: FILAMENT_COUNT }, (_, i) => (i % 3 === 0 ? 'back' : 'front'))

const TWO_PI = Math.PI * 2
const PHASE_TRANSITION_MS = 280
/** Angle d'or (rad) — répartit les origines des filaments primaires sans les aligner. */
const GOLDEN_ANGLE = 2.399963229728653
/** En dessous, un filament est considéré dormant : rien n'est construit ni peint. */
const RENDER_LENGTH_THRESHOLD = 1.2
/** Un filament de ramification ne se montre que si son parent a déjà bien émergé. */
const BRANCH_PARENT_THRESHOLD = 0.45

type PhaseActivity = {
  /** Multiplicateur global de la portée en régime établi (0..~1). */
  reachScale: number
  /** Portée additionnelle proportionnelle à `audioLevel` (écoute). */
  audioReach: number
  /** Amplitude du tremblement rapide (syllabes / vivacité) — aussi modulée par l'audio en écoute. */
  jitterAmp: number
  /** Multiplicateur de la dérive lente (flottement, changement de direction). */
  driftMul: number
  /** Multiplicateur de VITESSE de la dérive — indépendant de son amplitude (« lent » ≠ « peu ample »). */
  driftSpeedMul: number
  /** Visibilité additionnelle des filaments de ramification (avant gate sur le parent). */
  branchBoost: number
  /** Profondeur de la pulsation rythmique (parole, sans amplitude audio réelle en sortie). */
  rhythmDepth: number
  rhythmSpeedMs: number
  opacityFront: number
  opacityBack: number
}

const CALM: PhaseActivity = {
  reachScale: 0.46, audioReach: 0, jitterAmp: 0.022, driftMul: 0.85, driftSpeedMul: 1,
  branchBoost: 0.25, rhythmDepth: 0, rhythmSpeedMs: 0,
  opacityFront: 0.46, opacityBack: 0.2,
}

// idle/ready/exiting partagent la respiration la plus neutre — cf. la même
// convention dans blob-shape.ts (`RESTING`). Le cycle de vie tourne en
// permanence quelle que soit la phase (cf. `lifeEnvelope`) : « déjà vivante,
// disponible » ne dépend pas d'un déclenchement, seule l'AMPLITUDE en dépend.
const PHASE_ACTIVITY: Record<VoiceBlobPhase, PhaseActivity> = {
  idle: CALM,
  ready: CALM,
  exiting: CALM,
  entering: {
    reachScale: 0.6, audioReach: 0.08, jitterAmp: 0.04, driftMul: 1.05, driftSpeedMul: 1,
    branchBoost: 0.3, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.5, opacityBack: 0.24,
  },
  listening: {
    // « les filaments deviennent sensibles au son » — la portée reste bornée
    // par `audioReach`, la voix donne de la présence sans jamais faire
    // « grossir l'ensemble » d'un bloc (cf. `jitterAmp` modulé par l'audio
    // dans `computeFilaments`, pas ici). `reachScale` remonté (retour
    // téléphone) pour un vrai déploiement dans l'espace, pas un frémissement.
    reachScale: 0.8, audioReach: 0.48, jitterAmp: 0.075, driftMul: 1, driftSpeedMul: 1,
    branchBoost: 0.32, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.58, opacityBack: 0.26,
  },
  finalizing: {
    // Baseline déjà resserrée ; le vrai retour vers le centre vient de
    // `contractionPulse`, appliqué seulement dans les ~400 ms qui suivent la
    // transition depuis `listening`. « ne fais pas tout disparaître » : la
    // baseline reste non nulle.
    reachScale: 0.32, audioReach: 0.06, jitterAmp: 0.035, driftMul: 0.75, driftSpeedMul: 1,
    branchBoost: 0.15, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.4, opacityBack: 0.18,
  },
  sending: {
    reachScale: 0.34, audioReach: 0.05, jitterAmp: 0.03, driftMul: 0.7, driftSpeedMul: 1,
    branchBoost: 0.15, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.38, opacityBack: 0.17,
  },
  thinking: {
    // « déplacements LENTS, changements de direction » — vitesse de dérive
    // réduite (`driftSpeedMul`), pas amplifiée : la sensation recherchée est
    // exploratoire, pas nerveuse. `reachScale`/`branchBoost` remontés : c'est
    // la phase la plus « affirmée » du Stade 1, avant les arcs du Stade 2.
    reachScale: 0.88, audioReach: 0, jitterAmp: 0.05, driftMul: 1.25, driftSpeedMul: 0.55,
    branchBoost: 0.78, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.64, opacityBack: 0.32,
  },
  speaking: {
    // Pas d'amplitude audio réelle en sortie (le micro ne mesure pas la
    // synthèse vocale). `rhythmDepth` reste faible et déphasé par filament
    // (cf. `computeFilaments`) : « un mouvement plus ouvert, PAS une simple
    // pulsation » — si tous les filaments gonflaient à l'unisson, ce serait
    // exactement l'effet à éviter.
    reachScale: 0.86, audioReach: 0, jitterAmp: 0.075, driftMul: 1.5, driftSpeedMul: 1.1,
    branchBoost: 0.42, rhythmDepth: 0.14, rhythmSpeedMs: 0.0045,
    opacityFront: 0.62, opacityBack: 0.29,
  },
  error: {
    reachScale: 0.3, audioReach: 0, jitterAmp: 0.02, driftMul: 0.6, driftSpeedMul: 1,
    branchBoost: 0.1, rhythmDepth: 0, rhythmSpeedMs: 0,
    opacityFront: 0.32, opacityBack: 0.14,
  },
}

const REDUCED_JITTER = 0.2
const REDUCED_DRIFT = 0.4
const REDUCED_REACH = 0.7

function smoothstep(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * (3 - 2 * x)
}

function resolveActivity(phase: VoiceBlobPhase): PhaseActivity {
  return PHASE_ACTIVITY[phase] ?? CALM
}

function blendActivity(a: PhaseActivity, b: PhaseActivity, t: number): PhaseActivity {
  const m = smoothstep(t)
  const lerp = (x: number, y: number) => x + (y - x) * m
  return {
    reachScale: lerp(a.reachScale, b.reachScale),
    audioReach: lerp(a.audioReach, b.audioReach),
    jitterAmp: lerp(a.jitterAmp, b.jitterAmp),
    driftMul: lerp(a.driftMul, b.driftMul),
    driftSpeedMul: lerp(a.driftSpeedMul, b.driftSpeedMul),
    branchBoost: lerp(a.branchBoost, b.branchBoost),
    rhythmDepth: lerp(a.rhythmDepth, b.rhythmDepth),
    rhythmSpeedMs: lerp(a.rhythmSpeedMs, b.rhythmSpeedMs),
    opacityFront: lerp(a.opacityFront, b.opacityFront),
    opacityBack: lerp(a.opacityBack, b.opacityBack),
  }
}

function resolveActivityBlend(input: ComputeFilamentsInput): PhaseActivity {
  const current = resolveActivity(input.phase)
  const elapsed = input.phaseElapsedMs ?? PHASE_TRANSITION_MS
  if (!input.prevPhase || input.prevPhase === input.phase || elapsed >= PHASE_TRANSITION_MS) {
    return current
  }
  const previous = resolveActivity(input.prevPhase)
  return blendActivity(previous, current, elapsed / PHASE_TRANSITION_MS)
}

/**
 * Pulsation de contraction : un creux bref (~400 ms) juste après une
 * transition listening → finalizing, avant de relâcher vers la baseline de
 * `finalizing`. « comme si l'information était absorbée » — mais jamais à
 * zéro : `1 - 0.5*dip` garde toujours une présence minimale.
 */
function contractionPulse(input: ComputeFilamentsInput): number {
  if (input.phase !== 'finalizing' || input.prevPhase !== 'listening') return 1
  const elapsed = input.phaseElapsedMs ?? 999
  const WINDOW = 400
  if (elapsed >= WINDOW) return 1
  const x = elapsed / WINDOW
  const dip = Math.sin(Math.PI * smoothstep(Math.min(1, x / 0.5))) * (1 - smoothstep(x))
  return 1 - 0.5 * dip
}

type EnvelopeShape = { dormantFrac: number; growFrac: number; holdFrac: number }

type SlotGeometry = {
  isBranch: boolean
  parentIndex: number
  parentT: number
  baseAngle: number
  cycleMs: number
  offsetMs: number
  maxReachFactor: number
  bend: number
  bendFreq1: number
  bendFreq2: number
  bendPhase1: number
  bendPhase2: number
  driftFreq: number
  driftAmp: number
  driftPhase: number
  jitterFreq: number
  jitterPhase: number
  strokeWidthFactor: number
  envelope: EnvelopeShape
  layer: FilamentLayer
}

/** Dérive tous les paramètres d'un slot depuis son seul index — déterministe, aucun tirage par frame. */
function slotGeometry(i: number): SlotGeometry {
  const isBranch = i >= PRIMARY_COUNT
  const parentIndex = isBranch ? ((i - PRIMARY_COUNT) * 2) % PRIMARY_COUNT : -1

  // Poids relatifs (pas des fractions directement) : la normalisation par le
  // total garantit dormant+grow+hold+retract = 1 sans jamais produire de
  // rétraction négative, quelle que soit la variation par slot ci-dessous.
  const dormantW = isBranch ? 5.2 + (i % 3) * 0.6 : 3.0 + (i % 4) * 0.5
  const growW = isBranch ? 0.6 + (i % 2) * 0.2 : 0.9 + (i % 3) * 0.15
  const holdW = isBranch ? 0.9 + (i % 3) * 0.25 : 1.7 + (i % 3) * 0.3
  const retractW = isBranch ? 0.8 + (i % 2) * 0.2 : 1.3 + (i % 2) * 0.25
  const totalW = dormantW + growW + holdW + retractW

  return {
    isBranch,
    parentIndex,
    parentT: 0.5 + ((i * 0.13) % 0.22),
    baseAngle: (i * GOLDEN_ANGLE) % TWO_PI,
    cycleMs: (isBranch ? 2600 : 3400) + ((i * 733) % 2700),
    offsetMs: (i * 1187) % 5000,
    // Portée remontée (retour téléphone) pour approcher 1,4–1,7× le rayon du
    // noyau dans les phases actives, en gardant l'asymétrie (certains slots
    // nettement plus longs que d'autres — jamais un rayonnement uniforme).
    maxReachFactor: (isBranch ? 0.45 : 1.35) + ((i * 0.37) % 1) * (isBranch ? 0.35 : 0.85),
    // Courbure renforcée : la version initiale sortait quasi droite du
    // noyau (lecture « épine »). Un bend plus marqué + des offsets de
    // courbe plus généreux (cf. `buildCurve`) donnent l'ondulation qui lit
    // « fibre neurale » plutôt que « pointe ».
    bend: (i % 2 === 0 ? 1 : -1) * (0.34 + ((i * 0.05) % 0.38)),
    bendFreq1: (TWO_PI / 2600) * (1 + i * 0.09),
    bendFreq2: (TWO_PI / 1900) * (1 + i * 0.07),
    bendPhase1: i * 0.7,
    bendPhase2: i * 1.3 + 0.4,
    driftFreq: (TWO_PI / 6200) * (1 + i * 0.05),
    driftAmp: 0.12 + ((i * 0.11) % 1) * 0.1,
    driftPhase: i * 0.9,
    jitterFreq: (TWO_PI / 220) * (1 + (i % 4) * 0.31),
    jitterPhase: i * 2.1,
    // Trait fin et CONSTANT (Stade 1.1) : ce n'est plus la largeur d'une base
    // de ruban mais l'épaisseur uniforme du `stroke` sur toute la longueur du
    // filament — d'où des facteurs nettement plus petits que l'ancien
    // `baseWidthFactor`. Un filament se lit comme un trait lumineux flexible,
    // pas comme une surface pleine attachée au noyau.
    strokeWidthFactor: (isBranch ? 0.02 : 0.034) + ((i * 0.09) % 1) * (isBranch ? 0.01 : 0.018),
    envelope: { dormantFrac: dormantW / totalW, growFrac: growW / totalW, holdFrac: holdW / totalW },
    layer: FILAMENT_LAYERS[i],
  }
}

/**
 * Enveloppe de cycle de vie [0,1] à QUATRE phases : dormant (rien, rentré
 * dans le noyau) → croissance → tenue → rétraction, périodique. La phase
 * dormante est ce qui garantit qu'à un instant donné seule une fraction du
 * pool est visible — pas les 7 filaments en permanence.
 */
function lifeEnvelope(time: number, slot: SlotGeometry): number {
  const t = ((time + slot.offsetMs) % slot.cycleMs + slot.cycleMs) % slot.cycleMs
  const x = t / slot.cycleMs
  const { dormantFrac, growFrac, holdFrac } = slot.envelope
  if (x < dormantFrac) return 0
  const xg = x - dormantFrac
  if (xg < growFrac) return smoothstep(xg / growFrac)
  const xh = xg - growFrac
  if (xh < holdFrac) return 1
  const retractFrac = 1 - dormantFrac - growFrac - holdFrac
  const xr = xh - holdFrac
  return 1 - smoothstep(xr / Math.max(0.001, retractFrac))
}

function cubicBezierPoint(
  p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number,
): [number, number] {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

type FilamentCurve = { origin: [number, number]; control1: [number, number]; control2: [number, number]; tip: [number, number] }

function buildCurve(origin: [number, number], angle: number, length: number, bend: number, wobble1: number, wobble2: number): FilamentCurve {
  const [ox, oy] = origin
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const tip: [number, number] = [ox + dx * length, oy + dy * length]
  // Offsets de courbe renforcés (0.35→0.5, 0.3→0.42) : une centerline qui
  // s'incurve nettement plutôt qu'une quasi-droite légèrement ployée — c'est
  // cette ondulation qui distingue une fibre neurale d'un pic rectiligne.
  const control1: [number, number] = [
    ox + dx * length * 0.33 + px * bend * length * 0.5 * wobble1,
    oy + dy * length * 0.33 + py * bend * length * 0.5 * wobble1,
  ]
  const control2: [number, number] = [
    ox + dx * length * 0.66 - px * bend * length * 0.42 * wobble2,
    oy + dy * length * 0.66 - py * bend * length * 0.42 * wobble2,
  ]
  return { origin, control1, control2, tip }
}

/** Trace ouvert (Bézier cubique unique) le long de la centerline — destiné à être peint en `stroke`, jamais `fill`. Un seul segment : pas d'échantillonnage, coût minimal. */
function buildOpenPath(curve: FilamentCurve): string {
  const [ox, oy] = curve.origin
  const [c1x, c1y] = curve.control1
  const [c2x, c2y] = curve.control2
  const [tx, ty] = curve.tip
  return `M${ox.toFixed(2)},${oy.toFixed(2)} C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${tx.toFixed(2)},${ty.toFixed(2)}`
}

export function computeFilaments(input: ComputeFilamentsInput): Filament[] {
  const activity = resolveActivityBlend(input)
  const audioLevel = Math.min(1, Math.max(0, input.audioLevel))
  const contraction = contractionPulse(input)
  const reducedMotion = input.reducedMotion

  // L'audio module la vivacité locale (courbure, tremblement) en écoute,
  // jamais un simple facteur d'échelle global — cf. retour Vincent : « la
  // voix ne doit plus simplement faire grossir l'ensemble ».
  const jitterAudioBoost = 1 + audioLevel * activity.audioReach
  const jitterAmp = activity.jitterAmp * jitterAudioBoost * (reducedMotion ? REDUCED_JITTER : 1)
  const driftMul = activity.driftMul * (reducedMotion ? REDUCED_DRIFT : 1)
  const reachMul = reducedMotion ? REDUCED_REACH : 1

  const primaryCurves: Array<FilamentCurve | null> = new Array(PRIMARY_COUNT).fill(null)
  const primaryLengths: number[] = new Array(PRIMARY_COUNT).fill(0)
  const primaryEnvelopes: number[] = new Array(PRIMARY_COUNT).fill(0)

  const results: Filament[] = []

  for (let i = 0; i < FILAMENT_COUNT; i++) {
    const slot = slotGeometry(i)
    const life = lifeEnvelope(input.time, slot)

    // Respiration légère pendant la tenue — sans quoi un filament « affirmé »
    // reste figé pendant toute sa phase HOLD.
    const breathe = 1 + 0.05 * Math.sin(input.time * slot.driftFreq * 1.7 + slot.driftPhase)

    const drift = slot.driftAmp * driftMul * Math.sin(input.time * activity.driftSpeedMul * slot.driftFreq + slot.driftPhase)
    const jitter = jitterAmp * Math.sin(input.time * slot.jitterFreq + slot.jitterPhase)
    const rhythm =
      activity.rhythmDepth > 0
        // Déphasé par filament (`slot.driftPhase`) : plusieurs rubans qui
        // respirent à des instants différents, jamais une seule pulsation
        // synchronisée sur l'ensemble du pool.
        ? 1 + activity.rhythmDepth * (0.5 + 0.5 * Math.sin(input.time * activity.rhythmSpeedMs + slot.driftPhase * 3))
        : 1

    let envelope: number
    let origin: [number, number] | null = null
    let parentCurve: FilamentCurve | null = null
    let maxLength: number | null = null

    if (!slot.isBranch) {
      envelope = life
      origin = [
        input.centerX + input.coreRadius * 0.82 * Math.cos(slot.baseAngle),
        input.centerY + input.coreRadius * 0.82 * Math.sin(slot.baseAngle),
      ]
    } else {
      const parentEnvelope = primaryEnvelopes[slot.parentIndex] ?? 0
      const gate = smoothstep((parentEnvelope - BRANCH_PARENT_THRESHOLD) / (1 - BRANCH_PARENT_THRESHOLD))
      envelope = life * gate * Math.min(1, activity.branchBoost * 1.3)
      parentCurve = primaryCurves[slot.parentIndex]
      if (parentCurve) {
        origin = cubicBezierPoint(parentCurve.origin, parentCurve.control1, parentCurve.control2, parentCurve.tip, slot.parentT)
        // Toujours plus courte que son parent — pas seulement en moyenne.
        maxLength = Math.max(0, (primaryLengths[slot.parentIndex] ?? 0) * 0.55)
      }
    }

    const audioBoost = slot.isBranch ? activity.audioReach * 0.4 : activity.audioReach
    const reachFactor =
      slot.maxReachFactor * envelope * activity.reachScale * reachMul * contraction * rhythm * breathe +
      audioBoost * audioLevel * envelope

    const angle = slot.baseAngle + drift + jitter
    let length = Math.max(0, input.coreRadius * reachFactor)
    if (maxLength != null) length = Math.min(length, maxLength)

    let curve: FilamentCurve | null = null
    if (origin && length > RENDER_LENGTH_THRESHOLD && (!slot.isBranch || parentCurve)) {
      const wobble1 = Math.sin(input.time * slot.bendFreq1 + slot.bendPhase1)
      const wobble2 = Math.sin(input.time * slot.bendFreq2 + slot.bendPhase2)
      curve = buildCurve(origin, angle, length, slot.bend, wobble1, wobble2)
    }

    if (!slot.isBranch) {
      primaryCurves[i] = curve
      primaryLengths[i] = length
      primaryEnvelopes[i] = envelope
    }

    if (!curve) {
      results.push({ d: '', opacity: 0, layer: slot.layer, strokeWidth: 0 })
      continue
    }

    // C'est la longueur (et l'ondulation portée par `buildCurve`) qui
    // « sort » du noyau — plus la largeur : un trait fin et constant reste
    // un trait, même en train de grandir. La largeur ne dépend donc plus de
    // `envelope`.
    const strokeWidth = input.coreRadius * slot.strokeWidthFactor
    const d = buildOpenPath(curve)
    const opacityBase = slot.layer === 'front' ? activity.opacityFront : activity.opacityBack

    results.push({ d, opacity: opacityBase, layer: slot.layer, strokeWidth })
  }

  return results
}
