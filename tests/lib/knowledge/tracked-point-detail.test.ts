import { describe, expect, it } from 'vitest'
import {
  toTrajectoryEntry,
  proposalIdFromSource,
  buildHeadline,
  resolveOrigin,
  originMatchesProvenance,
  POINT_STATE_LABEL,
  groupLinkedObjectsByTitle,
  computePointActors,
  suggestResponsibleNames,
  type PointDetailLinkedObject,
  type PointDetailEvidence,
  type PointDetailProvenance,
} from '@/lib/knowledge/tracked-point-detail'

function evidence(overrides: Partial<PointDetailEvidence> & { proposalId: string; kind: PointDetailEvidence['kind']; date: string }): PointDetailEvidence {
  return {
    documentId: null,
    kindLabel: '',
    dateLabel: null,
    isResolving: false,
    documentFilename: null,
    documentType: null,
    href: null,
    sourcePage: null,
    sourceExcerpt: null,
    ...overrides,
  }
}

function linkedObject(overrides: Partial<PointDetailLinkedObject> & { id: string; title: string }): PointDetailLinkedObject {
  return {
    objectType: 'site_action',
    status: 'open',
    statusLabel: 'En cours',
    isDone: false,
    isLate: false,
    dueDate: null,
    dueDateLabel: null,
    responsible: null,
    suggestedResponsibleName: null,
    sources: [],
    href: `/action/${overrides.id}`,
    ...overrides,
  }
}

describe('tracked-point-detail — toTrajectoryEntry', () => {
  it('mappe un événement de trajectoire vers son libellé fixe, sans recalcul d’état', () => {
    const entry = toTrajectoryEntry({ effectiveAt: '2026-01-10', kind: 'resolution_signal', source: 'proposal:abc' })
    expect(entry.kind).toBe('resolution_signal')
    expect(entry.kindLabel).toBe('Preuve documentaire de résolution')
    expect(entry.isResolving).toBe(true)
    expect(entry.source).toBe('proposal:abc')
    expect(entry.dateLabel).toContain('2026')
  })

  it('isResolving couvre resolution_signal ET no_action_decided, jamais les autres', () => {
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'no_action_decided' }).isResolving).toBe(true)
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'open_signal' }).isResolving).toBe(false)
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'resolution_claimed' }).isResolving).toBe(false)
  })

  it('source absent → null (jamais undefined dans le read-model exposé)', () => {
    expect(toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'intent_set' }).source).toBeNull()
  })
})

describe('tracked-point-detail — proposalIdFromSource', () => {
  it('extrait l’id après le préfixe proposal:', () => {
    expect(proposalIdFromSource('proposal:9f1c')).toBe('9f1c')
  })

  it('retourne null pour une origine non documentaire (décision native, etc.)', () => {
    expect(proposalIdFromSource('native:decision-1')).toBeNull()
    expect(proposalIdFromSource(null)).toBeNull()
  })
})

