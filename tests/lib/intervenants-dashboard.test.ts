import { describe, expect, it } from 'vitest'
import { buildIntervenantsDashboard, IDLE_DAYS } from '@/lib/knowledge/intervenants-dashboard-model'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'
import type { AssignedAction } from '@/lib/knowledge/assigned-actions'

const TODAY = '2026-07-19'
let n = 0
const person = (o: Partial<IntervenantPerson>): IntervenantPerson => ({
  intervenantId: `i${n++}`, contactId: 'c1', isPerson: true, name: 'Personne', fonction: null, role: 'Rôle',
  companyId: 'co1', companyName: 'Co', phone: null, mobile: null, email: null,
  firstSeen: null, lastActivity: null, citedVisits: [], mentionCount: 0,
  assignedActions: [], decisionsCount: 0, openObligationsCount: 0, elsewhere: [], ...o,
})
const act = (isLate: boolean): AssignedAction => ({
  id: `a${n++}`, title: 't', dueDate: null, dueDateStatus: null, isLate, href: '/', hrefSource: 'site_work',
})
const visit = (date: string) => ({ reportId: `r${n++}`, date })

describe('buildIntervenantsDashboard — projection leaderboard + KPIs', () => {
  it('un intervenant avec plusieurs citations validées n’apparaît qu’UNE fois', () => {
    const d = buildIntervenantsDashboard('s', [person({ citedVisits: [visit('2026-07-01'), visit('2026-07-10'), visit('2026-07-17')] })], 0, TODAY)
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0].citedVisitsCount).toBe(3)
  })

  it('une proposition (proposed) n’incrémente QUE « à identifier » — jamais le leaderboard', () => {
    const d = buildIntervenantsDashboard('s', [], 3, TODAY)
    expect(d.rows).toHaveLength(0)
    expect(d.toIdentifyCount).toBe(3)
    expect(d.kpis.validatedCount).toBe(0)
    expect(d.kpis.engagementsActifs).toBe(0)
  })

  it('un intervenant validé (présent dans le casting) apparaît dans le leaderboard', () => {
    const d = buildIntervenantsDashboard('s', [person({ name: 'Paul' })], 2, TODAY)
    expect(d.rows.map((r) => r.name)).toEqual(['Paul'])
    expect(d.kpis.validatedCount).toBe(1)
    expect(d.toIdentifyCount).toBe(2) // les deux mondes coexistent sans se mélanger
  })

  it('un intervenant SANS action mais AVEC obligations est compté dans les engagements', () => {
    const d = buildIntervenantsDashboard('s', [person({ assignedActions: [], openObligationsCount: 2 })], 0, TODAY)
    expect(d.rows[0].engagementsActifs).toBe(2)
    expect(d.kpis.engagementsActifs).toBe(2)
  })

  it('engagements actifs = actions ouvertes + obligations ouvertes', () => {
    const d = buildIntervenantsDashboard('s', [person({ assignedActions: [act(false), act(true)], openObligationsCount: 1 })], 0, TODAY)
    expect(d.rows[0].openActions).toBe(2)
    expect(d.rows[0].lateActions).toBe(1)
    expect(d.rows[0].engagementsActifs).toBe(3)
  })

  it('le tri par engagements est DÉTERMINISTE en cas d’égalité (retards, puis nom)', () => {
    const people = [
      person({ name: 'Zoé', assignedActions: [act(false)] }),
      person({ name: 'Anna', assignedActions: [act(false)] }),
      person({ name: 'Marc', assignedActions: [act(true)] }), // même engagement (1), mais 1 retard
    ]
    const first = buildIntervenantsDashboard('s', people, 0, TODAY).rows.map((r) => r.name)
    const second = buildIntervenantsDashboard('s', [...people].reverse(), 0, TODAY).rows.map((r) => r.name)
    // Marc (1 retard) devant, puis Anna avant Zoé (nom) — stable quel que soit l'ordre d'entrée.
    expect(first).toEqual(['Marc', 'Anna', 'Zoé'])
    expect(second).toEqual(['Marc', 'Anna', 'Zoé'])
  })
})

describe('KPIs = calculés depuis LES MÊMES lignes que le tableau (garde-fou)', () => {
  const people = [
    person({ name: 'A', assignedActions: [act(true), act(true)], openObligationsCount: 1, lastActivity: '2026-06-01', elsewhere: [{ siteId: 'x', siteName: 'X', role: 'r' }] }),
    person({ name: 'B', assignedActions: [act(false)], openObligationsCount: 0, lastActivity: '2026-07-18' }),
    person({ name: 'C', assignedActions: [], openObligationsCount: 0, lastActivity: '2026-07-19' }),
  ]
  const d = buildIntervenantsDashboard('s', people, 0, TODAY)

  it('engagements actifs KPI = somme des engagements des lignes', () => {
    expect(d.kpis.engagementsActifs).toBe(d.rows.reduce((n, r) => n + r.engagementsActifs, 0))
    expect(d.kpis.engagementsActifs).toBe(3 + 1 + 0)
  })
  it('en retard KPI = somme des retards ; personnes concernées = lignes avec ≥1 retard', () => {
    expect(d.kpis.lateTotal).toBe(2)
    expect(d.kpis.latePeople).toBe(1)
  })
  it('sans activité récente = même seuil (>30 j) que le badge de ligne', () => {
    expect(IDLE_DAYS).toBe(30)
    expect(d.kpis.idleCount).toBe(d.rows.filter((r) => r.isIdle).length)
    expect(d.kpis.idleCount).toBe(1) // A (48 j)
  })
  it('multi-chantiers = même définition que le badge (elsewhere non vide)', () => {
    expect(d.kpis.multiSiteCount).toBe(d.rows.filter((r) => r.isMultiSite).length)
    expect(d.kpis.multiSiteCount).toBe(1)
  })
})
