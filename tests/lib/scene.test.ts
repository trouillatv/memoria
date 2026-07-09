// MISE EN SCÈNE — tests PURS (aucune DB, joués en CI).
// Doctrine testée : la couture choisit l'ordre du récit (matin = on agit,
// réunion = on anime) ; l'irréversible passe en premier PARTOUT ; un kind
// inconnu se raconte en dernier, jamais d'exception.

import { describe, it, expect } from 'vitest'
import { SCENE_ORDER, orderSignals, type SceneMoment } from '@/lib/mise-en-scene'
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'

const ALL_KINDS: SignalKind[] = [
  'actor_congestion', 'recurring_topic', 'action_overdue', 'decision_unapplied',
  'actor_absent', 'reserve_open', 'obligation_neglected', 'action_recurring',
  'proof_window_closing',
]

function sig(kind: SignalKind): MemorySignal {
  return { kind, title: kind, items: [{ id: kind, label: kind }], source: 'test' }
}

describe('SCENE_ORDER — chaque couture a son récit complet', () => {
  it('chaque scène couvre TOUS les kinds (pas de signal muet)', () => {
    for (const moment of Object.keys(SCENE_ORDER) as SceneMoment[]) {
      for (const k of ALL_KINDS) expect(SCENE_ORDER[moment]).toContain(k)
    }
  })

  it("l'IRRÉVERSIBLE ouvre le récit partout — le retard se rattrape, la preuve recouverte jamais", () => {
    for (const moment of Object.keys(SCENE_ORDER) as SceneMoment[]) {
      expect(SCENE_ORDER[moment][0]).toBe('proof_window_closing')
    }
  })

  it('les coutures racontent différemment : le matin on agit, en réunion on anime', () => {
    // Matin : l'action datée avant la concentration d'acteur.
    expect(SCENE_ORDER.matin.indexOf('action_overdue')).toBeLessThan(SCENE_ORDER.matin.indexOf('actor_congestion'))
    // Réunion : la concentration (« de quoi on va parler ») avant l'action datée.
    expect(SCENE_ORDER.reunion.indexOf('actor_congestion')).toBeLessThan(SCENE_ORDER.reunion.indexOf('action_overdue'))
  })
})

describe('orderSignals — le récit ordonné', () => {
  it('ordonne selon la couture demandée', () => {
    const shuffled = [sig('reserve_open'), sig('actor_congestion'), sig('proof_window_closing'), sig('action_overdue')]
    const matin = orderSignals(shuffled, 'matin').map((s) => s.kind)
    expect(matin).toEqual(['proof_window_closing', 'action_overdue', 'reserve_open', 'actor_congestion'])
    const reunion = orderSignals(shuffled, 'reunion').map((s) => s.kind)
    expect(reunion).toEqual(['proof_window_closing', 'actor_congestion', 'action_overdue', 'reserve_open'])
  })

  it("ne mute pas l'entrée et tolère un kind inconnu (raconté en dernier)", () => {
    const unknown = { kind: 'detecteur_futur' as SignalKind, title: 'x', items: [], source: 'test' }
    const input = [unknown, sig('action_overdue')]
    const out = orderSignals(input, 'matin')
    expect(out.map((s) => s.kind)).toEqual(['action_overdue', 'detecteur_futur'])
    expect(input[0].kind).toBe('detecteur_futur') // entrée intacte
  })
})
