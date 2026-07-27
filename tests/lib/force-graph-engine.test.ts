// V2.0 — helpers PURS du moteur force-directed partagé (Mémoire + Acteurs).
// Le canvas lui-même n'est pas testable ici (recette visuelle obligatoire) ;
// on fige au moins les mathématiques d'interaction.

import { describe, expect, it } from 'vitest'
import { distToSegment, zoomAt } from '@/components/graph/force-graph-engine'

describe('distToSegment', () => {
  it('point sur le segment → 0', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0)
  })

  it('point perpendiculaire au milieu', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3)
  })

  it('au-delà des extrémités → distance au bout (clamp 0..1)', () => {
    expect(distToSegment(14, 0, 0, 0, 10, 0)).toBe(4)
    expect(distToSegment(-2, 0, 0, 0, 10, 0)).toBe(2)
  })

  it('clamp Mémoire (0.08..0.92) : les bouts d’arête ne captent pas le clic', () => {
    // Près de l'extrémité A, le point projeté est ramené à t=0.08 → distance > 0.
    const d = distToSegment(0, 0.5, 0, 0, 10, 0, 0.08, 0.92)
    expect(d).toBeGreaterThan(0.5)
  })
})

describe('zoomAt', () => {
  it('le point sous le curseur reste fixe à l’écran', () => {
    const view = { k: 1, tx: 40, ty: 20 }
    const sx = 200, sy = 150
    const before = { x: (sx - view.tx) / view.k, y: (sy - view.ty) / view.k }
    const next = zoomAt(view, sx, sy, 1.5)
    const after = { x: (sx - next.tx) / next.k, y: (sy - next.ty) / next.k }
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(next.k).toBe(1.5)
  })

  it('dézoomer puis rezoomer au même point est stable', () => {
    let v = { k: 1, tx: 0, ty: 0 }
    v = zoomAt(v, 100, 100, 0.5)
    v = zoomAt(v, 100, 100, 1)
    expect(v.tx).toBeCloseTo(0, 10)
    expect(v.ty).toBeCloseTo(0, 10)
  })
})
