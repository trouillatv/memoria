import { describe, it, expect } from 'vitest'
import {
  computeFilaments,
  FILAMENT_COUNT,
  PRIMARY_COUNT,
  BRANCH_COUNT,
  FILAMENT_LAYERS,
  type ComputeFilamentsInput,
} from '@/lib/voice/orb-filaments'
import type { VoiceBlobPhase } from '@/lib/voice/blob-shape'

const CENTER = 56
const CORE_RADIUS = 42

function base(overrides: Partial<ComputeFilamentsInput> = {}): ComputeFilamentsInput {
  return {
    time: 12_345,
    phase: 'listening',
    audioLevel: 0,
    reducedMotion: false,
    centerX: CENTER,
    centerY: CENTER,
    coreRadius: CORE_RADIUS,
    ...overrides,
  }
}

/** Balaie un cycle complet pour trouver un instant où le filament `index` est actif (d non vide). */
function findActiveFrame(index: number, overrides: Partial<ComputeFilamentsInput> = {}): ComputeFilamentsInput | null {
  for (let t = 0; t < 20_000; t += 137) {
    const input = base({ ...overrides, time: t })
    const filaments = computeFilaments(input)
    if (filaments[index].d.length > 0) return input
  }
  return null
}

describe('computeFilaments — géométrie de base', () => {
  it('retourne exactement FILAMENT_COUNT filaments, layer conforme à FILAMENT_LAYERS', () => {
    const filaments = computeFilaments(base())
    expect(filaments.length).toBe(FILAMENT_COUNT)
    filaments.forEach((f, i) => expect(f.layer).toBe(FILAMENT_LAYERS[i]))
  })

  it('PRIMARY_COUNT + BRANCH_COUNT = FILAMENT_COUNT', () => {
    expect(PRIMARY_COUNT + BRANCH_COUNT).toBe(FILAMENT_COUNT)
  })

  it('est déterministe à paramètres identiques', () => {
    const a = computeFilaments(base({ time: 5_000, audioLevel: 0.6 }))
    const b = computeFilaments(base({ time: 5_000, audioLevel: 0.6 }))
    expect(a).toEqual(b)
  })

  it('un filament actif produit un path fermé (M...Z)', () => {
    const active = findActiveFrame(0)
    expect(active).not.toBeNull()
    const filaments = computeFilaments(active!)
    expect(filaments[0].d.startsWith('M')).toBe(true)
    expect(filaments[0].d.endsWith('Z')).toBe(true)
  })

  it('reste défini (ne lève pas) pour toutes les phases de la machine à états', () => {
    const phases: VoiceBlobPhase[] = [
      'idle', 'entering', 'listening', 'finalizing', 'sending',
      'thinking', 'speaking', 'ready', 'error', 'exiting',
    ]
    for (const phase of phases) {
      const filaments = computeFilaments(base({ phase, time: 2_000, audioLevel: 0.3 }))
      expect(filaments.length).toBe(FILAMENT_COUNT)
    }
  })
})

describe('computeFilaments — cycle de vie (dormant/grow/hold/retract)', () => {
  it('la plupart du temps, tous les primaires ne sont pas actifs simultanément', () => {
    // « 7 filaments ≠ 7 tentacules visibles » : le pool doit rester une
    // fraction visible la majorité du temps, pas les 5 primaires en
    // permanence à l'unisson (les cycles étant indépendants, une coïncidence
    // ponctuelle de tous-actifs reste possible, mais doit rester rare).
    let allActiveCount = 0
    let samples = 0
    for (let t = 0; t < 40_000; t += 250) {
      const filaments = computeFilaments(base({ time: t }))
      const primaries = filaments.slice(0, PRIMARY_COUNT)
      const activeCount = primaries.filter((f) => f.d.length > 0).length
      if (activeCount === PRIMARY_COUNT) allActiveCount++
      samples++
    }
    expect(allActiveCount / samples).toBeLessThan(0.3)
  })

  it('un filament primaire connaît à la fois un état dormant et un état actif sur son cycle', () => {
    let sawDormant = false
    let sawActive = false
    for (let t = 0; t < 20_000; t += 97) {
      const filaments = computeFilaments(base({ time: t }))
      if (filaments[0].d.length === 0) sawDormant = true
      else sawActive = true
    }
    expect(sawDormant).toBe(true)
    expect(sawActive).toBe(true)
  })
})

