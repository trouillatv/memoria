// 14A — Classement déterministe du bloc « À traiter » (rankLiveDebriefToHandle).
// Prouve la hiérarchie retard > imminence > réouverture > ancienneté, les
// tie-breaks stables, et la dégradation gracieuse sur données pauvres (aucune
// raison inventée). Pur, sans I/O — on construit des items en mémoire.

import { describe, expect, it } from 'vitest'
import {
  rankLiveDebriefToHandle,
  type LiveDebriefItem,
  type LiveDebriefObjectItem,
} from '@/lib/knowledge/live-debrief'

const TODAY = '2026-09-01'

function action(over: Partial<LiveDebriefObjectItem> & { id: string }): LiveDebriefObjectItem {
  return {
    kind: 'action',
    title: `Action ${over.id}`,
    status: 'open',
    disposition: 'to_handle',
    date: null,
    openedAt: null,
    canonicalSubjectId: null,
    reportId: null,
    href: `/x/${over.id}`,
    ...over,
  }
}

function rankMap(items: LiveDebriefItem[], reopenedSubjectIds: string[] = []) {
  const ranked = rankLiveDebriefToHandle(items, { reopenedSubjectIds, today: TODAY })
  return ranked.map((i) => ({
    id: i.kind === 'informational_signal' ? i.signalKey : i.id,
    priority: i.rank?.priority,
    reason: i.rank?.reason,
    secondary: i.rank?.secondary,
  }))
}

describe('rankLiveDebriefToHandle — hiérarchie de priorité', () => {
  it('retard > imminence > réouverture > ancienneté', () => {
    const items: LiveDebriefItem[] = [
      action({ id: 'age', openedAt: '2026-08-01' }), // ancienneté simple
      action({ id: 'reopen', canonicalSubjectId: 'cs-r' }), // réouverture (sujet rouvert)
      action({ id: 'imminent', date: '2026-09-04' }), // échéance dans 3 j
      action({ id: 'late', date: '2026-07-20' }), // en retard
    ]
    const out = rankMap(items, ['cs-r'])
    expect(out.map((o) => o.id)).toEqual(['late', 'imminent', 'reopen', 'age'])
    expect(out.map((o) => o.priority)).toEqual(['retard', 'imminence', 'reopened', 'age'])
  })

  it('la réserve (date = émission) ne compte jamais comme retard/imminence', () => {
    const reserve: LiveDebriefObjectItem = {
      kind: 'reserve', id: 'r1', title: 'Réserve', status: 'open', disposition: 'to_handle',
      date: '2026-01-10', openedAt: '2026-01-10', canonicalSubjectId: null, reportId: null, href: '/r/1',
    }
    const [only] = rankMap([reserve])
    expect(only.priority).toBe('age')
    expect(only.reason).toMatch(/Réserve ouverte depuis \d+ j/)
  })
})

describe('rankLiveDebriefToHandle — tie-breaks déterministes', () => {
  it('retard : le plus en retard (échéance la plus ancienne) d’abord', () => {
    const items = [
      action({ id: 'b', date: '2026-08-01' }),
      action({ id: 'a', date: '2026-06-01' }),
      action({ id: 'c', date: '2026-08-15' }),
    ]
    expect(rankMap(items).map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('imminence : l’échéance la plus proche d’abord', () => {
    const items = [
      action({ id: 'far', date: '2026-09-06' }),
      action({ id: 'near', date: '2026-09-02' }),
    ]
    expect(rankMap(items).map((o) => o.id)).toEqual(['near', 'far'])
  })

  it('ancienneté : la plus ancienne ouverture d’abord, puis id stable', () => {
    const items = [
      action({ id: 'z', openedAt: '2026-08-10' }),
      action({ id: 'a', openedAt: '2026-08-10' }), // même date → id asc
      action({ id: 'old', openedAt: '2026-05-01' }),
    ]
    expect(rankMap(items).map((o) => o.id)).toEqual(['old', 'a', 'z'])
  })

  it('égalité totale d’échéance en retard → id stable', () => {
    const items = [
      action({ id: 'y', date: '2026-07-01' }),
      action({ id: 'x', date: '2026-07-01' }),
    ]
    expect(rankMap(items).map((o) => o.id)).toEqual(['x', 'y'])
  })

  it('classement indépendant de l’ordre d’entrée (aucun ordre SQL implicite)', () => {
    // Groupes d'égalités volontaires : deux retards à même échéance, deux
    // anciennetés à même ouverture. Seul l'id doit départager, quel que soit
    // l'ordre dans lequel les objets arrivent (fetch SQL non ordonné).
    const base = [
      action({ id: 'ret-b', date: '2026-07-10' }),
      action({ id: 'ret-a', date: '2026-07-10' }),
      action({ id: 'ret-early', date: '2026-06-01' }),
      action({ id: 'age-b', openedAt: '2026-08-01' }),
      action({ id: 'age-a', openedAt: '2026-08-01' }),
    ]
    const expected = ['ret-early', 'ret-a', 'ret-b', 'age-a', 'age-b']
    const forward = rankMap(base).map((o) => o.id)
    const reversed = rankMap([...base].reverse()).map((o) => o.id)
    const rotated = rankMap([base[3], base[0], base[4], base[2], base[1]]).map((o) => o.id)
    expect(forward).toEqual(expected)
    expect(reversed).toEqual(expected)
    expect(rotated).toEqual(expected)
  })
})

describe('rankLiveDebriefToHandle — dégradation gracieuse (données pauvres)', () => {
  it('action sans aucune date → « Action ouverte », jamais de raison inventée', () => {
    const [o] = rankMap([action({ id: 'bare' })])
    expect(o.priority).toBe('age')
    expect(o.reason).toBe('Action ouverte')
    expect(o.secondary).toBeNull()
  })

  it('action avec created_at seul → « Ouverte depuis N j » (cas BELLA)', () => {
    const [o] = rankMap([action({ id: 'bella', openedAt: '2026-08-27' })])
    expect(o.priority).toBe('age')
    expect(o.reason).toBe(`Ouverte depuis ${5} j`) // 27/08 → 01/09
  })

  it('openedAt = timestamptz complet → jours corrects, jamais NaN (régression recette)', () => {
    // created_at réel est un timestamptz, pas une date : le helper doit tronquer.
    const [o] = rankMap([action({ id: 'ts', openedAt: '2026-08-27T01:17:25.225867+00:00' })])
    expect(o.reason).toBe('Ouverte depuis 5 j')
    expect(o.reason).not.toContain('NaN')
  })

  it('échéance datée mais lointaine (> horizon) → ancienneté, raison datée', () => {
    const [o] = rankMap([action({ id: 'far', date: '2026-12-01' })])
    expect(o.priority).toBe('age')
    expect(o.reason).toBe('Échéance le 01/12/2026')
  })
})

describe('rankLiveDebriefToHandle — raison et rang du même calcul', () => {
  it('retard : raison = jours de retard, complément = date d’échéance absolue', () => {
    const [o] = rankMap([action({ id: 'late', date: '2026-07-20' })])
    expect(o.priority).toBe('retard')
    expect(o.reason).toBe('En retard de 43 j') // 20/07 → 01/09
    expect(o.secondary).toBe('Échéance le 20/07/2026')
  })

  it('n’altère pas les items d’entrée (pas de mutation)', () => {
    const input = action({ id: 'x', date: '2026-07-20' })
    rankLiveDebriefToHandle([input], { reopenedSubjectIds: [], today: TODAY })
    expect('rank' in input && (input as LiveDebriefObjectItem).rank).toBeFalsy()
  })
})
