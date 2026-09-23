// Plan de visite (Lot B) — mémoire du verdict « ne plus suivre ».
// dismissed_permanently exclut une source DÉFINITIVEMENT, sans condition de
// motif ni de fraîcheur — contrairement à filterSettledNotApplicable (legacy
// not_applicable). Couvre l'exigence de test #7 du mandat : "dismissed_permanently
// → ne réapparaît jamais".

import { describe, it, expect } from 'vitest'
import { filterDismissedPermanently } from '@/lib/visits/watchlist-dismissed-memory'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'

function proposal(kind: string, ref: string | null): WatchlistProposal {
  return { label: `point ${kind} ${ref}`, source_kind: kind, source_ref: ref, priority: 'important', reason: null }
}

describe('filterDismissedPermanently', () => {
  it('source déclarée ne plus suivre ⇒ exclue définitivement, quel que soit le motif', () => {
    const out = filterDismissedPermanently(
      [proposal('reserve_open', 'res-1')],
      new Set([watchlistSourceKey('reserve_open', 'res-1')]),
    )
    expect(out).toEqual([])
  })

  it('source non déclarée ⇒ reste proposable', () => {
    const p = [proposal('reserve_open', 'res-2')]
    const out = filterDismissedPermanently(p, new Set([watchlistSourceKey('reserve_open', 'res-1')]))
    expect(out).toEqual(p)
  })

  it('même source_ref, kind différent ⇒ aucune contagion (identité = kind+ref)', () => {
    const out = filterDismissedPermanently(
      [proposal('decision_unapplied', 'shared-id')],
      new Set([watchlistSourceKey('reserve_open', 'shared-id')]),
    )
    expect(out).toHaveLength(1)
  })

  it('proposition sans source_ref ⇒ aucune identité, aucune mémoire possible', () => {
    const p = [proposal('reserve_open', null)]
    const out = filterDismissedPermanently(p, new Set([watchlistSourceKey('reserve_open', 'res-1')]))
    expect(out).toEqual(p)
  })

  it('aucune clé écartée ⇒ liste strictement inchangée (même référence)', () => {
    const p = [proposal('reserve_open', 'res-1'), proposal('action_overdue', 'act-1')]
    expect(filterDismissedPermanently(p, new Set())).toBe(p)
  })

  it('liste de propositions vide ⇒ liste vide inchangée', () => {
    const p: WatchlistProposal[] = []
    expect(filterDismissedPermanently(p, new Set(['x']))).toBe(p)
  })

  it('plusieurs sources écartées, seules les sources concernées sont retirées', () => {
    const out = filterDismissedPermanently(
      [
        proposal('reserve_open', 'res-1'),
        proposal('action_overdue', 'act-1'),
        proposal('obligation_neglected', 'obl-1'),
      ],
      new Set([
        watchlistSourceKey('reserve_open', 'res-1'),
        watchlistSourceKey('obligation_neglected', 'obl-1'),
      ]),
    )
    expect(out.map((p) => p.source_kind)).toEqual(['action_overdue'])
  })

  it('aucune notion de fraîcheur ni de motif : contrairement à not_applicable, rien ne rouvre une source écartée', () => {
    // Pas de paramètre motif/changedAt dans la signature : la fonction ne peut
    // structurellement pas rouvrir une source, à la différence de
    // filterSettledNotApplicable.
    expect(filterDismissedPermanently.length).toBe(2)
  })
})
