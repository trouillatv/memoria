import { describe, it, expect } from 'vitest'
import {
  computeBlobPath,
  POINT_COUNT,
  MIN_BLOB_FACTOR,
  MAX_BLOB_FACTOR,
  type ComputeBlobPathInput,
  type VoiceBlobPhase,
} from '@/lib/voice/blob-shape'

const SIZE = 112

function base(overrides: Partial<ComputeBlobPathInput> = {}): ComputeBlobPathInput {
  return {
    time: 12_345,
    phase: 'listening',
    audioLevel: 0,
    reducedMotion: false,
    size: SIZE,
    ...overrides,
  }
}

/** Extrait les points [x,y] d'un path `M.. C.. C.. ... Z` généré par le module. */
function parsePoints(path: string): Array<[number, number]> {
  const nums = path
    .replace(/[MZ]/g, '')
    .split(/[C ,]/)
    .filter((s) => s.length > 0)
    .map(Number)
  // M x,y puis N segments C c1x,c1y c2x,c2y px,py → seul le point final de
  // chaque C nous intéresse pour reconstruire les N points de contrôle.
  const points: Array<[number, number]> = [[nums[0], nums[1]]]
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    points.push([nums[i + 4], nums[i + 5]])
  }
  return points
}

describe('computeBlobPath — silhouette', () => {
  it('produit un path fermé (M...Z) avec un segment par point radial', () => {
    const path = computeBlobPath(base())
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect((path.match(/C/g) ?? []).length).toBe(POINT_COUNT)
  })

  it('est déterministe à paramètres identiques', () => {
    const a = computeBlobPath(base({ time: 5_000, audioLevel: 0.6 }))
    const b = computeBlobPath(base({ time: 5_000, audioLevel: 0.6 }))
    expect(a).toBe(b)
  })

  it('audioLevel 1 produit une variation locale supérieure à audioLevel 0', () => {
    const quiet = parsePoints(computeBlobPath(base({ phase: 'listening', audioLevel: 0, time: 8_000 })))
    const loud = parsePoints(computeBlobPath(base({ phase: 'listening', audioLevel: 1, time: 8_000 })))
    const center = SIZE / 2
    const radii = (pts: Array<[number, number]>) =>
      pts.map(([x, y]) => Math.hypot(x - center, y - center))
    const spread = (rs: number[]) => Math.max(...rs) - Math.min(...rs)
    expect(spread(radii(loud))).toBeGreaterThan(spread(radii(quiet)))
  })

  it('borne fermement le facteur de rayon, même à audioLevel extrême', () => {
    const path = computeBlobPath(base({ phase: 'listening', audioLevel: 1, time: 999_999 }))
    const center = SIZE / 2
    for (const [x, y] of parsePoints(path)) {
      const r = Math.hypot(x - center, y - center)
      const factor = r / center
      expect(factor).toBeGreaterThanOrEqual(MIN_BLOB_FACTOR - 1e-9)
      expect(factor).toBeLessThanOrEqual(MAX_BLOB_FACTOR + 1e-9)
    }
  })

  it('thinking et listening produisent des silhouettes différentes au même instant', () => {
    const thinking = computeBlobPath(base({ phase: 'thinking', audioLevel: 0, time: 3_000 }))
    const listening = computeBlobPath(base({ phase: 'listening', audioLevel: 0.4, time: 3_000 }))
    expect(thinking).not.toBe(listening)
  })

  it('thinking bouge dans le temps indépendamment de audioLevel (mouvement interne)', () => {
    const t1 = computeBlobPath(base({ phase: 'thinking', audioLevel: 0, time: 1_000 }))
    const t2 = computeBlobPath(base({ phase: 'thinking', audioLevel: 0, time: 1_800 }))
    expect(t1).not.toBe(t2)
  })

  it('reducedMotion réduit réellement l’amplitude de réaction audio', () => {
    const normal = parsePoints(computeBlobPath(base({ phase: 'listening', audioLevel: 1, time: 4_000, reducedMotion: false })))
    const reduced = parsePoints(computeBlobPath(base({ phase: 'listening', audioLevel: 1, time: 4_000, reducedMotion: true })))
    const center = SIZE / 2
    const spread = (pts: Array<[number, number]>) => {
      const radii = pts.map(([x, y]) => Math.hypot(x - center, y - center))
      return Math.max(...radii) - Math.min(...radii)
    }
    expect(spread(reduced)).toBeLessThan(spread(normal))
  })

  it('reste défini pour toutes les phases de la machine à états', () => {
    const phases: VoiceBlobPhase[] = [
      'idle', 'entering', 'listening', 'finalizing', 'sending',
      'thinking', 'speaking', 'ready', 'error', 'exiting',
    ]
    for (const phase of phases) {
      const path = computeBlobPath(base({ phase, time: 2_000, audioLevel: 0.3 }))
      expect(path.startsWith('M')).toBe(true)
      expect(path.endsWith('Z')).toBe(true)
    }
  })

  it('fond la transition entre deux phases sans reproduire exactement l’une ou l’autre', () => {
    const from = computeBlobPath(base({ phase: 'listening', audioLevel: 0.5, time: 10_000 }))
    const to = computeBlobPath(base({ phase: 'thinking', audioLevel: 0.5, time: 10_000 }))
    const mid = computeBlobPath(
      base({ phase: 'thinking', audioLevel: 0.5, time: 10_000, prevPhase: 'listening', phaseElapsedMs: 140 }),
    )
    expect(mid).not.toBe(from)
    expect(mid).not.toBe(to)
  })
})
