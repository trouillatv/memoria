import { describe, it, expect } from 'vitest'
import {
  digestRelevance,
  compareDigestRelevance,
  type DigestRelevance,
} from '@/lib/db/morning-digest'
import type { OrgMorningDigest } from '@/lib/db/morning-digest'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

// M3 — le HERO du matin en multi-org : « le plus pertinent », règle DÉTERMINISTE.
// On teste la mécanique de choix (pure), pas la base : attention → signaux →
// fraîcheur → organization_id (départage STABLE).

function sig(kind: MemorySignal['kind'], itemCount: number): MemorySignal {
  return { kind, title: 't', source: 's', items: Array.from({ length: itemCount }, () => ({}) as never) }
}
function digest(opts: { signals?: MemorySignal[][]; computedAt?: string | null }): OrgMorningDigest {
  const sites = (opts.signals ?? []).map((signals, i) => ({
    siteId: `s${i}`, siteName: `S${i}`, digestDate: '2026-07-22',
    signals, signalCount: signals.reduce((n, s) => n + s.items.length, 0),
    computedAt: opts.computedAt ?? '2026-07-22T06:00:00Z',
  }))
  return {
    date: '2026-07-22', sites,
    totalSignals: sites.reduce((n, s) => n + s.signalCount, 0),
    computedAt: opts.computedAt ?? '2026-07-22T06:00:00Z',
  }
}

/** Trie N digests par pertinence décroissante, rend l'org gagnante. */
function winner(entries: Array<{ org: string; d: OrgMorningDigest }>): string | null {
  if (entries.length === 0) return null
  return [...entries]
    .sort((a, b) => compareDigestRelevance(digestRelevance(b.d, b.org), digestRelevance(a.d, a.org)))[0].org
}

describe('sélection du HERO du matin — déterministe', () => {
  it('0 organisation avec digest → aucun gagnant (repli à l’appelant)', () => {
    expect(winner([])).toBeNull()
  })

  it('1 seul digest → c’est lui', () => {
    expect(winner([{ org: 'AGP', d: digest({ signals: [[sig('action_overdue', 2)]] }) }])).toBe('AGP')
  })

  it('2 digests → plus d’éléments d’attention gagne', () => {
    const a = { org: 'AGP', d: digest({ signals: [[sig('action_overdue', 1)]] }) }
    const b = { org: 'SERVINOR', d: digest({ signals: [[sig('action_overdue', 5)]] }) }
    expect(winner([a, b])).toBe('SERVINOR')
  })

  it('à attention égale, le plus de signaux gagne', () => {
    // Même item du signal le plus pressant (attention=2), mais SERVINOR a plus de
    // signaux affichables au total.
    const a = { org: 'AGP', d: digest({ signals: [[sig('action_overdue', 2)]] }) }
    const b = { org: 'SERVINOR', d: digest({ signals: [[sig('action_overdue', 2)], [sig('reserve_open', 3)]] }) }
    expect(winner([a, b])).toBe('SERVINOR')
  })

  it('à attention et signaux égaux, le plus récent gagne', () => {
    const a = { org: 'AGP', d: digest({ signals: [[sig('action_overdue', 2)]], computedAt: '2026-07-22T05:00:00Z' }) }
    const b = { org: 'SERVINOR', d: digest({ signals: [[sig('action_overdue', 2)]], computedAt: '2026-07-22T06:30:00Z' }) }
    expect(winner([a, b])).toBe('SERVINOR')
  })

  it('égalité PARFAITE → départage stable par organization_id (le plus petit gagne)', () => {
    const shape = () => digest({ signals: [[sig('action_overdue', 2)]], computedAt: '2026-07-22T06:00:00Z' })
    // Peu importe l'ordre d'entrée, le gagnant est le même (stable).
    expect(winner([{ org: 'AGP', d: shape() }, { org: 'SERVINOR', d: shape() }])).toBe('AGP')
    expect(winner([{ org: 'SERVINOR', d: shape() }, { org: 'AGP', d: shape() }])).toBe('AGP')
  })

  it('3 organisations → l’ordre complet est respecté', () => {
    const a = { org: 'AGP', d: digest({ signals: [[sig('action_overdue', 1)]] }) }
    const b = { org: 'BETA', d: digest({ signals: [[sig('action_overdue', 9)]] }) }
    const c = { org: 'CETA', d: digest({ signals: [[sig('action_overdue', 4)]] }) }
    expect(winner([a, b, c])).toBe('BETA')
  })
})
