// « Un clic = une destination » sur la liste Actions (Lot 2 · PR1 suite) :
//   1. cliquer le titre de l'action → ouvre la fiche sur /actions (pas le chantier) ;
//   2. l'URL du chantier ne se déclenche PAS depuis le titre ;
//   3. le chantier ne s'ouvre que par son lien dédié (📍 → /sites/[id]).

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionsDashboard } from '@/app/(dashboard)/actions/ActionsDashboard'
import { actionFicheHref, type ActionDashboardItem } from '@/lib/knowledge/actions-dashboard-model'
import type { ActionsDashboard as Data } from '@/lib/knowledge/actions-dashboard'

const item: ActionDashboardItem = {
  id: 'a1', siteId: 's9', siteName: 'Chantier Test',
  title: 'Lever les réserves CVC', description: null,
  status: 'open', statusLabel: 'Ouverte',
  responsibleName: 'M. Roué', responsibleSub: null,
  dueDate: null, dueDateStatus: null,
  lateness: { text: null, tone: null },
  origin: null, observed: null, lastActivity: null,
  hasClosureTrace: false,
  href: actionFicheHref('a1', 's9'),
}

const data: Data = {
  summary: {
    aConfirmer: 0, proposalBreakdown: { deadline: 0, decision: 0, knowledge: 0, stakeholder: 0, vigilance: 0 },
    actives: 1, activesBreakdown: { open: 1, planned: 0 }, enRetard: 0, termineesSansPreuve: 0, terminees: 0, total: 1,
  },
  actions: [item],
  filters: { responsibles: ['M. Roué'], origins: [], statuses: ['open'], sites: [{ id: 's9', name: 'Chantier Test' }] },
}

describe('ActionsDashboard — un clic = une destination', () => {
  it('cliquer le titre ouvre la fiche sur /actions (surimpression), pas le chantier', () => {
    render(<ActionsDashboard data={data} today="2026-07-20" />)
    const titleLink = screen.getByText('Lever les réserves CVC').closest('a')
    expect(titleLink).not.toBeNull()
    expect(titleLink!.getAttribute('href')).toBe(actionFicheHref('a1', 's9'))
    expect(titleLink!.getAttribute('href')!.startsWith('/sites/')).toBe(false)
  })

  it('le chantier ne s\'ouvre que par son lien dédié (📍 → /sites/[id])', () => {
    render(<ActionsDashboard data={data} today="2026-07-20" />)
    const siteLink = screen.getByRole('link', { name: /Chantier Test/ })
    expect(siteLink.getAttribute('href')).toBe('/sites/s9')
  })
})
