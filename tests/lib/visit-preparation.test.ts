import { describe, expect, it } from 'vitest'
import {
  buildVisitPreparationSummary,
  resolveVisitPreparationPhase,
  type VisitPreparationFacts,
} from '@/lib/knowledge/visit-preparation'

describe('visit preparation read model', () => {
  it('chooses the preparation phase from site facts', () => {
    const base: VisitPreparationFacts = {
      hasCompletedVisit: false,
      hasActiveTender: false,
      isFinished: false,
    }

    expect(resolveVisitPreparationPhase(base)).toBe('first_visit')
    expect(resolveVisitPreparationPhase({ ...base, hasActiveTender: true })).toBe('previsit_ao')
    expect(resolveVisitPreparationPhase({ ...base, hasCompletedVisit: true })).toBe('follow_up')
    expect(resolveVisitPreparationPhase({ ...base, isFinished: true })).toBe('history')
  })

  it('builds a short deterministic situation summary', () => {
    expect(buildVisitPreparationSummary({
      openActions: 2,
      openReserves: 1,
      nextPassageLabel: 'jeudi à 8 h 30',
      criticalPoint: 'Vérifier les consignations électriques',
    })).toEqual([
      '2 actions restent ouvertes.',
      '1 réserve reste à lever.',
      'Prochain passage : jeudi à 8 h 30.',
      'Point critique : Vérifier les consignations électriques.',
    ])
  })
})
