// Correctif Vincent, recette DIMENC-Sireis (2026-08-27) : sur la carte du
// CR, la pastille groupée « 10 · 11 · 12 · 13 +3 » cachait une pastille
// voisine — le renderer plaçait chaque groupe à sa position projetée sans
// gérer les collisions entre étiquettes. Ce test couvre la primitive pure
// qui résout ce problème APRÈS projection écran, sans jamais toucher au
// regroupement géographique, aux numéros ni au centre de chaque groupe
// (ceux-là restent calculés par groupByProximity/lib/visits/geo.ts,
// entièrement hors du périmètre de ce fichier).

import { describe, it, expect } from 'vitest'
import { resolveLabelCollisions, labelBoxSize, type CrMapLabelMarker } from '@/lib/pdf/cr-map-label-collision'
import { buildSvg } from '@/lib/pdf/cr-map-snapshot'

const BOUNDS = { width: 1030, height: 400 }

function rectOf(m: { cx: number; cy: number; label: string }) {
  const size = labelBoxSize(m.label)
  return { x: m.cx - size.width / 2, y: m.cy - size.height / 2, width: size.width, height: size.height }
}

function rectsOverlap(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
}

describe('resolveLabelCollisions — labels éloignés', () => {
  it('ne déplace aucun label quand ils sont loin les uns des autres', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 100, cy: 100, color: '#0284c7', label: '1' },
      { cx: 900, cy: 300, color: '#0284c7', label: '2' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    expect(placed[0]).toMatchObject({ cx: 100, cy: 100, moved: false })
    expect(placed[1]).toMatchObject({ cx: 900, cy: 300, moved: false })
  })
})

describe('resolveLabelCollisions — 2 labels en collision', () => {
  it('sépare deux pastilles projetées au même point', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 500, cy: 200, color: '#0284c7', label: '1' },
      { cx: 505, cy: 202, color: '#0284c7', label: '2' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    expect(rectsOverlap(rectOf(placed[0]), rectOf(placed[1]))).toBe(false)
    // Le premier marqueur garde sa position naturelle, le second (traité en
    // second) est celui qui se déplace.
    expect(placed[0].moved).toBe(false)
    expect(placed[1].moved).toBe(true)
  })

  it('reproduit le cas DIMENC-Sireis : une pastille groupée large chevauchant un voisin', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 700, cy: 150, color: '#334155', label: '10 · 11 · 12 · 13 +3' },
      { cx: 705, cy: 155, color: '#0284c7', label: '9' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    expect(rectsOverlap(rectOf(placed[0]), rectOf(placed[1]))).toBe(false)
  })
})

describe('resolveLabelCollisions — 3+ labels proches', () => {
  it('ne laisse aucun rectangle se chevaucher, quel que soit le nombre de labels proches', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 400, cy: 200, color: '#0284c7', label: '1' },
      { cx: 402, cy: 201, color: '#0284c7', label: '2' },
      { cx: 398, cy: 203, color: '#0284c7', label: '3' },
      { cx: 405, cy: 197, color: '#334155', label: '4 · 5 · 6' },
      { cx: 397, cy: 198, color: '#7c3aed', label: '7' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(rectsOverlap(rectOf(placed[i]), rectOf(placed[j]))).toBe(false)
      }
    }
  })
})

describe('resolveLabelCollisions — bords du cadre', () => {
  it('garde une pastille proche d un bord strictement dans le cadre', () => {
    const markers: CrMapLabelMarker[] = [{ cx: 2, cy: 2, color: '#0284c7', label: '1' }]
    const [placed] = resolveLabelCollisions(markers, BOUNDS)
    const r = rectOf(placed)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(BOUNDS.width)
    expect(r.y + r.height).toBeLessThanOrEqual(BOUNDS.height)
  })

  it('garde une pastille repoussée par collision près d un bord toujours dans le cadre', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 500, cy: 5, color: '#0284c7', label: '1' },
      { cx: 502, cy: 6, color: '#0284c7', label: '2' },
      { cx: 498, cy: 7, color: '#0284c7', label: '3' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    for (const m of placed) {
      const r = rectOf(m)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(BOUNDS.width)
      expect(r.y + r.height).toBeLessThanOrEqual(BOUNDS.height)
    }
  })
})

describe('resolveLabelCollisions — numéros/groupes strictement inchangés', () => {
  it('ne modifie jamais label ni color, seulement cx/cy', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 300, cy: 100, color: '#0284c7', label: '3 · 4' },
      { cx: 302, cy: 101, color: '#7c3aed', label: '5' },
    ]
    const placed = resolveLabelCollisions(markers, BOUNDS)
    expect(placed.map((m) => m.label)).toEqual(['3 · 4', '5'])
    expect(placed.map((m) => m.color)).toEqual(['#0284c7', '#7c3aed'])
  })
})

describe('resolveLabelCollisions — déterminisme', () => {
  it('produit exactement le même résultat sur deux appels avec les mêmes données (Plan et Satellite partagent les mêmes positions)', () => {
    const markers: CrMapLabelMarker[] = [
      { cx: 640, cy: 220, color: '#334155', label: '10 · 11 · 12 · 13 +3' },
      { cx: 645, cy: 224, color: '#0284c7', label: '9' },
      { cx: 300, cy: 80, color: '#7c3aed', label: '1' },
    ]
    const runA = resolveLabelCollisions(markers, BOUNDS)
    const runB = resolveLabelCollisions(markers, BOUNDS)
    expect(runB).toEqual(runA)
  })
})

describe('buildSvg — trait de rappel', () => {
  it('ne dessine aucun trait quand ox/oy sont absents (compatibilité ascendante)', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '1' }])
    expect(svg).not.toContain('<line')
  })

  it('ne dessine aucun trait quand ox/oy sont égaux à cx/cy (non déplacé)', () => {
    const svg = buildSvg([], [{ cx: 100, cy: 100, color: '#0284c7', label: '1', ox: 100, oy: 100 }])
    expect(svg).not.toContain('<line')
  })

  it('dessine un trait de rappel quand la pastille a été déplacée', () => {
    const svg = buildSvg([], [{ cx: 130, cy: 100, color: '#0284c7', label: '1', ox: 100, oy: 100 }])
    expect(svg).toContain('<line x1="100.0" y1="100.0" x2="130.0" y2="100.0"')
  })
})