describe('tracked-point-detail — buildHeadline (mise en mots, aucun recalcul d’état)', () => {
  it('reopened avec divergence documentaire connue → cite la divergence en priorité', () => {
    const headline = buildHeadline({
      derivedState: 'reopened', documentaryDivergences: ['PV du 2026-02-01 signale une réapparition'], conflicts: [],
      openedAt: '2025-06-01', latestMeaningfulEventAt: '2026-02-01', mentionsCount: 2,
    })
    expect(headline).toContain('Réouvert')
    expect(headline).toContain('réapparition')
  })

  it('reopened sans divergence détaillée → phrase générique datée sur le DERNIER événement', () => {
    const headline = buildHeadline({
      derivedState: 'reopened', documentaryDivergences: [], conflicts: [],
      openedAt: '2025-06-01', latestMeaningfulEventAt: '2026-02-01', mentionsCount: 2,
    })
    expect(headline).toBe('Réouvert depuis le 1 février 2026 — une preuve plus récente contredit une résolution antérieure.')
  })

  it('conflict cite le premier conflit connu', () => {
    const headline = buildHeadline({
      derivedState: 'conflict', documentaryDivergences: [], conflicts: ['deux preuves incompatibles'],
      openedAt: null, latestMeaningfulEventAt: null, mentionsCount: 0,
    })
    expect(headline).toBe('En conflit — deux preuves incompatibles')
  })

  it('resolved sans date → phrase sans "depuis le"', () => {
    expect(buildHeadline({
      derivedState: 'resolved', documentaryDivergences: [], conflicts: [],
      openedAt: null, latestMeaningfulEventAt: null, mentionsCount: 0,
    })).toBe('Résolu.')
  })

  it('resolved avec mentions → cite le nombre d’occurrences', () => {
    expect(buildHeadline({
      derivedState: 'resolved', documentaryDivergences: [], conflicts: [],
      openedAt: '2025-01-01', latestMeaningfulEventAt: '2026-01-01', mentionsCount: 3,
    })).toBe('Résolu depuis le 1 janvier 2026, mentionné dans 3 occurrences.')
  })

  it('open avec plusieurs mentions étalées → date d’OUVERTURE (premier événement), pas la dernière mention', () => {
    expect(buildHeadline({
      derivedState: 'open', documentaryDivergences: [], conflicts: [],
      openedAt: '2025-03-27', latestMeaningfulEventAt: '2026-02-19', mentionsCount: 5,
    })).toBe('Ouvert depuis le 27 mars 2025, mentionné dans 5 occurrences — aucune résolution constatée à ce jour.')
  })

  it('open avec une seule mention → pas de clause de mentions', () => {
    expect(buildHeadline({
      derivedState: 'open', documentaryDivergences: [], conflicts: [],
      openedAt: '2026-01-01', latestMeaningfulEventAt: '2026-01-01', mentionsCount: 1,
    })).toBe('Ouvert depuis le 1 janvier 2026 — aucune résolution constatée à ce jour.')
  })

  it('open sans trajectoire (fondé par CBO, jamais de preuve documentaire) → phrase honnête sans date inventée', () => {
    expect(buildHeadline({
      derivedState: 'open', documentaryDivergences: [], conflicts: [],
      openedAt: null, latestMeaningfulEventAt: null, mentionsCount: 0,
    })).toBe('Ouvert — aucune résolution constatée à ce jour, aucune preuve documentaire retrouvée.')
  })

  it('unknown → phrase neutre fixe', () => {
    expect(buildHeadline({
      derivedState: 'unknown', documentaryDivergences: [], conflicts: [],
      openedAt: null, latestMeaningfulEventAt: null, mentionsCount: 0,
    })).toBe('État non déterminé — pas assez d’éléments pour se prononcer.')
  })
})

