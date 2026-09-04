// WOW-2A′ — mémoire du verdict « sans objet ».
// MemorIA ne repose pas une question déjà explicitement écartée, tant que rien
// n'a changé et que le contexte de visite reste le même. Ni contrôlabilité
// terrain, ni classification : identité = source_kind + source_ref.

import { describe, it, expect } from 'vitest'
import {
  filterSettledNotApplicable,
  proposalsNeedingFreshness,
  watchlistSourceKey,
  type NotApplicableVerdict,
} from '@/lib/visits/watchlist-not-applicable-memory'
import { buildWatchlistProposals, WATCHLIST_MAX, type WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { VisitMotive, WatchlistItemState } from '@/types/db'

const VERDICT_AT = '2026-08-24T09:00:00.000Z'

function proposal(kind: string, ref: string | null): WatchlistProposal {
  return { label: `point ${kind} ${ref}`, source_kind: kind, source_ref: ref, priority: 'important', reason: null }
}

function verdict(kind: string, ref: string, motive: VisitMotive | null, at = VERDICT_AT): NotApplicableVerdict {
  return { source_kind: kind, source_ref: ref, visit_motive: motive, decided_at: at }
}

/** Reproduit le contrat du chargeur : SEUL `not_applicable` devient un verdict
 *  (lib/db/watchlist-not-applicable.ts filtre `state = 'not_applicable'`). */
function verdictsFromWatchlistRows(
  rows: Array<{ source_kind: string; source_ref: string; state: WatchlistItemState; motive: VisitMotive | null }>,
): NotApplicableVerdict[] {
  return rows
    .filter((r) => r.state === 'not_applicable')
    .map((r) => verdict(r.source_kind, r.source_ref, r.motive))
}

/** Fraîcheur : clé présente + null = source lue, aucune horloge posée. */
function unchanged(kind: string, ref: string): Map<string, string | null> {
  return new Map([[watchlistSourceKey(kind, ref), null]])
}

describe('filterSettledNotApplicable', () => {
  it('1. même source + même motif + sans objet + source inchangée ⇒ exclue', () => {
    const out = filterSettledNotApplicable(
      [proposal('decision_unapplied', 'dec-1')],
      'avancement',
      [verdict('decision_unapplied', 'dec-1', 'avancement')],
      unchanged('decision_unapplied', 'dec-1'),
    )
    expect(out).toEqual([])
  })

  it('2. même source + AUTRE motif ⇒ reste proposable (le verdict ne se propage pas)', () => {
    const out = filterSettledNotApplicable(
      [proposal('decision_unapplied', 'dec-1')],
      'reception',
      [verdict('decision_unapplied', 'dec-1', 'avancement')],
      unchanged('decision_unapplied', 'dec-1'),
    )
    expect(out).toHaveLength(1)
  })

  it('3. même source MATÉRIELLEMENT modifiée depuis le verdict ⇒ nouvel épisode, reste proposable', () => {
    const out = filterSettledNotApplicable(
      [proposal('reserve_open', 'res-1')],
      'avancement',
      [verdict('reserve_open', 'res-1', 'avancement')],
      new Map([[watchlistSourceKey('reserve_open', 'res-1'), '2026-08-30T07:00:00.000Z']]),
    )
    expect(out).toHaveLength(1)
  })

  it('4. `checked` ⇒ comportement ACTUEL inchangé (aucune suppression dans ce lot)', () => {
    const rows = [{ source_kind: 'reserve_open', source_ref: 'res-1', state: 'checked' as WatchlistItemState, motive: 'avancement' as VisitMotive }]
    const proposals = [proposal('reserve_open', 'res-1')]
    const out = filterSettledNotApplicable(proposals, 'avancement', verdictsFromWatchlistRows(rows), unchanged('reserve_open', 'res-1'))
    expect(out).toEqual(proposals)
  })

  it('5. `still_open` ⇒ reste éligible', () => {
    const rows = [{ source_kind: 'reserve_open', source_ref: 'res-1', state: 'still_open' as WatchlistItemState, motive: 'avancement' as VisitMotive }]
    const proposals = [proposal('reserve_open', 'res-1')]
    const out = filterSettledNotApplicable(proposals, 'avancement', verdictsFromWatchlistRows(rows), unchanged('reserve_open', 'res-1'))
    expect(out).toEqual(proposals)
  })

  it('6. `pending` n’est pas un verdict ⇒ aucune suppression historique', () => {
    const rows = [{ source_kind: 'action_overdue', source_ref: 'act-1', state: 'pending' as WatchlistItemState, motive: 'avancement' as VisitMotive }]
    const proposals = [proposal('action_overdue', 'act-1')]
    const out = filterSettledNotApplicable(proposals, 'avancement', verdictsFromWatchlistRows(rows), unchanged('action_overdue', 'act-1'))
    expect(out).toEqual(proposals)
  })

  it('7. une décision HORS canon (site_decisions n’a pas de canonical_subject_id) est mémorisée normalement', () => {
    const out = filterSettledNotApplicable(
      [proposal('decision_unapplied', '28141a48'), proposal('reserve_open', 'res-9')],
      'avancement',
      [verdict('decision_unapplied', '28141a48', 'avancement')],
      new Map([
        [watchlistSourceKey('decision_unapplied', '28141a48'), null],
        [watchlistSourceKey('reserve_open', 'res-9'), null],
      ]),
    )
    expect(out.map((p) => p.source_kind)).toEqual(['reserve_open'])
  })

  it('8. l’identité du verdict est source_kind + source_ref — aucun canonical_subject requis', () => {
    // Même source_ref, famille différente ⇒ objets différents ⇒ aucune contagion.
    const out = filterSettledNotApplicable(
      [proposal('reserve_open', 'shared-id')],
      'avancement',
      [verdict('decision_unapplied', 'shared-id', 'avancement')],
      unchanged('reserve_open', 'shared-id'),
    )
    expect(out).toHaveLength(1)
  })

  it('9. chronologie métier : un changement ANTÉRIEUR au verdict ne rouvre rien', () => {
    const before = filterSettledNotApplicable(
      [proposal('reserve_open', 'res-1')],
      'avancement',
      [verdict('reserve_open', 'res-1', 'avancement')],
      new Map([[watchlistSourceKey('reserve_open', 'res-1'), '2026-08-01T07:00:00.000Z']]),
    )
    expect(before).toEqual([])

    const after = filterSettledNotApplicable(
      [proposal('reserve_open', 'res-1')],
      'avancement',
      [verdict('reserve_open', 'res-1', 'avancement')],
      new Map([[watchlistSourceKey('reserve_open', 'res-1'), '2026-08-25T07:00:00.000Z']]),
    )
    expect(after).toHaveLength(1)
  })

  it('le dernier verdict fait foi quand la même source a été écartée plusieurs fois', () => {
    const out = filterSettledNotApplicable(
      [proposal('reserve_open', 'res-1')],
      'avancement',
      [
        verdict('reserve_open', 'res-1', 'avancement', '2026-08-01T07:00:00.000Z'),
        verdict('reserve_open', 'res-1', 'avancement', '2026-08-28T07:00:00.000Z'),
      ],
      new Map([[watchlistSourceKey('reserve_open', 'res-1'), '2026-08-10T07:00:00.000Z']]),
    )
    expect(out).toEqual([]) // le changement du 10 précède le verdict du 28
  })

  it('fenêtre de preuve irréversible : jamais supprimée, même déclarée sans objet', () => {
    const out = filterSettledNotApplicable(
      [proposal('proof_window_closing', 'pw-1')],
      'avancement',
      [verdict('proof_window_closing', 'pw-1', 'avancement')],
      unchanged('proof_window_closing', 'pw-1'),
    )
    expect(out).toHaveLength(1)
  })

  it('fraîcheur INCONNUE (source introuvable / famille non couverte) ⇒ on repropose', () => {
    const out = filterSettledNotApplicable(
      [proposal('obligation_neglected', 'obl-1')],
      'avancement',
      [verdict('obligation_neglected', 'obl-1', 'avancement')],
      new Map(), // clé absente
    )
    expect(out).toHaveLength(1)
  })

  it('proposition sans source_ref ⇒ aucune identité, aucune mémoire', () => {
    const p = [proposal('reserve_open', null)]
    expect(filterSettledNotApplicable(p, 'avancement', [verdict('reserve_open', 'res-1', 'avancement')], unchanged('reserve_open', 'res-1'))).toEqual(p)
  })

  it('aucun verdict ⇒ liste strictement inchangée (aucune régression du seed actuel)', () => {
    const p = [proposal('reserve_open', 'res-1'), proposal('action_overdue', 'act-1')]
    expect(filterSettledNotApplicable(p, 'avancement', [], new Map())).toBe(p)
  })
})

// ── Plafond : la mémoire LIBÈRE une place, elle n'appauvrit pas la préparation ──
//
// Le câblage réel (startVisitAction) construit SANS plafond, filtre, puis
// plafonne. Ces deux invariants figent cette sémantique : sans suppression on
// retombe exactement sur l'ancien top-7 ; avec suppression, le candidat suivant
// remonte au lieu de laisser un trou.

/** Reproduit à l'identique le pipeline de seed de `startVisitAction`. */
function seedPipeline(
  signals: MemorySignal[],
  motive: VisitMotive | null,
  verdicts: NotApplicableVerdict[],
  changedAt: Map<string, string | null>,
): WatchlistProposal[] {
  const candidates = buildWatchlistProposals(signals, motive, Number.MAX_SAFE_INTEGER)
  return filterSettledNotApplicable(candidates, motive, verdicts, changedAt).slice(0, WATCHLIST_MAX)
}

/** 10 réserves ouvertes : ids `reserve_open-0` … `reserve_open-9`. */
const TEN_RESERVES: MemorySignal[] = [{
  kind: 'reserve_open',
  title: '10 réserves',
  items: Array.from({ length: 10 }, (_, i) => ({ id: `reserve_open-${i}`, label: `réserve ${i}` })),
  source: 'test',
}]

describe('plafond WATCHLIST_MAX après mémoire', () => {
  it('aucune suppression ⇒ sortie STRICTEMENT identique à l’ancien top-7 (mêmes 7, même ordre)', () => {
    const legacy = buildWatchlistProposals(TEN_RESERVES, 'avancement')
    const withMemory = seedPipeline(TEN_RESERVES, 'avancement', [], new Map())
    expect(legacy).toHaveLength(WATCHLIST_MAX)
    expect(withMemory).toEqual(legacy)
    expect(withMemory.map((p) => p.source_ref)).toEqual(legacy.map((p) => p.source_ref))
  })

  it('un élément du top-7 supprimé ⇒ le 8e candidat éligible remonte, toujours 7, sans trou', () => {
    const settled = 'reserve_open-2' // 3e du top-7
    const withMemory = seedPipeline(
      TEN_RESERVES,
      'avancement',
      [verdict('reserve_open', settled, 'avancement')],
      unchanged('reserve_open', settled),
    )
    expect(withMemory).toHaveLength(WATCHLIST_MAX)
    expect(withMemory.map((p) => p.source_ref)).toEqual([
      'reserve_open-0', 'reserve_open-1', 'reserve_open-3', 'reserve_open-4',
      'reserve_open-5', 'reserve_open-6', 'reserve_open-7', // ← le 8e candidat a pris la place
    ])
  })
})

describe('proposalsNeedingFreshness', () => {
  it('ne demande la fraîcheur que des sources réellement écartées pour CE motif', () => {
    const proposals = [
      proposal('reserve_open', 'res-1'), // écartée
      proposal('reserve_open', 'res-2'), // jamais écartée
      proposal('decision_unapplied', 'dec-1'), // écartée sous un autre motif
      proposal('proof_window_closing', 'pw-1'), // jamais supprimable
    ]
    const out = proposalsNeedingFreshness(proposals, 'avancement', [
      verdict('reserve_open', 'res-1', 'avancement'),
      verdict('decision_unapplied', 'dec-1', 'reception'),
      verdict('proof_window_closing', 'pw-1', 'avancement'),
    ])
    expect(out).toEqual([{ source_kind: 'reserve_open', source_ref: 'res-1' }])
  })

  it('aucun verdict ⇒ aucune lecture de fraîcheur', () => {
    expect(proposalsNeedingFreshness([proposal('reserve_open', 'res-1')], 'avancement', [])).toEqual([])
  })
})
