import { describe, expect, it } from 'vitest'
import {
  buildVisitPreparationCopy,
  buildVisitSourceItems,
  describePreparationConfidence,
  estimatePreparationQuality,
} from '@/lib/visits/debrief-preparation'

describe('visit debrief preparation copy', () => {
  it('stays modest when only photos are available', () => {
    const copy = buildVisitPreparationCopy({ photos: 3, videos: 0, vocals: 0, notes: 0 })

    expect(copy.title).toBe('Captures classees')
    expect(copy.body).toContain('il manque un commentaire')
  })

  it('explains the value when vocal and media are available', () => {
    const copy = buildVisitPreparationCopy({ photos: 2, videos: 1, vocals: 1, notes: 0 })

    expect(copy.title).toBe('Compte rendu pret a creer')
    expect(copy.body).toContain('commentaire vocal')
  })

  it('lists used and missing sources without zero counters in the main summary', () => {
    const items = buildVisitSourceItems({ photos: 2, videos: 0, vocals: 1, notes: 0 })

    expect(items.used.map((item) => item.label)).toEqual(['2 photos', 'commentaire vocal', 'date de visite', 'chantier'])
    expect(items.missing.map((item) => item.label)).toEqual(['aucune video', 'aucune note'])
  })

  it('estimates richer preparation when the visit has vocal and media', () => {
    expect(estimatePreparationQuality({ photos: 0, videos: 0, vocals: 0, notes: 0 })).toBe(1)
    expect(estimatePreparationQuality({ photos: 2, videos: 1, vocals: 1, notes: 0 })).toBe(4)
    expect(estimatePreparationQuality({ photos: 12, videos: 0, vocals: 1, notes: 2 })).toBe(5)
  })

  it('describes preparation confidence in plain product language', () => {
    expect(describePreparationConfidence(5).label).toBe('Confiance elevee')
    expect(describePreparationConfidence(4).label).toBe('Bonne base de travail')
    expect(describePreparationConfidence(1).body).toContain('Il manque')
  })
})