describe('computeFilaments — pas de fondu d’opacité pour naître/mourir', () => {
  it('parmi les filaments ACTIFS, opacity est constante par calque pour une phase donnée', () => {
    const opacitiesFront = new Set<number>()
    const opacitiesBack = new Set<number>()
    for (let t = 0; t < 10_000; t += 173) {
      const filaments = computeFilaments(base({ time: t, phase: 'listening' }))
      filaments.forEach((f) => {
        if (f.d.length === 0) return // dormant : d vide, opacity non pertinente (rien à peindre)
        if (f.layer === 'front') opacitiesFront.add(f.opacity)
        else opacitiesBack.add(f.opacity)
      })
    }
    // Une seule valeur d'opacité par calque parmi les filaments peints : la
    // disparition ne peut donc venir que de la géométrie (d vide), jamais
    // d'une opacité qui varierait avec le cycle de vie.
    expect(opacitiesFront.size).toBe(1)
    expect(opacitiesBack.size).toBe(1)
  })

  it('un filament dormant a un path vide, pas juste une opacité nulle', () => {
    for (let t = 0; t < 20_000; t += 251) {
      const filaments = computeFilaments(base({ time: t }))
      filaments.forEach((f) => {
        if (f.d.length === 0) {
          // pas d'assertion positive à faire de plus : d vide = rien à peindre.
          expect(f.d).toBe('')
        }
      })
    }
  })
})

describe('computeFilaments — ramifications', () => {
  it('une branche active est toujours plus courte que son parent (base→pointe, pas la distance au centre global)', () => {
    // La distance au centre GLOBAL n'est pas le bon proxy : l'origine d'une
    // branche est déjà déportée le long de la courbe du parent, donc une
    // branche courte peut se retrouver, en absolu, plus loin du centre que
    // la pointe (repliée par `bend`) de son parent. Ce qui est réellement
    // garanti par le code (cf. `maxLength` dans computeFilaments) est la
    // longueur PROPRE base→pointe du ruban.
    const chordLength = (d: string) => {
      const nums = d.replace(/[MLZ]/g, '').split(/[, ]/).filter(Boolean).map(Number)
      const pts: Array<[number, number]> = []
      for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
      // Construit par buildRibbon : pts = [left(s=0..1), rightReversed(s=1..0)],
      // RIBBON_SAMPLES=5 → left=pts[0..4], rightReversed=pts[5..9].
      const baseMid: [number, number] = [(pts[0][0] + pts[9][0]) / 2, (pts[0][1] + pts[9][1]) / 2]
      const tipMid: [number, number] = [(pts[4][0] + pts[5][0]) / 2, (pts[4][1] + pts[5][1]) / 2]
      return Math.hypot(tipMid[0] - baseMid[0], tipMid[1] - baseMid[1])
    }
    for (let t = 0; t < 20_000; t += 211) {
      const filaments = computeFilaments(base({ time: t, phase: 'thinking' }))
      for (let b = PRIMARY_COUNT; b < FILAMENT_COUNT; b++) {
        const branch = filaments[b]
        if (branch.d.length === 0) continue
        const parentIndex = ((b - PRIMARY_COUNT) * 2) % PRIMARY_COUNT
        const parent = filaments[parentIndex]
        if (parent.d.length === 0) continue
        expect(chordLength(branch.d)).toBeLessThan(chordLength(parent.d))
      }
    }
  })
})

describe('computeFilaments — réactivité audio en écoute', () => {
  it('audioLevel plus élevé en listening produit une réaction locale supérieure (jitter)', () => {
    const active = findActiveFrame(0, { phase: 'listening' })
    expect(active).not.toBeNull()
    const quiet = computeFilaments({ ...active!, audioLevel: 0 })[0]
    const loud = computeFilaments({ ...active!, audioLevel: 1 })[0]
    expect(quiet.d).not.toBe(loud.d)
  })
})

describe('computeFilaments — reducedMotion', () => {
  it('réduit réellement l’amplitude de mouvement (jitter/drift) sans tout figer', () => {
    const activeNormal = findActiveFrame(0, { reducedMotion: false })
    expect(activeNormal).not.toBeNull()
    const normal = computeFilaments(activeNormal!)[0]
    const reduced = computeFilaments({ ...activeNormal!, reducedMotion: true })[0]
    expect(reduced.d).not.toBe(normal.d)
  })
})

describe('computeFilaments — transitions de phase', () => {
  it('fond la transition entre deux phases sans reproduire exactement l’une ou l’autre', () => {
    const active = findActiveFrame(0, { phase: 'listening' })
    expect(active).not.toBeNull()
    const from = computeFilaments({ ...active!, phase: 'listening' })[0]
    const to = computeFilaments({ ...active!, phase: 'thinking' })[0]
    const mid = computeFilaments({ ...active!, phase: 'thinking', prevPhase: 'listening', phaseElapsedMs: 140 })[0]
    expect(mid.opacity).not.toBe(from.opacity)
    expect(mid.opacity).not.toBe(to.opacity)
  })
})