describe('tracked-point-detail — groupLinkedObjectsByTitle (lot UX Point 3F, zéro fuzzy)', () => {
  it('regroupe les titres exactement identiques (aux espaces de bord près)', () => {
    const groups = groupLinkedObjectsByTitle([
      linkedObject({ id: '1', title: 'Transmettre le listing et le plan des extincteurs' }),
      linkedObject({ id: '2', title: 'Transmettre le listing et le plan des extincteurs' }),
      linkedObject({ id: '3', title: 'Transmettre le listing et le plan des extincteurs ' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].items.map((o) => o.id)).toEqual(['1', '2', '3'])
    expect(groups[0].representative.id).toBe('1')
  })

  it('ne fusionne jamais deux titres seulement proches (aucun fuzzy)', () => {
    const groups = groupLinkedObjectsByTitle([
      linkedObject({ id: '1', title: 'Transmettre le listing des extincteurs' }),
      linkedObject({ id: '2', title: 'Transmettre le listing et le plan des extincteurs' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('ne fusionne jamais deux objectType différents portant le même titre', () => {
    const groups = groupLinkedObjectsByTitle([
      linkedObject({ id: '1', title: 'VGP', objectType: 'site_action' }),
      linkedObject({ id: '2', title: 'VGP', objectType: 'site_reserve' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('un titre sans doublon reste un groupe de taille 1', () => {
    const groups = groupLinkedObjectsByTitle([linkedObject({ id: '1', title: 'Vérifier la dotation des RIA' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(1)
  })

  it('liste vide → aucun groupe', () => {
    expect(groupLinkedObjectsByTitle([])).toEqual([])
  })
})

describe('tracked-point-detail — computePointActors (lot Point Actions inline, mandat Vincent)', () => {
  it('un objet sans responsable ne produit aucun acteur (jamais une déduction)', () => {
    expect(computePointActors([linkedObject({ id: '1', title: 'X', responsible: null })])).toEqual([])
  })

  it('compte honnêtement par type d’objet, jamais un total agrégé', () => {
    const actors = computePointActors([
      linkedObject({ id: '1', title: 'A', objectType: 'site_action', responsible: { kind: 'contact', name: 'Lylo', fonction: null } }),
      linkedObject({ id: '2', title: 'B', objectType: 'site_action', responsible: { kind: 'contact', name: 'Lylo', fonction: null } }),
      linkedObject({ id: '3', title: 'C', objectType: 'site_reserve', responsible: { kind: 'contact', name: 'Lylo', fonction: null } }),
    ])
    expect(actors).toHaveLength(1)
    expect(actors[0]).toMatchObject({ name: 'Lylo', responsibleActionCount: 2, responsibleReserveCount: 1, responsibleDeadlineCount: 0 })
  })

  it('un responsable "text" (libre) n’est jamais promu en acteur structuré', () => {
    expect(computePointActors([linkedObject({ id: '1', title: 'X', responsible: { kind: 'text', label: 'quelqu’un' } })])).toEqual([])
  })

  it('deux entreprises distinctes restent deux acteurs distincts', () => {
    const actors = computePointActors([
      linkedObject({ id: '1', title: 'A', responsible: { kind: 'company', name: 'ARES' } }),
      linkedObject({ id: '2', title: 'B', responsible: { kind: 'company', name: 'MIES' } }),
    ])
    expect(actors.map((a) => a.name).sort()).toEqual(['ARES', 'MIES'])
  })
})

describe('tracked-point-detail — suggestResponsibleNames (GAP 1, containment exact, zéro fuzzy)', () => {
  it('propose un acteur déjà structuré dont le nom est contenu dans le titre', () => {
    const result = suggestResponsibleNames(
      [linkedObject({ id: '1', title: 'Relancer Lylo pour le listing des extincteurs' })],
      ['Lylo'],
    )
    expect(result[0].suggestedResponsibleName).toBe('Lylo')
  })

  it('ne propose rien si l’objet a déjà un responsable', () => {
    const result = suggestResponsibleNames(
      [linkedObject({ id: '1', title: 'Relancer Lylo', responsible: { kind: 'contact', name: 'Lylo', fonction: null } })],
      ['Lylo'],
    )
    expect(result[0].suggestedResponsibleName).toBeNull()
  })

  it('aucun acteur ne correspond → silence (null), jamais une invention', () => {
    const result = suggestResponsibleNames([linkedObject({ id: '1', title: 'Vérifier la dotation des RIA' })], ['Lylo'])
    expect(result[0].suggestedResponsibleName).toBeNull()
  })

  it('plusieurs acteurs correspondent au même titre → ambiguïté, jamais un choix arbitraire', () => {
    const result = suggestResponsibleNames(
      [linkedObject({ id: '1', title: 'Réunion ARES et MIES sur le planning' })],
      ['ARES', 'MIES'],
    )
    expect(result[0].suggestedResponsibleName).toBeNull()
  })

  it('ne fusionne jamais deux noms seulement proches (aucun fuzzy)', () => {
    const result = suggestResponsibleNames([linkedObject({ id: '1', title: 'Contacter Lyl pour le devis' })], ['Lylo'])
    expect(result[0].suggestedResponsibleName).toBeNull()
  })

  it('liste d’acteurs vide → retourne les objets inchangés', () => {
    const items = [linkedObject({ id: '1', title: 'Relancer Lylo' })]
    expect(suggestResponsibleNames(items, [])).toBe(items)
  })
})

describe('tracked-point-detail — resolveOrigin / originMatchesProvenance (lot UX Cockpit+Points)', () => {
  it('sans trajectoire → pas de preuve de genèse (jamais fabriquée)', () => {
    const origin = resolveOrigin({ openedAtLabel: null, trajectory: [], evidence: [] })
    expect(origin.dateLabel).toBeNull()
    expect(origin.evidence).toBeNull()
  })

  it('trajectoire sans preuve documentaire pour l’événement d’ouverture → date seule', () => {
    const origin = resolveOrigin({
      openedAtLabel: '1 janvier 2026',
      trajectory: [toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'intent_set' })],
      evidence: [],
    })
    expect(origin.dateLabel).toBe('1 janvier 2026')
    expect(origin.evidence).toBeNull()
  })

  it('trajectoire avec preuve documentaire matchant kind+date de l’ouverture → jointe', () => {
    const openEvidence = evidence({ proposalId: 'p1', kind: 'open_signal', date: '2026-01-01', documentFilename: 'pv-1.pdf' })
    const origin = resolveOrigin({
      openedAtLabel: '1 janvier 2026',
      trajectory: [toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'open_signal', source: 'proposal:p1' })],
      evidence: [openEvidence],
    })
    expect(origin.evidence?.proposalId).toBe('p1')
  })

  it('sans provenance → jamais identique (rien à comparer)', () => {
    const origin = resolveOrigin({
      openedAtLabel: '1 janvier 2026',
      trajectory: [toTrajectoryEntry({ effectiveAt: '2026-01-01', kind: 'open_signal', source: 'proposal:p1' })],
      evidence: [evidence({ proposalId: 'p1', kind: 'open_signal', date: '2026-01-01' })],
    })
    expect(originMatchesProvenance(origin, null)).toBe(false)
  })

  it('provenance = même kind+date que l’ouverture → identique (pas de répétition)', () => {
    const origin: ReturnType<typeof resolveOrigin> = {
      dateLabel: '1 janvier 2026',
      evidence: evidence({ proposalId: 'p1', kind: 'open_signal', date: '2026-01-01' }),
    }
    const provenance: PointDetailProvenance = { ...evidence({ proposalId: 'p1', kind: 'open_signal', date: '2026-01-01' }), isCausal: true }
    expect(originMatchesProvenance(origin, provenance)).toBe(true)
  })

  it('provenance postérieure (Point réouvert) → distincte de la genèse, jamais fusionnée à tort', () => {
    const origin: ReturnType<typeof resolveOrigin> = {
      dateLabel: '1 janvier 2026',
      evidence: evidence({ proposalId: 'p1', kind: 'open_signal', date: '2026-01-01' }),
    }
    const provenance: PointDetailProvenance = { ...evidence({ proposalId: 'p2', kind: 'open_signal', date: '2026-06-01' }), isCausal: true }
    expect(originMatchesProvenance(origin, provenance)).toBe(false)
  })

  it('genèse sans preuve documentaire + provenance de repli → jamais présentée comme identique', () => {
    const origin: ReturnType<typeof resolveOrigin> = { dateLabel: '1 janvier 2026', evidence: null }
    const provenance: PointDetailProvenance = { ...evidence({ proposalId: 'p9', kind: 'intent_set', date: '2026-03-01' }), isCausal: false }
    expect(originMatchesProvenance(origin, provenance)).toBe(false)
  })
})

describe('tracked-point-detail — POINT_STATE_LABEL', () => {
  it('couvre les 5 états dérivés du reducer (contrat gelé)', () => {
    expect(Object.keys(POINT_STATE_LABEL).sort()).toEqual(['conflict', 'open', 'reopened', 'resolved', 'unknown'].sort())
  })
})
