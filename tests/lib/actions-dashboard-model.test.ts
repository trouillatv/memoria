import { describe, expect, it } from 'vitest'
import {
  ACTION_STATUS_LABEL, isOverdue, isDoneWithoutProof, latenessLabel, daysUntil,
  inTab, applyActionFilters, summarizeActions,
  type ActionDashboardItem,
} from '@/lib/knowledge/actions-dashboard-model'

const TODAY = '2026-07-19'
const item = (o: Partial<ActionDashboardItem>): ActionDashboardItem => ({
  id: 'x', siteId: 's', siteName: 'S', title: 'T', description: null, status: 'open', statusLabel: 'Ouverte',
  responsibleName: null, responsibleSub: null, dueDate: null, dueDateStatus: null,
  lateness: { text: null, tone: null }, origin: null, lastActivity: null, hasClosureTrace: false, href: '/', ...o,
})

describe('statuts — fidèles au modèle réel, jamais « En cours »', () => {
  it('traduit uniquement open/planned/done/cancelled', () => {
    expect(ACTION_STATUS_LABEL).toEqual({ open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée' })
    expect(Object.values(ACTION_STATUS_LABEL)).not.toContain('En cours')
  })
})

describe('En retard — engagée, échéance EXPLICITE dépassée', () => {
  it('une échéance explicite passée sur une action ouverte = en retard', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-07-01', dueDateStatus: 'explicit' }, TODAY)).toBe(true)
  })
  it('une échéance ESTIMÉE ne compte pas', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-07-01', dueDateStatus: 'estimated' }, TODAY)).toBe(false)
  })
  it('une action terminée n’est jamais en retard', () => {
    expect(isOverdue({ status: 'done', dueDate: '2026-07-01', dueDateStatus: 'explicit' }, TODAY)).toBe(false)
  })
})

describe('Terminées sans preuve — clôturée SANS trace de clôture', () => {
  it('done + aucune trace → oui', () => {
    expect(isDoneWithoutProof({ status: 'done', hasClosureTrace: false })).toBe(true)
  })
  it('done + trace de clôture → non (ne doit pas apparaître)', () => {
    expect(isDoneWithoutProof({ status: 'done', hasClosureTrace: true })).toBe(false)
  })
  it('une action ouverte n’est jamais « sans preuve » (le problème est à la clôture)', () => {
    expect(isDoneWithoutProof({ status: 'open', hasClosureTrace: false })).toBe(false)
  })
})

describe('libellé d’échéance', () => {
  it('à venir → J-n ; proche → tonalité d’alerte', () => {
    expect(latenessLabel({ status: 'open', dueDate: '2026-07-22' }, TODAY)).toEqual({ text: 'J-3', tone: 'neg' })
    expect(latenessLabel({ status: 'open', dueDate: '2026-07-25' }, TODAY)).toEqual({ text: 'J-6', tone: 'ok' })
  })
  it('dépassée → +n jours', () => {
    expect(latenessLabel({ status: 'open', dueDate: '2026-07-07' }, TODAY)).toEqual({ text: '+12 jours', tone: 'neg' })
  })
  it('terminée → « clôturée » ; sans échéance → rien', () => {
    expect(latenessLabel({ status: 'done', dueDate: '2026-07-07' }, TODAY)).toEqual({ text: 'clôturée', tone: 'done' })
    expect(latenessLabel({ status: 'open', dueDate: null }, TODAY)).toEqual({ text: null, tone: null })
  })
  it('daysUntil compte en jours civils', () => {
    expect(daysUntil(TODAY, '2026-07-22')).toBe(3)
    expect(daysUntil(TODAY, '2026-07-07')).toBe(-12)
  })
})

describe('onglets et filtres — logique centralisée', () => {
  const items = [
    item({ id: 'a', status: 'open' }),
    item({ id: 'b', status: 'planned' }),
    item({ id: 'c', status: 'open', dueDate: '2026-07-01', dueDateStatus: 'explicit' }),
    item({ id: 'd', status: 'done', hasClosureTrace: true }),
    item({ id: 'e', status: 'done', hasClosureTrace: false }),
    item({ id: 'f', status: 'cancelled' }),
  ]
  it('« Toutes » masque les annulées', () => {
    expect(items.filter((i) => inTab(i, TODAY, 'all')).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('onglets Actives / En retard / Terminées sans preuve', () => {
    expect(items.filter((i) => inTab(i, TODAY, 'active')).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(items.filter((i) => inTab(i, TODAY, 'overdue')).map((i) => i.id)).toEqual(['c'])
    expect(items.filter((i) => inTab(i, TODAY, 'done_no_proof')).map((i) => i.id)).toEqual(['e'])
  })
  it('filtres responsable / origine / recherche', () => {
    const list = [
      item({ id: '1', title: 'Coffret', responsibleName: 'M. Tama', origin: { type: 'reunion', label: 'Réunion #8', href: '/m/8' } }),
      item({ id: '2', title: 'Peinture', responsibleName: 'A. Wright', origin: { type: 'visite', label: 'Visite', href: '/v' } }),
    ]
    expect(applyActionFilters(list, { search: '', responsibleName: 'M. Tama', originType: null, status: null }).map((i) => i.id)).toEqual(['1'])
    expect(applyActionFilters(list, { search: '', responsibleName: null, originType: 'visite', status: null }).map((i) => i.id)).toEqual(['2'])
    expect(applyActionFilters(list, { search: 'coffret', responsibleName: null, originType: null, status: null }).map((i) => i.id)).toEqual(['1'])
  })
})

describe('summarizeActions — KPIs, « à confirmer » vient des propositions', () => {
  const items = [
    item({ status: 'open' }),
    item({ status: 'planned' }),
    item({ status: 'open', dueDate: '2026-07-01', dueDateStatus: 'explicit' }),
    item({ status: 'done', hasClosureTrace: true }),
    item({ status: 'done', hasClosureTrace: false }),
    item({ status: 'cancelled' }),
  ]
  const s = summarizeActions(items, TODAY, { aConfirmer: 3, breakdown: { deadline: 3, decision: 1, knowledge: 2, stakeholder: 3, vigilance: 0 } })

  it('« à confirmer » = propositions d’action, jamais dérivé des site_actions', () => {
    expect(s.aConfirmer).toBe(3)
  })
  it('le détail transverse reste séparé et ne gonfle pas le KPI', () => {
    expect(s.proposalBreakdown).toEqual({ deadline: 3, decision: 1, knowledge: 2, stakeholder: 3, vigilance: 0 })
    // le nombre principal reste 3, pas l'agrégat (3+3+1+2+3)
    expect(s.aConfirmer).not.toBe(12)
  })
  it('actives / en retard / terminées / sans preuve / total (annulées exclues)', () => {
    expect(s.actives).toBe(3)
    expect(s.activesBreakdown).toEqual({ open: 2, planned: 1 })
    expect(s.enRetard).toBe(1)
    expect(s.terminees).toBe(2)
    expect(s.termineesSansPreuve).toBe(1)
    expect(s.total).toBe(5)
  })
})
