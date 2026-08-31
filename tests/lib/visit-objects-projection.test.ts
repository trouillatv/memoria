// P0 · Point 6 (convergence) — projection MOBILE du read-model partagé.
// `projectVisitObjects` n'est PAS un second read-model : il aplatit les groupes
// canonical de buildVisitChanges en listes par type. Ces tests verrouillent la
// navigation (fiche précise vs sujet vs espace, jamais desktop) ET le TÉMOIN
// COMMUN : la projection expose EXACTEMENT les mêmes IDs d'objets que le
// read-model (que le desktop VisitDesk consomme directement) — aucune divergence.

import { describe, it, expect } from 'vitest'
import { projectVisitObjects } from '@/lib/db/visit-objects'
import type { VisitChangeGroup } from '@/lib/db/visit-narrative'

function group(over: Partial<VisitChangeGroup>): VisitChangeGroup {
  return {
    canonicalSubjectId: null, subjectLabel: null,
    actions: [], deadlines: [], knowledge: [], watchpoints: [], decisions: [], reserves: [], stakeholders: [],
    sourceCount: 0, ...over,
  }
}

const S = 'site-1'

describe('projectVisitObjects — navigation par type', () => {
  it('action → fiche précise', () => {
    const o = projectVisitObjects([group({ actions: [{ id: 'a1', title: 'A', status: 'open', priority: null }] })], S)
    expect(o.actions[0]).toMatchObject({ href: `/m/site/${S}/action/a1`, precise: true, ctaLabel: 'Voir la fiche', statusLabel: 'Ouverte' })
  })

  it('réserve → espace Réserves ; échéance → Planning (CTA honnête)', () => {
    const o = projectVisitObjects([group({
      reserves: [{ id: 'r1', label: 'R' }],
      deadlines: [{ id: 'd1', title: 'D', dueDate: null }],
    })], S)
    expect(o.reserves[0]).toMatchObject({ href: `/m/site/${S}/reserves`, ctaLabel: 'Voir les réserves', precise: false })
    expect(o.deadlines[0]).toMatchObject({ href: '/m/planning', ctaLabel: 'Voir le planning' })
  })

  it('décision / intervenant / vigilance AVEC sujet → historique du sujet', () => {
    const g = group({
      canonicalSubjectId: 'cs-1', subjectLabel: 'Contrôle électrique',
      decisions: [{ id: 'dec1', title: 'Décision' }],
      stakeholders: [{ id: 'st1', role: 'Entreprise', label: 'ACME' }],
      watchpoints: [{ id: 'w1', title: 'Vigilance' }],
    })
    const o = projectVisitObjects([g], S)
    expect(o.decisions[0]).toMatchObject({ href: `/m/site/${S}/sujets/cs-1`, ctaLabel: 'Voir le sujet' })
    expect(o.stakeholders[0]).toMatchObject({ href: `/m/site/${S}/sujets/cs-1`, ctaLabel: 'Voir le sujet', label: 'Entreprise — ACME' })
    expect(o.watchpoints[0]).toMatchObject({ href: `/m/site/${S}/sujets/cs-1`, ctaLabel: 'Voir le sujet' })
  })

  it('décision SANS sujet → aucune destination précise (href null, pas de CTA)', () => {
    const o = projectVisitObjects([group({ decisions: [{ id: 'dec2', title: 'Décision libre' }] })], S)
    expect(o.decisions[0]).toMatchObject({ href: null, ctaLabel: null })
  })

  it('connaissance : sujet si canonical, sinon Patrimoine', () => {
    const withCs = projectVisitObjects([group({ canonicalSubjectId: 'cs-9', knowledge: [{ id: 'k1', title: 'K', kind: 'durable_knowledge' }] })], S)
    expect(withCs.knowledge[0]).toMatchObject({ href: `/m/site/${S}/sujets/cs-9`, ctaLabel: 'Voir le sujet' })
    const noCs = projectVisitObjects([group({ knowledge: [{ id: 'k2', title: 'K2', kind: 'current_information' }] })], S)
    expect(noCs.knowledge[0]).toMatchObject({ href: `/m/site/${S}/patrimoine`, ctaLabel: 'Voir le patrimoine' })
  })

  it('aucun objet → isEmpty', () => {
    expect(projectVisitObjects([], S).isEmpty).toBe(true)
    expect(projectVisitObjects([group({})], S).isEmpty).toBe(true)
  })
})

describe('projectVisitObjects — TÉMOIN COMMUN desktop/mobile (mêmes IDs)', () => {
  it('la projection expose exactement les IDs des groupes, par population (rien perdu/ajouté)', () => {
    const groups: VisitChangeGroup[] = [
      group({ canonicalSubjectId: 'cs-a', subjectLabel: 'A',
        actions: [{ id: 'a1', title: 'A1', status: 'open', priority: null }],
        reserves: [{ id: 'r1', label: 'R1' }],
        decisions: [{ id: 'dec1', title: 'Dec1' }],
        knowledge: [{ id: 'k1', title: 'K1', kind: 'durable_knowledge' }] }),
      group({ canonicalSubjectId: null,
        actions: [{ id: 'a2', title: 'A2', status: 'done', priority: null }],
        deadlines: [{ id: 'd1', title: 'D1', dueDate: null }],
        watchpoints: [{ id: 'w1', title: 'W1' }],
        stakeholders: [{ id: 's1', role: 'BET', label: 'X' }] }),
    ]
    const o = projectVisitObjects(groups, S)
    const idsOf = (pop: keyof VisitChangeGroup) =>
      groups.flatMap((g) => (g[pop] as Array<{ id: string }>).map((x) => x.id)).sort()

    expect(o.actions.map((x) => x.id).sort()).toEqual(idsOf('actions'))
    expect(o.reserves.map((x) => x.id).sort()).toEqual(idsOf('reserves'))
    expect(o.deadlines.map((x) => x.id).sort()).toEqual(idsOf('deadlines'))
    expect(o.decisions.map((x) => x.id).sort()).toEqual(idsOf('decisions'))
    expect(o.stakeholders.map((x) => x.id).sort()).toEqual(idsOf('stakeholders'))
    expect(o.watchpoints.map((x) => x.id).sort()).toEqual(idsOf('watchpoints'))
    expect(o.knowledge.map((x) => x.id).sort()).toEqual(idsOf('knowledge'))
  })
})
