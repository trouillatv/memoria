// Moteur de composition S/M/L/XL du CR (mig 424, Vincent 2026-09-21).
//
// `composePhotoRows` remplace l'ancien `chunkRows` fixe : ces tests protègent
// les invariants du mandat — Auto reproduit EXACTEMENT le chunking historique
// (aucune régression visuelle sur les CR déjà produits, tous en Auto), et une
// taille explicite ferme la ligne au lieu de réordonner les preuves.

import { describe, expect, it } from 'vitest'
import { composePhotoRows } from '@/lib/pdf/visit-cr'
import type { CrPhotoSize } from '@/lib/db/visit-captures'

const AUTO_KEY = { width: 235, height: 320, perRow: 2, gap: 12 }
const AUTO_REPORTAGE = { width: 120, height: 80, perRow: 4, gap: 8 }

function item(id: string, size: CrPhotoSize) {
  return { id, size }
}

describe('composePhotoRows — Auto reproduit le chunking historique', () => {
  it('liste 100% Auto (Photos clés, 2/ligne) — identique à l’ancien chunkRows', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`p${i + 1}`, null))
    const rows = composePhotoRows(items, AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
      ['p1', 'p2'],
      ['p3', 'p4'],
      ['p5'],
    ])
    expect(rows.every((r) => r.spec.width === 235 && r.spec.height === 320)).toBe(true)
  })

  it('liste 100% Auto (Reportage, 4/ligne) — identique à l’ancien chunkRows', () => {
    const items = Array.from({ length: 9 }, (_, i) => item(`p${i + 1}`, null))
    const rows = composePhotoRows(items, AUTO_REPORTAGE)
    expect(rows.map((r) => r.items.length)).toEqual([4, 4, 1])
  })
})

describe('composePhotoRows — capacités par taille explicite', () => {
  it('S regroupe jusqu’à 3 par ligne', () => {
    const items = Array.from({ length: 4 }, (_, i) => item(`p${i + 1}`, 'S'))
    const rows = composePhotoRows(items, AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
      ['p1', 'p2', 'p3'],
      ['p4'],
    ])
  })

  it('M regroupe jusqu’à 2 par ligne', () => {
    const items = Array.from({ length: 3 }, (_, i) => item(`p${i + 1}`, 'M'))
    const rows = composePhotoRows(items, AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
      ['p1', 'p2'],
      ['p3'],
    ])
  })

  it('L et XL sont toujours seules sur leur ligne', () => {
    const rows = composePhotoRows([item('p1', 'L'), item('p2', 'L'), item('p3', 'XL')], AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([['p1'], ['p2'], ['p3']])
  })
})

describe('composePhotoRows — ordre conservé, jamais de réordonnancement', () => {
  it('une taille différente ferme la ligne en cours sans regrouper au-delà', () => {
    // Auto, Auto, S, S, S, Auto — la 3e position (S) casse la paire Auto en
    // cours ; le run de 3 S se referme pile à sa capacité ; l'Auto final
    // redémarre sa propre ligne. Aucun item ne change de position.
    const items = [
      item('a1', null),
      item('a2', null),
      item('s1', 'S'),
      item('s2', 'S'),
      item('s3', 'S'),
      item('a3', null),
    ]
    const rows = composePhotoRows(items, AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([
      ['a1', 'a2'],
      ['s1', 's2', 's3'],
      ['a3'],
    ])
    // Ordre global préservé (concat des lignes == ordre d'entrée).
    expect(rows.flatMap((r) => r.items.map((i) => i.id))).toEqual(items.map((i) => i.id))
  })

  it('un Auto isolé entre deux tailles explicites ferme les deux lignes voisines (du blanc, pas un réordonnancement)', () => {
    const items = [item('s1', 'S'), item('a1', null), item('m1', 'M')]
    const rows = composePhotoRows(items, AUTO_KEY)
    expect(rows.map((r) => r.items.map((i) => i.id))).toEqual([['s1'], ['a1'], ['m1']])
  })
})
