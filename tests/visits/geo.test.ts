// « Pris au même endroit » — la distance haversine qui rapproche les captures.

import { describe, it, expect } from 'vitest'
import {
  distanceMeters,
  SAME_SPOT_RADIUS_M,
  resolveEffectivePosition,
  isMappableVisualCapture,
  selectCrVisualEvidence,
  buildEvidenceNumberMap,
  buildEvidenceCoverage,
  formatEvidenceNumberLabel,
  groupByProximity,
} from '@/lib/visits/geo'

describe('distanceMeters', () => {
  it('même point → 0 m', () => {
    expect(distanceMeters(-22.2758, 166.458, -22.2758, 166.458)).toBe(0)
  })

  it('~11 m pour 0,0001° de latitude (Nouméa)', () => {
    const d = distanceMeters(-22.2758, 166.458, -22.2759, 166.458)
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(13)
  })

  it('deux rues plus loin (~300 m) → hors du rayon « même endroit »', () => {
    const d = distanceMeters(-22.2758, 166.458, -22.2785, 166.458)
    expect(d).toBeGreaterThan(SAME_SPOT_RADIUS_M)
  })
})

describe('resolveEffectivePosition', () => {
  it('correction posée → position corrigée, source manual', () => {
    const p = resolveEffectivePosition({ lat: -22.27, lng: 166.45, correctedLat: -22.28, correctedLng: 166.46 })
    expect(p).toEqual({ lat: -22.28, lng: 166.46, source: 'manual' })
  })

  it('pas de correction → position GPS brute, source gps', () => {
    const p = resolveEffectivePosition({ lat: -22.27, lng: 166.45, correctedLat: null, correctedLng: null })
    expect(p).toEqual({ lat: -22.27, lng: 166.45, source: 'gps' })
  })

  it('ni GPS ni correction → null', () => {
    const p = resolveEffectivePosition({ lat: null, lng: null, correctedLat: null, correctedLng: null })
    expect(p).toBeNull()
  })

  it('correction retirée (revert) → retombe sur le GPS original inchangé', () => {
    const withCorrection = resolveEffectivePosition({ lat: -22.27, lng: 166.45, correctedLat: -22.29, correctedLng: 166.47 })
    expect(withCorrection?.source).toBe('manual')
    const afterRevert = resolveEffectivePosition({ lat: -22.27, lng: 166.45, correctedLat: null, correctedLng: null })
    expect(afterRevert).toEqual({ lat: -22.27, lng: 166.45, source: 'gps' })
  })
})

describe('isMappableVisualCapture — carte CR = preuves visuelles uniquement (Lot 2, 2026-08-24)', () => {
  it('photo → true', () => {
    expect(isMappableVisualCapture('photo')).toBe(true)
  })

  it('video → true', () => {
    expect(isMappableVisualCapture('video')).toBe(true)
  })

  it('vocal → false (rien à montrer sur un point de carte cliqué)', () => {
    expect(isMappableVisualCapture('vocal')).toBe(false)
  })

  it('note → false', () => {
    expect(isMappableVisualCapture('note')).toBe(false)
  })

  it('verification → false', () => {
    expect(isMappableVisualCapture('verification')).toBe(false)
  })

  it('position → false', () => {
    expect(isMappableVisualCapture('position')).toBe(false)
  })
})

