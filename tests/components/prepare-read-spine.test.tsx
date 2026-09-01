// Point 11A — colonne de lecture du Brief mobile. Verrouille : « À traiter » =
// top 5 OBJETS NOMMÉS + « Voir plus » (jamais un agrégat « 5 actions »), et la
// vérité temporelle personnelle 9+10 (« votre » seulement si personal).

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrepareReadSpine } from '@/app/(field)/m/site/[siteId]/prepare/PrepareReadSpine'
import type { LiveDebriefItem, LiveDebriefSinceLastVisit, LiveDebriefConfirmedToday } from '@/lib/knowledge/live-debrief'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

const confirmed: LiveDebriefConfirmedToday = {
  actionsActive: 0, actionsOverdue: 0, deadlinesToPlan: 0, deadlinesPlanned: 0, reservesOpen: 0, nextEvent: null,
}

function action(i: number): LiveDebriefItem {
  return {
    kind: 'action', id: `a${i}`, title: `Action nommée ${i}`, status: 'open',
    disposition: 'to_handle', date: null, canonicalSubjectId: null, reportId: null, href: `/m/x/a${i}`,
  } as LiveDebriefItem
}

describe('PrepareReadSpine — À traiter : top 5 nommés + Voir plus', () => {
  it('affiche 5 objets NOMMÉS et un « Voir plus » pour le reste (jamais « 5 actions »)', () => {
    const toHandle = Array.from({ length: 7 }, (_, i) => action(i + 1))
    render(
      <PrepareReadSpine objective={null} toHandle={toHandle} toWatch={[]}
        sinceLastVisit={{ kind: 'first_visit' }} confirmedToday={confirmed} />,
    )
    // 5 nommés visibles, le 6e caché
    expect(screen.getByText('Action nommée 1')).toBeTruthy()
    expect(screen.getByText('Action nommée 5')).toBeTruthy()
    expect(screen.queryByText('Action nommée 6')).toBeNull()
    // Pas d'agrégat « 7 actions » / « 5 actions »
    expect(screen.queryByText(/\d+\s+actions?$/)).toBeNull()
    // Voir plus révèle le reste
    const more = screen.getByText(/Voir plus \(2 autres\)/)
    fireEvent.click(more)
    expect(screen.getByText('Action nommée 6')).toBeTruthy()
    expect(screen.getByText('Action nommée 7')).toBeTruthy()
  })

  it('≤ 5 items : aucun « Voir plus »', () => {
    render(
      <PrepareReadSpine objective={null} toHandle={[action(1), action(2)]} toWatch={[]}
        sinceLastVisit={{ kind: 'first_visit' }} confirmedToday={confirmed} />,
    )
    expect(screen.queryByText(/Voir plus/)).toBeNull()
  })
})

describe('PrepareReadSpine — Depuis la venue : vérité personnelle 9+10', () => {
  const delta = (personal: boolean): LiveDebriefSinceLastVisit => ({
    kind: 'delta', at: '2026-08-01', visitDateLabel: '1 août', daysAgo: 10, personal,
    items: [], overflow: 0,
  })

  it('personal=true → « votre »', () => {
    render(<PrepareReadSpine objective={null} toHandle={[]} toWatch={[]} sinceLastVisit={delta(true)} confirmedToday={confirmed} />)
    expect(screen.getByText(/Depuis votre dernière venue/)).toBeTruthy()
    expect(screen.getByText(/depuis votre passage/)).toBeTruthy()
  })

  it('personal=false → « la dernière visite », jamais « votre »', () => {
    render(<PrepareReadSpine objective={null} toHandle={[]} toWatch={[]} sinceLastVisit={delta(false)} confirmedToday={confirmed} />)
    expect(screen.getByText(/Depuis la dernière visite/)).toBeTruthy()
    expect(screen.queryByText(/votre/)).toBeNull()
  })
})
