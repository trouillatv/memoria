// « À reprendre » — regroupement par chantier (revue 2026-07-12).
// Les trois garanties : compte VRAI (jamais borné par le calcul), origine par
// report_id EXACT (jamais par correspondance de site), bornes de RENDU seules.

import { describe, it, expect } from 'vitest'
import { buildAttentionGroups, originOfSources, type GroupableItem, type SourceRef } from '@/lib/actions/attention-groups'

let seq = 0
function item(over: Partial<GroupableItem> = {}): GroupableItem {
  seq++
  return {
    key: `k${seq}`,
    severity: 'orange',
    title: `Action ${seq}`,
    subtitle: "pas d'avancée depuis 8 j",
    href: '/m/site/s1',
    group: 'Kiné Adam',
    groupHref: '/m/site/s1',
    reportId: null,
    ...over,
  }
}

describe('buildAttentionGroups', () => {
  it('le COMPTE est vrai au-delà de toute borne : 18 actions → totalCount 18, 2 visibles, +16', () => {
    const items = Array.from({ length: 18 }, () => item())
    const [g] = buildAttentionGroups(items)
    expect(g.totalCount).toBe(18)
    expect(g.items).toHaveLength(2)
    expect(g.moreCount).toBe(16)
  })

  it('deux réunions distinctes sur le même chantier → 2 reportIds, jamais une origine unique arbitraire', () => {
    const items = [
      item({ reportId: 'rep-3juillet' }),
      item({ reportId: 'rep-8juillet' }),
      item({ reportId: 'rep-8juillet' }),
    ]
    const [g] = buildAttentionGroups(items)
    expect(g.reportIds.sort()).toEqual(['rep-3juillet', 'rep-8juillet'])
  })

  it('source unique → un seul reportId (l’origine cliquable est alors certaine)', () => {
    const items = [item({ reportId: 'rep-5' }), item({ reportId: 'rep-5' })]
    const [g] = buildAttentionGroups(items)
    expect(g.reportIds).toEqual(['rep-5'])
  })

  it('3 chantiers max au rendu, ordonnés par la pire sévérité — les familles passent après, non bornées', () => {
    const items = [
      item({ group: 'A', groupHref: '/m/site/a', severity: 'orange' }),
      item({ group: 'B', groupHref: '/m/site/b', severity: 'red' }),
      item({ group: 'C', groupHref: '/m/site/c', severity: 'orange' }),
      item({ group: 'D', groupHref: '/m/site/d', severity: 'yellow' }),
      item({ group: 'Appels d’offres', groupHref: null, severity: 'yellow' }),
      item({ group: 'Passation', groupHref: null, severity: 'indigo' }),
    ]
    const groups = buildAttentionGroups(items)
    expect(groups.map((g) => g.label)).toEqual(['B', 'A', 'C', 'Appels d’offres', 'Passation'])
  })

  it('la raison de la carte = la note du PIRE item (le rouge gagne sur l’orange)', () => {
    const items = [
      item({ severity: 'orange', subtitle: "pas d'avancée depuis 8 j" }),
      item({ severity: 'red', subtitle: 'en retard de 3 j' }),
    ]
    const [g] = buildAttentionGroups(items)
    expect(g.worstSeverity).toBe('red')
    expect(g.reason).toBe('en retard de 3 j')
  })

  it('une action SANS report_id reste comptée et affichable — jamais rattachée à une source', () => {
    const items = [item({ reportId: null }), item({ reportId: 'rep-5' })]
    const [g] = buildAttentionGroups(items)
    expect(g.totalCount).toBe(2)
    expect(g.items).toHaveLength(2)
    expect(g.reportIds).toEqual(['rep-5'])
  })
})

describe('originOfSources — la provenance affichée est toujours exacte', () => {
  const reunion = (id: string, d = '8 juillet'): SourceRef => ({ id, kind: 'reunion', dateLabel: d })
  const visite = (id: string, d = '10 juillet'): SourceRef => ({ id, kind: 'visite', dateLabel: d })

  it('une réunion → « Issue de la réunion du … », route réunion', () => {
    expect(originOfSources([reunion('r1')])).toEqual({
      label: 'Issue de la réunion du 8 juillet',
      href: '/m/reunion/r1',
    })
  })

  it('une visite → « Issue de la visite du … », route récap de visite — JAMAIS présentée comme réunion', () => {
    expect(originOfSources([visite('v1')])).toEqual({
      label: 'Issue de la visite du 10 juillet',
      href: '/m/visite/v1/recap',
    })
  })

  it('deux réunions du même chantier → « Issues de 2 réunions », sans lien arbitraire', () => {
    expect(originOfSources([reunion('r1', '3 juillet'), reunion('r2', '8 juillet')])).toEqual({
      label: 'Issues de 2 réunions',
      href: null,
    })
  })

  it('réunion + visite → « Issues de 2 sources », sans lien', () => {
    expect(originOfSources([reunion('r1'), visite('v1')])).toEqual({
      label: 'Issues de 2 sources',
      href: null,
    })
  })

  it('aucune source (action ajoutée directement) → null, aucune origine inventée', () => {
    expect(originOfSources([])).toBeNull()
  })
})
