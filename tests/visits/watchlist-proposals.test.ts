// Mig 196 — propositions de la liste « À vérifier » : déterministe, spécialisée
// par motif, plafonnée à 7, chaque point tracé à sa source. Zéro IA.

import { describe, it, expect } from 'vitest'
import { buildWatchlistProposals, WATCHLIST_MAX } from '@/lib/visits/watchlist-proposals'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

function signal(kind: MemorySignal['kind'], labels: string[]): MemorySignal {
  return {
    kind,
    title: `${labels.length} ${kind}`,
    items: labels.map((label, i) => ({ id: `${kind}-${i}`, label })),
    source: 'test',
  }
}

const SIGNALS: MemorySignal[] = [
  signal('reserve_open', ['câblage brûlé', 'suies zone cuisson']),
  signal('action_overdue', ['relancer le plombier']),
  signal('decision_unapplied', ['fermer la zone froide']),
  signal('proof_window_closing', ['réseaux avant dépose du plafond']),
]

describe('buildWatchlistProposals', () => {
  it('suivi classique : l’irréversible d’abord (fenêtre de preuve), puis réserves/actions', () => {
    const out = buildWatchlistProposals(SIGNALS, 'avancement')
    expect(out[0].label).toContain('Photographier avant')
    expect(out[0].source_kind).toBe('proof_window_closing')
    expect(out.map((p) => p.source_kind)).toEqual([
      'proof_window_closing', 'reserve_open', 'reserve_open', 'action_overdue', 'decision_unapplied',
    ])
  })

  it('levée de réserves : UNIQUEMENT les réserves ciblées', () => {
    const out = buildWatchlistProposals(SIGNALS, 'levee_reserves')
    expect(out).toHaveLength(2)
    expect(out.every((p) => p.source_kind === 'reserve_open')).toBe(true)
    expect(out[0].label).toBe('Constater sur place : câblage brûlé')
  })

  it('première visite / prévisite AO : aucun faux point (pas encore de mémoire)', () => {
    expect(buildWatchlistProposals(SIGNALS, 'premiere')).toEqual([])
    expect(buildWatchlistProposals(SIGNALS, 'previsite_ao')).toEqual([])
  })

  it('plafonné à 7 — une liste de contrôle, pas un inventaire', () => {
    const many = [signal('reserve_open', Array.from({ length: 20 }, (_, i) => `réserve ${i}`))]
    expect(buildWatchlistProposals(many, 'avancement')).toHaveLength(WATCHLIST_MAX)
  })

  it('chaque point est tracé à sa source (explicabilité)', () => {
    const out = buildWatchlistProposals(SIGNALS, 'avancement')
    expect(out.every((p) => !!p.source_ref)).toBe(true)
  })

  it('aucun signal → aucune liste (jamais inventée)', () => {
    expect(buildWatchlistProposals([], 'avancement')).toEqual([])
  })
})
