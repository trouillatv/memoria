// Helpers PURS du digest nocturne (mig 191, « la Nuit de MemorIA ») — pas de DB.
// Doctrine testée : ordre éditorial du MATIN (l'actionnable daté d'abord),
// discipline d'apparition (au plus N éléments, un chantier n'apparaît qu'une
// fois), silence vert assumé (digest vide ≠ digest absent).

import { describe, it, expect } from 'vitest'
import {
  MORNING_KIND_PRIORITY,
  topMorningSignal,
  pickMorningFocus,
  isQuietMorning,
  type OrgMorningDigest,
  type SiteMorningDigestRow,
} from '@/lib/db/morning-digest'
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'

function signal(kind: SignalKind, itemCount = 1): MemorySignal {
  return {
    kind,
    title: `${itemCount} ${kind}`,
    items: Array.from({ length: itemCount }, (_, i) => ({ id: `${kind}-${i}`, label: `item ${i}` })),
    source: 'test',
  }
}

function siteRow(siteId: string, signals: MemorySignal[], name = siteId): SiteMorningDigestRow {
  return {
    siteId,
    siteName: name,
    digestDate: '2026-07-08',
    signals,
    signalCount: signals.reduce((n, s) => n + s.items.length, 0),
    computedAt: '2026-07-07T19:02:00.000Z',
  }
}

function digest(sites: SiteMorningDigestRow[]): OrgMorningDigest {
  return {
    date: '2026-07-08',
    sites,
    totalSignals: sites.reduce((n, s) => n + s.signalCount, 0),
    computedAt: sites[0]?.computedAt ?? null,
  }
}

describe('MORNING_KIND_PRIORITY — ordre éditorial du matin', () => {
  it("l'actionnable daté passe avant le structurel", () => {
    expect(MORNING_KIND_PRIORITY.indexOf('action_overdue')).toBeLessThan(
      MORNING_KIND_PRIORITY.indexOf('actor_congestion'),
    )
    expect(MORNING_KIND_PRIORITY.indexOf('obligation_neglected')).toBeLessThan(
      MORNING_KIND_PRIORITY.indexOf('reserve_open'),
    )
  })

  it("l'IRRÉVERSIBLE passe avant tout (le retard se rattrape, la preuve recouverte jamais)", () => {
    expect(MORNING_KIND_PRIORITY.indexOf('proof_window_closing')).toBe(0)
  })

  it('couvre tous les kinds connus (pas de signal orphelin silencieux)', () => {
    const known: SignalKind[] = [
      'actor_congestion', 'recurring_topic', 'action_overdue', 'decision_unapplied',
      'actor_absent', 'reserve_open', 'obligation_neglected', 'action_recurring',
      'proof_window_closing',
    ]
    for (const k of known) expect(MORNING_KIND_PRIORITY).toContain(k)
  })
})

describe('topMorningSignal — le plus pressant du chantier', () => {
  it('null si aucun signal', () => {
    expect(topMorningSignal([])).toBeNull()
  })

  it("préfère l'action en retard à la congestion, quel que soit l'ordre", () => {
    const top = topMorningSignal([signal('actor_congestion', 5), signal('action_overdue', 1)])
    expect(top?.kind).toBe('action_overdue')
  })

  it('à priorité égale, préfère le signal le plus fourni', () => {
    const top = topMorningSignal([signal('reserve_open', 1), signal('reserve_open', 4)])
    expect(top?.items).toHaveLength(4)
  })
})

describe('pickMorningFocus — discipline d’apparition', () => {
  it('au plus `max` éléments, même si tout brûle partout', () => {
    const d = digest([
      siteRow('a', [signal('action_overdue', 3)]),
      siteRow('b', [signal('action_overdue', 2)]),
      siteRow('c', [signal('reserve_open', 9)]),
    ])
    expect(pickMorningFocus(d, 2)).toHaveLength(2)
  })

  it('un chantier n’apparaît qu’UNE fois (son signal le plus pressant)', () => {
    const d = digest([siteRow('a', [signal('action_overdue', 1), signal('reserve_open', 8)])])
    const focus = pickMorningFocus(d, 3)
    expect(focus).toHaveLength(1)
    expect(focus[0].signal.kind).toBe('action_overdue')
  })

  it('classe les chantiers entre eux par priorité de kind puis volume', () => {
    const d = digest([
      siteRow('calme', [signal('actor_congestion', 2)]),
      siteRow('urgent', [signal('action_overdue', 1)]),
    ])
    const focus = pickMorningFocus(d, 2)
    expect(focus[0].siteId).toBe('urgent')
    expect(focus[1].siteId).toBe('calme')
  })

  it('digest vide → aucun focus (le silence est le comportement par défaut)', () => {
    expect(pickMorningFocus(digest([siteRow('a', [])]), 2)).toHaveLength(0)
  })
})

describe('isQuietMorning — silence vert assumé', () => {
  it('vrai quand la nuit a tourné et n’a RIEN trouvé', () => {
    expect(isQuietMorning(digest([siteRow('a', []), siteRow('b', [])]))).toBe(true)
  })

  it('faux dès qu’un chantier a un signal', () => {
    expect(isQuietMorning(digest([siteRow('a', [signal('reserve_open')])]))).toBe(false)
  })
})
