// Phase 6E.4C — impact avant confirmation.
//
// Mandat Vincent (couverture minimale) : merge non destructif ; rattachement ; absence de
// changement d'état métier implicite ; aucun texte affirmant une suppression/reparent
// historique faux ; impact calculé à partir des objets réels concernés (jamais un texte
// générique indépendant de l'entrée passée).

import { describe, it, expect } from 'vitest'
import {
  duplicatePointsImpact,
  attachInformationImpact,
  confirmTrackabilityImpact,
  assignResolutionImpact,
  clarifyEvidenceImpact,
} from '@/lib/knowledge/tracked-point-needs-you-impact'
import type { ConsolidationQueueEntry, ConsolidationQueuePointSide } from '@/lib/knowledge/tracked-point-consolidation-queue'

function side(id: string, label: string, overrides: Partial<ConsolidationQueuePointSide> = {}): ConsolidationQueuePointSide {
  return {
    id,
    label,
    status: 'active',
    identityStatus: 'PROVISIONAL',
    derivedState: null,
    subjectId: null,
    subjectLabel: null,
    firstAppearanceAt: null,
    lastAppearanceAt: null,
    cboCount: 0,
    hardMemberCount: 0,
    proofs: [],
    proofCount: 0,
    ...overrides,
  }
}

function entry(overrides: Partial<ConsolidationQueueEntry> = {}): ConsolidationQueueEntry {
  return {
    pairId: 'a~b',
    siteId: 'site-1',
    pointA: side('a', 'Fissure façade nord'),
    pointB: side('b', 'Fissure façade nord (bis)'),
    candidateIds: ['cand-1'],
    reciprocal: false,
    componentId: 'a',
    componentSize: 2,
    predictedTargetPointId: 'a',
    predictedSourcePointId: 'b',
    ...overrides,
  }
}

const FORBIDDEN_WORDS = [/supprim/i, /clôtur/i]

describe('duplicatePointsImpact — merge non destructif', () => {
  it('désigne le Point conservé et le Point absorbé à partir de predictedTargetPointId', () => {
    const e = entry({ predictedTargetPointId: 'b', predictedSourcePointId: 'a' })
    const impact = duplicatePointsImpact(e)
    const text = impact.join(' ')
    expect(text).toContain('Fissure façade nord (bis)')
    expect(text).toContain('Point conservé')
    expect(text).toContain('Point absorbé')
  })

  it('inverse correctement quand la cible prédite est pointA', () => {
    const e = entry({ predictedTargetPointId: 'a', predictedSourcePointId: 'b' })
    const impact = duplicatePointsImpact(e)
    const conservedLine = impact.find((l) => l.startsWith('Point conservé'))
    expect(conservedLine).toContain('Fissure façade nord')
    expect(conservedLine).not.toContain('(bis)')
  })

  it('n\'affirme jamais une suppression — "supprimé" n\'apparaît que dans la négation explicite "rien n\'est supprimé" (mig 391/392 = redirection logique)', () => {
    const impact = duplicatePointsImpact(entry())
    const text = impact.join(' ')
    expect(text).toMatch(/rien n'est supprimé/i)
    expect(text.match(/supprim/gi)).toHaveLength(1)
  })

  it('affirme explicitement l\'absence de réécriture de preuve', () => {
    const impact = duplicatePointsImpact(entry())
    expect(impact.some((l) => /aucune preuve.*réécrite/i.test(l))).toBe(true)
  })

  it('direction CONFLICTED (predictedTargetPointId null) : aucune promesse de fusion, aucun nom de Point deviné', () => {
    const e = entry({ predictedTargetPointId: null, predictedSourcePointId: null })
    const impact = duplicatePointsImpact(e)
    const text = impact.join(' ')
    expect(text).not.toContain('Fissure façade nord')
    expect(text).toMatch(/ne peut pas encore déterminer/i)
  })
})

describe('attachInformationImpact — rattachement', () => {
  it('nomme le Point cible réel passé en paramètre', () => {
    const impact = attachInformationImpact('Infiltration toiture bloc B')
    expect(impact.join(' ')).toContain('Infiltration toiture bloc B')
  })

  it('affirme explicitement l\'absence de changement d\'état métier implicite', () => {
    const impact = attachInformationImpact('Infiltration toiture bloc B')
    expect(impact.some((l) => /état actuel.*ne change pas automatiquement/i.test(l))).toBe(true)
  })

  it('affirme qu\'aucun autre suivi n\'est modifié', () => {
    const impact = attachInformationImpact('Infiltration toiture bloc B')
    expect(impact.some((l) => /aucun autre suivi.*modifié/i.test(l))).toBe(true)
  })

  it('ne contient aucun mot de suppression/clôture', () => {
    const impact = attachInformationImpact('Infiltration toiture bloc B')
    const text = impact.join(' ')
    for (const re of FORBIDDEN_WORDS) expect(text).not.toMatch(re)
  })
})

describe('confirmTrackabilityImpact — création d\'un suivi distinct', () => {
  it('annonce un statut provisoire et aucun rattachement à un suivi existant', () => {
    const impact = confirmTrackabilityImpact()
    const text = impact.join(' ')
    expect(text).toMatch(/provisoire/i)
    expect(text).toMatch(/aucun suivi existant/i)
  })

  it('ne prétend jamais clôturer quoi que ce soit', () => {
    const text = confirmTrackabilityImpact().join(' ')
    for (const re of FORBIDDEN_WORDS) expect(text).not.toMatch(re)
  })
})

describe('assignResolutionImpact — rattachement à un suivi existant', () => {
  it('nomme le suivi cible réel et exclut toute création', () => {
    const impact = assignResolutionImpact('VGP nacelle élévatrice')
    const text = impact.join(' ')
    expect(text).toContain('VGP nacelle élévatrice')
    expect(text).toMatch(/aucun nouveau suivi n'est créé/i)
    expect(text).toMatch(/autres suivis.*ne sont pas modifiés/i)
  })

  it('ne prétend jamais que le suivi cible est résolu par cette seule association', () => {
    const text = assignResolutionImpact('VGP nacelle élévatrice').join(' ')
    expect(text).not.toMatch(/\brésolu/i)
  })
})

describe('clarifyEvidenceImpact — précision de preuve, zéro effet sur un suivi', () => {
  it('reflète le nombre réel d\'informations sélectionnées, jamais une valeur générique', () => {
    const impact3 = clarifyEvidenceImpact(3).join(' ')
    const impact1 = clarifyEvidenceImpact(1).join(' ')
    expect(impact3).toContain('3 informations')
    expect(impact1).toContain('1 information')
    expect(impact1).not.toContain('1 informations')
  })

  it('affirme explicitement qu\'aucun suivi n\'est créé ni modifié', () => {
    const impact = clarifyEvidenceImpact(2)
    expect(impact.some((l) => /aucun suivi n'est créé ni modifié/i.test(l))).toBe(true)
  })
})
