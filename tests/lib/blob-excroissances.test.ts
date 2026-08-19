import { describe, it, expect } from 'vitest'
import {
  computeBlobPath,
  EXCROISSANCE_MAX_FACTOR,
  type ComputeBlobPathInput,
} from '@/lib/voice/blob-shape'

const SIZE = 112
const CENTER = SIZE / 2

function base(overrides: Partial<ComputeBlobPathInput> = {}): ComputeBlobPathInput {
  return {
    time: 0,
    phase: 'thinking',
    audioLevel: 0,
    reducedMotion: false,
    size: SIZE,
    ...overrides,
  }
}

function parsePoints(path: string): Array<[number, number]> {
  const nums = path
    .replace(/[MZ]/g, '')
    .split(/[C ,]/)
    .filter((s) => s.length > 0)
    .map(Number)
  const points: Array<[number, number]> = [[nums[0], nums[1]]]
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    points.push([nums[i + 4], nums[i + 5]])
  }
  return points
}

function maxFactor(input: ComputeBlobPathInput): number {
  const points = parsePoints(computeBlobPath(input))
  return Math.max(...points.map(([x, y]) => Math.hypot(x - CENTER, y - CENTER) / CENTER))
}

// t=0 : tous les déphasages (EXCROISSANCE_OFFSETS/PERIODS) tombent dans la
// fraction dormante (u < 0.6) — sert de référence "corps pur, aucune bosse".
const DORMANT_T = 0

describe('excroissances — naissent et se rétractent (mandat Vincent 2026-08-19)', () => {
  it('sur un cycle complet, au moins un instant dépasse nettement la référence dormante (une excroissance sort)', () => {
    const baseline = maxFactor(base({ phase: 'thinking', time: DORMANT_T }))
    let peak = baseline
    for (let t = 0; t < 17_000; t += 200) {
      peak = Math.max(peak, maxFactor(base({ phase: 'thinking', time: t })))
    }
    expect(peak).toBeGreaterThan(baseline + 0.05)
  })

  it('sur le même cycle, au moins un instant redescend près de la référence dormante (dormance réelle, pas figé en extension)', () => {
    const baseline = maxFactor(base({ phase: 'thinking', time: DORMANT_T }))
    let sawDormant = false
    for (let t = 0; t < 17_000; t += 200) {
      if (maxFactor(base({ phase: 'thinking', time: t })) < baseline + 0.01) {
        sawDormant = true
        break
      }
    }
    expect(sawDormant).toBe(true)
  })

  it('plus rare que présent : la majorité des instants échantillonnés ne montrent aucune excroissance en pleine sortie', () => {
    const baseline = maxFactor(base({ phase: 'thinking', time: DORMANT_T }))
    let extendedCount = 0
    let samples = 0
    for (let t = 0; t < 40_000; t += 250) {
      samples++
      if (maxFactor(base({ phase: 'thinking', time: t })) > baseline + 0.05) extendedCount++
    }
    expect(extendedCount / samples).toBeLessThan(0.5)
  })

  it('jamais de pointe : le plafond corps+bosse reste sous EXCROISSANCE_MAX_FACTOR à tout instant', () => {
    for (let t = 0; t < 40_000; t += 733) {
      expect(maxFactor(base({ phase: 'thinking', audioLevel: 1, time: t }))).toBeLessThanOrEqual(
        EXCROISSANCE_MAX_FACTOR + 2e-4,
      )
    }
  })

  it('thinking (excroissanceAmplitude la plus haute) sort davantage de sa propre référence dormante qu’idle', () => {
    const thinkingBaseline = maxFactor(base({ phase: 'thinking', time: DORMANT_T }))
    const idleBaseline = maxFactor(base({ phase: 'idle', time: DORMANT_T }))
    let thinkingPeakDelta = 0
    let idlePeakDelta = 0
    for (let t = 0; t < 20_000; t += 200) {
      thinkingPeakDelta = Math.max(thinkingPeakDelta, maxFactor(base({ phase: 'thinking', time: t })) - thinkingBaseline)
      idlePeakDelta = Math.max(idlePeakDelta, maxFactor(base({ phase: 'idle', time: t })) - idleBaseline)
    }
    expect(thinkingPeakDelta).toBeGreaterThan(idlePeakDelta)
  })

  it('reducedMotion réduit réellement l’amplitude de la bosse d’excroissance', () => {
    const baseline = maxFactor(base({ phase: 'thinking', time: DORMANT_T }))
    let normalPeakDelta = 0
    let reducedPeakDelta = 0
    for (let t = 0; t < 20_000; t += 200) {
      normalPeakDelta = Math.max(normalPeakDelta, maxFactor(base({ phase: 'thinking', time: t, reducedMotion: false })) - baseline)
      reducedPeakDelta = Math.max(reducedPeakDelta, maxFactor(base({ phase: 'thinking', time: t, reducedMotion: true })) - baseline)
    }
    expect(reducedPeakDelta).toBeLessThan(normalPeakDelta)
  })

  it('est déterministe à paramètres identiques', () => {
    const a = computeBlobPath(base({ phase: 'thinking', time: 9_137 }))
    const b = computeBlobPath(base({ phase: 'thinking', time: 9_137 }))
    expect(a).toBe(b)
  })
})
