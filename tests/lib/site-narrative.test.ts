// Récit du chantier — fonctions PURES (sans Supabase).
// Doctrine : synthèse déterministe (compte et regroupe), jamais une prédiction.

import { describe, it, expect } from 'vitest'
import {
  buildNarrativeMonths,
  buildStorySummary,
  monthLabelFr,
  type NarrativeEvent,
} from '@/lib/db/site-narrative'
import type { SiteBlocage } from '@/lib/db/site-blocages'
import type { SiteReserve } from '@/lib/db/site-reserve'

function ev(over: Partial<NarrativeEvent>): NarrativeEvent {
  return {
    at: '2026-03-12T00:00:00.000Z',
    date: '2026-03-12',
    kind: 'reunion',
    icon: '📝',
    title: 'Réunion',
    detail: null,
    ...over,
  }
}

function blocage(over: Partial<SiteBlocage> = {}): SiteBlocage {
  return {
    id: 'b', siteId: 's', subjectId: null, type: 'intemperie', title: 'Pluie',
    description: null, impact: null, dateStart: '2026-03-14', dateEnd: '2026-03-16',
    sourceType: 'human', sourceReportId: null, dayLogId: null, ...over,
  }
}

function reserve(over: Partial<SiteReserve> = {}): SiteReserve {
  return {
    id: 'r', siteId: 's', label: 'Porte CF', location: null, issuedBy: null,
    issuedOn: '2026-03-19', status: 'open', photoBeforePath: null, photoAfterPath: null,
    liftedAt: null, liftNote: null, createdAt: '2026-03-19T00:00:00Z', ...over,
  }
}

describe('monthLabelFr', () => {
  it('rend « Mars 2026 » capitalisé', () => {
    expect(monthLabelFr('2026-03')).toBe('Mars 2026')
  })
})

describe('buildNarrativeMonths — groupement chronologique', () => {
  it('groupe par mois ASC et trie les événements ASC dans le mois', () => {
    const months = buildNarrativeMonths([
      ev({ at: '2026-04-02T00:00:00.000Z', date: '2026-04-02', title: 'Avril A' }),
      ev({ at: '2026-03-17T00:00:00.000Z', date: '2026-03-17', title: 'Mars B' }),
      ev({ at: '2026-03-12T00:00:00.000Z', date: '2026-03-12', title: 'Mars A' }),
    ])
    expect(months.map((m) => m.monthKey)).toEqual(['2026-03', '2026-04'])
    expect(months[0].events.map((e) => e.title)).toEqual(['Mars A', 'Mars B'])
    expect(months[0].monthLabel).toBe('Mars 2026')
  })

  it('liste vide → aucun mois', () => {
    expect(buildNarrativeMonths([])).toEqual([])
  })
})

describe('buildStorySummary — synthèse déterministe', () => {
  const events = [
    ev({ date: '2026-03-12' }),
    ev({ date: '2026-03-20', kind: 'blocage' }),
  ]

  it('jours de blocage cumulés (inclusifs) + répartition par type', () => {
    const s = buildStorySummary({
      events,
      reunions: 2,
      decisions: 1,
      // 3 j d'intempérie (14→16 inclus) + 1 j de livraison (20→20)
      blocages: [blocage(), blocage({ type: 'livraison', dateStart: '2026-03-20', dateEnd: '2026-03-20' })],
      reserves: [reserve(), reserve({ id: 'r2', status: 'lifted', liftedAt: '2026-03-23T00:00:00Z' })],
      topSubject: 'DOE',
      todayCivil: '2026-03-25',
    })
    expect(s.blocages.total).toBe(2)
    expect(s.blocages.totalDays).toBe(4) // 3 + 1
    expect(s.blocages.byType[0]).toMatchObject({ type: 'intemperie', days: 3, pct: 75 })
    expect(s.blocages.byType[1]).toMatchObject({ type: 'livraison', days: 1, pct: 25 })
    expect(s.reserves).toEqual({ open: 1, lifted: 1 })
    expect(s.topSubject).toBe('DOE')
    expect(s.startedOn).toBe('2026-03-12')
    expect(s.durationDays).toBe(13) // 12 → 25
  })

  it('blocage EN COURS compté jusqu’à aujourd’hui', () => {
    const s = buildStorySummary({
      events,
      reunions: 0,
      decisions: 0,
      blocages: [blocage({ dateStart: '2026-03-20', dateEnd: null })],
      reserves: [],
      topSubject: null,
      todayCivil: '2026-03-25',
    })
    expect(s.blocages.totalDays).toBe(6) // 20→25 inclus
    expect(s.phase).toBe('En cours (blocage actif)')
  })

  it('phase « Réception » dès qu’une réserve existe', () => {
    const s = buildStorySummary({
      events, reunions: 0, decisions: 0, blocages: [], reserves: [reserve()],
      topSubject: null, todayCivil: '2026-03-25',
    })
    expect(s.phase).toBe('Réception (levée de réserves)')
  })

  it('aucun jalon → startedOn null, phase En cours', () => {
    const s = buildStorySummary({
      events: [], reunions: 0, decisions: 0, blocages: [], reserves: [],
      topSubject: null, todayCivil: '2026-03-25',
    })
    expect(s.startedOn).toBeNull()
    expect(s.durationDays).toBeNull()
    expect(s.phase).toBe('En cours')
  })
})
