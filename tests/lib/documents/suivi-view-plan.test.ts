// P1-PERF-B — le plan de chargement du Suivi est la SEULE source des chargements
// conditionnels de historique/page.tsx. Ces tests fixent le contrat vue → matière
// (audit 2026-09-06) sans se coupler au rendu de la page.

import { describe, it, expect } from 'vitest'
import { suiviLoadPlan, type SuiviViewKey } from '@/lib/documents/suivi-view-plan'

const ALL: SuiviViewKey[] = ['synthese', 'avant-apres', 'lifelines', 'evolution', 'deps', 'attention']

describe('suiviLoadPlan — chaque vue ne paie que sa matière', () => {
  it('synthese charge tout ce qu’elle affiche : matrice, timeline, importants, delta', () => {
    expect(suiviLoadPlan('synthese')).toEqual({
      matrix: true, timeline: true, importantSubjects: true, deltaSummary: true, canonicalLabels: false,
    })
  })

  it('lifelines : matrice + importants + labels — PAS de timeline ni de delta', () => {
    expect(suiviLoadPlan('lifelines')).toEqual({
      matrix: true, timeline: false, importantSubjects: true, deltaSummary: false, canonicalLabels: true,
    })
  })

  it('attention / avant-apres / deps : AUCUNE matière lourde du tronc', () => {
    for (const v of ['attention', 'avant-apres', 'deps'] as const) {
      expect(suiviLoadPlan(v)).toEqual({
        matrix: false, timeline: false, importantSubjects: false, deltaSummary: false, canonicalLabels: false,
      })
    }
  })

  it('evolution : labels ciblés seulement — pas de matrice/timeline/importants/delta', () => {
    expect(suiviLoadPlan('evolution')).toEqual({
      matrix: false, timeline: false, importantSubjects: false, deltaSummary: false, canonicalLabels: true,
    })
  })

  it('le delta (Synthèse seule) n’est jamais payé par une autre vue', () => {
    expect(ALL.filter((v) => suiviLoadPlan(v).deltaSummary)).toEqual(['synthese'])
  })

  it('la timeline n’est payée que par la Synthèse', () => {
    expect(ALL.filter((v) => suiviLoadPlan(v).timeline)).toEqual(['synthese'])
  })

  it('la matrice complète n’est payée que par Synthèse et Lignes de vie', () => {
    expect(ALL.filter((v) => suiviLoadPlan(v).matrix)).toEqual(['synthese', 'lifelines'])
  })
})