describe('selectCrVisualEvidence — ensemble canonique des preuves visuelles retenues (Lot 4, 2026-08-25)', () => {
  const item = (over: Partial<{ id: string; kind: string; status: string; included_in_cr: boolean }> = {}) => ({
    id: 'x', kind: 'photo', status: 'kept', included_in_cr: true, ...over,
  })

  it('photo et vidéo retenues → toutes deux dans l’ensemble, dans l’ordre d’entrée', () => {
    const photo = item({ id: 'a', kind: 'photo' })
    const video = item({ id: 'b', kind: 'video' })
    expect(selectCrVisualEvidence([photo, video]).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('vocal/note exclus même avec included_in_cr=true — seuls photo/vidéo qualifient', () => {
    const vocal = item({ kind: 'vocal' })
    const note = item({ kind: 'note' })
    expect(selectCrVisualEvidence([vocal, note])).toHaveLength(0)
  })

  it('capture non retenue par l’humain (included_in_cr=false) exclue', () => {
    expect(selectCrVisualEvidence([item({ included_in_cr: false })])).toHaveLength(0)
  })

  it('capture "discarded" exclue même si included_in_cr=true et kind photo', () => {
    expect(selectCrVisualEvidence([item({ status: 'discarded' })])).toHaveLength(0)
  })

  it('ordre d’entrée préservé — jamais retrié ici (le tri appartient à l’appelant)', () => {
    const a = item({ id: 'a', kind: 'video' })
    const b = item({ id: 'b', kind: 'photo' })
    const c = item({ id: 'c', kind: 'video' })
    expect(selectCrVisualEvidence([a, b, c]).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildEvidenceNumberMap — identité de preuve unique, jamais recalculée localement (Vincent, Lot 4)', () => {
  it('numérote 1..N selon l’ordre d’entrée', () => {
    const map = buildEvidenceNumberMap([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(map.get('a')).toBe(1)
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
  })

  it('id absent de l’ensemble numéroté → undefined, jamais un 0 implicite silencieux', () => {
    expect(buildEvidenceNumberMap([{ id: 'a' }]).get('inconnu')).toBeUndefined()
  })

  it('ensemble vide → map vide', () => {
    expect(buildEvidenceNumberMap([]).size).toBe(0)
  })
})

describe('formatEvidenceNumberLabel — étiquette de repère groupé (Vincent, Lot 4.1, 2026-08-25)', () => {
  it('numéro isolé → le chiffre seul', () => {
    expect(formatEvidenceNumberLabel([7])).toBe('7')
  })

  it('suite contiguë → plage « a–b »', () => {
    expect(formatEvidenceNumberLabel([1, 2, 3])).toBe('1–3')
  })

  it('deux contigus → plage « a–b », pas une liste', () => {
    expect(formatEvidenceNumberLabel([4, 5])).toBe('4–5')
  })

  it('numéros dispersés → liste à la virgule', () => {
    expect(formatEvidenceNumberLabel([1, 5])).toBe('1, 5')
  })

  it('mélange plages et isolés, dans le désordre en entrée → trié puis groupé', () => {
    expect(formatEvidenceNumberLabel([6, 1, 3, 5])).toBe('1, 3, 5–6')
  })

  it('jamais un simple compte (« 5 ») qui masquerait quelles preuves sont groupées', () => {
    const label = formatEvidenceNumberLabel([2, 3, 4, 9, 12])
    expect(label).not.toBe('5')
    expect(label).toBe('2–4, 9, 12')
  })
})

describe('buildEvidenceCoverage — carte honnête sur sa couverture (Vincent, correction Lot Cartographie CR, 2026-08-26)', () => {
  const evidence = (over: Partial<{ id: string; lat: number | null; lng: number | null; corrected_lat: number | null; corrected_lng: number | null }> = {}) => ({
    id: 'x', lat: null, lng: null, corrected_lat: null, corrected_lng: null, ...over,
  })

  it('8 preuves dont 4 sans GPS → 4/8 localisées, missingNumbers = les 4 sans position', () => {
    const positioned = Array.from({ length: 4 }, (_, i) => evidence({ id: `p${i}`, lat: -22.27 - i * 0.001, lng: 166.45 }))
    const missing = Array.from({ length: 4 }, (_, i) => evidence({ id: `m${i}` }))
    // Ordre entrelacé — la couverture ne doit dépendre que du contenu, jamais de la position dans le tableau.
    const ordered = [positioned[0], missing[0], positioned[1], missing[1], positioned[2], missing[2], positioned[3], missing[3]]
    const evidenceNumberById = buildEvidenceNumberMap(ordered)
    const coverage = buildEvidenceCoverage(ordered, evidenceNumberById)
    expect(coverage.total).toBe(8)
    expect(coverage.positioned).toBe(4)
    expect(coverage.missingNumbers).toEqual([2, 4, 6, 8])
  })

  it('correction humaine posée sans GPS brut → comptée comme localisée (source manual)', () => {
    const corrected = evidence({ id: 'c', lat: null, lng: null, corrected_lat: -22.27, corrected_lng: 166.45 })
    const map = buildEvidenceNumberMap([corrected])
    const coverage = buildEvidenceCoverage([corrected], map)
    expect(coverage).toEqual({ total: 1, positioned: 1, missingNumbers: [] })
  })

  it('aucune preuve localisée → positioned=0, toutes en missingNumbers', () => {
    const rows = Array.from({ length: 3 }, (_, i) => evidence({ id: `n${i}` }))
    const map = buildEvidenceNumberMap(rows)
    const coverage = buildEvidenceCoverage(rows, map)
    expect(coverage).toEqual({ total: 3, positioned: 0, missingNumbers: [1, 2, 3] })
  })

  it('ensemble vide → couverture vide, jamais une division par zéro qui plante', () => {
    expect(buildEvidenceCoverage([], new Map())).toEqual({ total: 0, positioned: 0, missingNumbers: [] })
  })

  it('numérotation partagée avec la carte : les numéros manquants sont EXACTEMENT ceux que porteraient les mêmes preuves sur la carte/le PDF (Vincent — jamais deux comptes qui divergent)', () => {
    const video = evidence({ id: 'v', lat: -22.27, lng: 166.45 })
    const photoNoGps = evidence({ id: 'p1' })
    const photoGps = evidence({ id: 'p2', lat: -22.28, lng: 166.46 })
    const crVisual = selectCrVisualEvidence([
      { ...video, kind: 'video', status: 'kept', included_in_cr: true },
      { ...photoNoGps, kind: 'photo', status: 'kept', included_in_cr: true },
      { ...photoGps, kind: 'photo', status: 'kept', included_in_cr: true },
      // Un vocal géolocalisé n'est jamais une « preuve » de la carte — exclu en amont,
      // il ne doit apparaître ni au numérateur ni au dénominateur de la couverture.
      { id: 'voc', kind: 'vocal', status: 'kept', included_in_cr: true, lat: -22.29, lng: 166.47, corrected_lat: null, corrected_lng: null },
    ])
    const evidenceNumberById = buildEvidenceNumberMap(crVisual)
    const coverage = buildEvidenceCoverage(crVisual, evidenceNumberById)
    expect(coverage.total).toBe(3) // vocal exclu
    expect(coverage.positioned).toBe(2)
    expect(coverage.missingNumbers).toEqual([evidenceNumberById.get('p1')])
    expect(evidenceNumberById.get('p1')).toBe(2)
  })
})

describe('groupByProximity — regroupement spatial stable, indépendant du zoom (Vincent, Lot Cartographie CR, 2026-08-26)', () => {
  it('deux points à 5 m → un seul groupe', () => {
    const groups = groupByProximity([
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.27581, lng: 166.458 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].points.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('deux points à ~300 m → deux groupes distincts', () => {
    const groups = groupByProximity([
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.2785, lng: 166.458 },
    ])
    expect(groups).toHaveLength(2)
  })

  it('point isolé → son propre groupe à un seul élément', () => {
    const groups = groupByProximity([{ id: 'a', lat: -22.2758, lng: 166.458 }])
    expect(groups).toHaveLength(1)
    expect(groups[0].points).toHaveLength(1)
  })

  it('ensemble vide → aucun groupe', () => {
    expect(groupByProximity([])).toHaveLength(0)
  })

  it('centroïde = moyenne des points du groupe', () => {
    const groups = groupByProximity([
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.27581, lng: 166.458 },
    ])
    expect(groups[0].lat).toBeCloseTo((-22.2758 + -22.27581) / 2, 6)
  })

  it('rayon personnalisé plus petit → deux groupes là où le rayon par défaut n’en ferait qu’un', () => {
    const points = [
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.27581, lng: 166.458 },
    ]
    expect(groupByProximity(points, 1)).toHaveLength(2)
    expect(groupByProximity(points, SAME_SPOT_RADIUS_M)).toHaveLength(1)
  })

  it('décision indépendante de tout ordre de zoom/projection — même sortie quel que soit l’ordre d’entrée stable', () => {
    const points = [
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.27581, lng: 166.458 },
      { id: 'c', lat: -22.2785, lng: 166.458 },
    ]
    const groups = groupByProximity(points)
    expect(groups).toHaveLength(2)
    expect(groups[0].points.map((p) => p.id)).toEqual(['a', 'b'])
    expect(groups[1].points.map((p) => p.id)).toEqual(['c'])
  })

  it('deux preuves exactement superposées (mêmes lat/lng) → un seul groupe, toujours (le PDF, statique, ne « dézoome » jamais)', () => {
    const groups = groupByProximity([
      { id: 'a', lat: -22.2758, lng: 166.458 },
      { id: 'b', lat: -22.2758, lng: 166.458 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].points.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })
})
