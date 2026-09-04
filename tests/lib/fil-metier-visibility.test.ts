// P2-1 — CONTRAT de la sélection VISIBLE du Fil métier : présentation pure sur métadonnées workflow
// (transition / date / dernière évolution). Aucune occurrence supprimée ; pas de slice(N).

import { describe, it, expect } from 'vitest'
import { partitionFilGroups, isFilGroupVisible, filMaxDate } from '@/lib/knowledge/fil-metier-visibility'

const g = (date: string, transitions: (string | null)[], gap = false) => ({
  date, occs: gap ? [{ isGap: true, transition: null }] : transitions.map((t) => ({ isGap: false, transition: t })),
})

describe('partitionFilGroups — Recette A (règles de visibilité)', () => {
  it('dernier PV visible ; PV anciens « maintenu » → historique', () => {
    const groups = [g('2025-01', ['nouveau']), g('2025-03', ['maintenu']), g('2025-05', ['maintenu'])]
    const { visible, history } = partitionFilGroups(groups, null)
    expect(visible.map((x) => x.date)).toContain('2025-05') // dernier PV
    expect(history.map((x) => x.date)).toEqual(['2025-03']) // maintenu ancien replié
    expect(visible.map((x) => x.date)).toContain('2025-01') // nouveau = significatif → visible
  })

  it('transition significative ANCIENNE reste visible (pas cachée par l\'âge)', () => {
    const groups = [g('2025-01', ['nouveau']), g('2025-02', ['réouvert']), g('2025-03', ['maintenu']), g('2025-06', ['maintenu'])]
    const { visible } = partitionFilGroups(groups, null)
    expect(visible.map((x) => x.date)).toEqual(expect.arrayContaining(['2025-01', '2025-02', '2025-06']))
    expect(visible.map((x) => x.date)).not.toContain('2025-03')
  })

  it('aggravé/réapparu/résolu = significatifs ; maintenu/non_mentionné/null = repliables', () => {
    expect(isFilGroupVisible(g('d', ['aggravé']), 'zzz', null)).toBe(true)
    expect(isFilGroupVisible(g('d', ['réapparu']), 'zzz', null)).toBe(true)
    expect(isFilGroupVisible(g('d', ['résolu']), 'zzz', null)).toBe(true)
    expect(isFilGroupVisible(g('d', ['maintenu']), 'zzz', null)).toBe(false)
    expect(isFilGroupVisible(g('d', ['non_mentionné']), 'zzz', null)).toBe(false)
    expect(isFilGroupVisible(g('d', [null]), 'zzz', null)).toBe(false)
  })

  it('dernière évolution métier (lastMeaningfulChangeAt) → visible même sans transition significative', () => {
    const groups = [g('2025-01', ['maintenu']), g('2025-02', ['maintenu']), g('2025-05', ['maintenu'])]
    const { visible } = partitionFilGroups(groups, '2025-02')
    expect(visible.map((x) => x.date)).toEqual(expect.arrayContaining(['2025-02', '2025-05']))
  })

  it('groupe gap seul (non_mentionné) → historique, jamais dans la zone visible', () => {
    const groups = [g('2025-01', ['nouveau']), g('2025-03', [], true), g('2025-05', ['maintenu'])]
    const { visible, history } = partitionFilGroups(groups, null)
    expect(history.some((x) => x.date === '2025-03')).toBe(true)
    expect(filMaxDate(groups)).toBe('2025-05') // le gap ne compte pas comme dernier PV réel
  })
})

describe('partitionFilGroups — Recette B (continuité workflow)', () => {
  it('nouvelle occurrence BANALE au dernier PV → visible car dernier PV', () => {
    const groups = [g('2025-01', ['nouveau']), g('2025-05', ['maintenu'])] // 2025-05 = nouveau PV, mention banale
    const { visible } = partitionFilGroups(groups, null)
    expect(visible.map((x) => x.date)).toContain('2025-05')
  })
  it('nouvelle occurrence SIGNIFICATIVE (réouvert) → visible immédiatement', () => {
    const groups = [g('2025-01', ['nouveau']), g('2025-03', ['maintenu']), g('2025-05', ['réouvert'])]
    const { visible } = partitionFilGroups(groups, null)
    expect(visible.map((x) => x.date)).toContain('2025-05')
  })
  it('occurrence historique/rétroactive NON significative → historique, ne perturbe pas la lecture', () => {
    // un PV rétroactif ancien inséré, mention banale
    const groups = [g('2024-06', ['maintenu']), g('2025-01', ['nouveau']), g('2025-05', ['maintenu'])]
    const { visible, history } = partitionFilGroups(groups, null)
    expect(history.map((x) => x.date)).toContain('2024-06')
    expect(visible.map((x) => x.date)).toEqual(expect.arrayContaining(['2025-01', '2025-05']))
  })
})
