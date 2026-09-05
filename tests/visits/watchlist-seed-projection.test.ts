// WOW-2C — le seed watchlist consomme la projection terrain V1 (WOW-2B).
// Ces tests reproduisent PUREMENT la chaîne du seed (server action non invoquée)
// pour prouver le raccord « sémantiquement gratuit » : même population, même ordre,
// même identité, mémoire WOW-2A′ intacte — + verificationMode disponible.

import { describe, it, expect } from 'vitest'
import { buildWatchlistProposals, WATCHLIST_MAX, type WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import { filterSettledNotApplicable, type NotApplicableVerdict } from '@/lib/visits/watchlist-not-applicable-memory'
import { deriveVisitCandidates, VISIT_MODE_POLICY } from '@/lib/visits/visit-candidates'
import { mergeProposals } from '@/lib/visits/watchlist-merge'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { PrepItem } from '@/lib/db/visit-preparation'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SIGNALS: MemorySignal[] = [
  { kind: 'proof_window_closing', title: 'preuves', source: 't',
    items: [{ id: 'pw-1', label: 'coulage dalle R+1' }] },
  { kind: 'reserve_open', title: 'réserves', source: 't',
    items: Array.from({ length: 3 }, (_, i) => ({ id: `res-${i}`, label: `réserve ${i}` })) },
  { kind: 'action_overdue', title: 'actions', source: 't',
    items: [{ id: 'act-1', label: 'reprise étanchéité' }] },
  { kind: 'decision_unapplied', title: 'décisions', source: 't',
    items: [{ id: 'dec-1', label: 'accès employés' }] },
  { kind: 'obligation_neglected', title: 'obligations', source: 't',
    items: [{ id: 'obl-1', label: 'journal photo DOE' }] },
]

/** Chaîne PRÉ-WOW-2C : proposals → mémoire → top 7. */
function legacyAuto(signals: MemorySignal[], motive: null, verdicts: NotApplicableVerdict[], changedAt: Map<string, string | null>): WatchlistProposal[] {
  const proposals = buildWatchlistProposals(signals, motive, Number.MAX_SAFE_INTEGER)
  return filterSettledNotApplicable(proposals, motive, verdicts, changedAt).slice(0, WATCHLIST_MAX)
}

/** Chaîne WOW-2C : proposals → mémoire → PROJECTION → top 7 → retour proposition. */
function projectedAuto(signals: MemorySignal[], motive: null, verdicts: NotApplicableVerdict[], changedAt: Map<string, string | null>): WatchlistProposal[] {
  const proposals = buildWatchlistProposals(signals, motive, Number.MAX_SAFE_INTEGER)
  const kept = filterSettledNotApplicable(proposals, motive, verdicts, changedAt)
  return deriveVisitCandidates(kept).slice(0, WATCHLIST_MAX).map((c) => ({
    label: c.label, source_kind: c.sourceKind, source_ref: c.sourceRef, priority: c.priority, reason: c.reason,
  }))
}

// ── Invariants ──────────────────────────────────────────────────────────────

describe('WOW-2C — raccord sémantiquement gratuit', () => {
  it('2. sans changement de ranking, population finale = comportement PRÉ-2C (mêmes items, même ordre)', () => {
    const legacy = legacyAuto(SIGNALS, null, [], new Map())
    const projected = projectedAuto(SIGNALS, null, [], new Map())
    expect(projected).toEqual(legacy)
  })

  it('1. la projection ne change jamais l’identité source_kind/source_ref', () => {
    const legacy = legacyAuto(SIGNALS, null, [], new Map())
    const projected = projectedAuto(SIGNALS, null, [], new Map())
    expect(projected.map((p) => [p.source_kind, p.source_ref]))
      .toEqual(legacy.map((p) => [p.source_kind, p.source_ref]))
  })

  it('3. verificationMode correct pour les 5 kinds, dérivable de source_kind', () => {
    const kept = buildWatchlistProposals(SIGNALS, null, Number.MAX_SAFE_INTEGER)
    const byRef = new Map(deriveVisitCandidates(kept).map((c) => [c.sourceRef, c.verificationMode]))
    expect(byRef.get('pw-1')).toBe('field_check')
    expect(byRef.get('res-0')).toBe('field_check')
    expect(byRef.get('act-1')).toBe('ask_confirm')
    expect(byRef.get('dec-1')).toBe('ask_confirm')
    expect(byRef.get('obl-1')).toBe('ask_confirm')
    // Dérivabilité au rendu (WOW-2D sans migration) : mode == policy[source_kind].
    for (const c of deriveVisitCandidates(kept)) {
      expect(c.verificationMode).toBe(VISIT_MODE_POLICY[c.sourceKind])
    }
  })
})

describe('WOW-2C — mémoire WOW-2A′ appliquée AVANT la projection', () => {
  const verdict = (kind: string, ref: string): NotApplicableVerdict =>
    ({ source_kind: kind, source_ref: ref, visit_motive: null, decided_at: '2026-01-01T00:00:00Z' })
  const unchanged = (kind: string, ref: string) => new Map([[`${kind}|${ref}`, null]])

  it('4. la suppression not_applicable agit avant le top 7 (item écarté absent de la population projetée)', () => {
    const projected = projectedAuto(SIGNALS, null, [verdict('reserve_open', 'res-1')], unchanged('reserve_open', 'res-1'))
    expect(projected.some((p) => p.source_ref === 'res-1')).toBe(false)
    // et le legacy l’écarte identiquement
    const legacy = legacyAuto(SIGNALS, null, [verdict('reserve_open', 'res-1')], unchanged('reserve_open', 'res-1'))
    expect(projected).toEqual(legacy)
  })

  it('5. une suppression libère toujours une place (population capée à 7, sans trou)', () => {
    const many: MemorySignal[] = [{ kind: 'reserve_open', title: '10 réserves', source: 't',
      items: Array.from({ length: 10 }, (_, i) => ({ id: `r-${i}`, label: `r ${i}` })) }]
    const projected = projectedAuto(many, null, [verdict('reserve_open', 'r-2')], unchanged('reserve_open', 'r-2'))
    expect(projected).toHaveLength(WATCHLIST_MAX)
    expect(projected.map((p) => p.source_ref)).toEqual(['r-0', 'r-1', 'r-3', 'r-4', 'r-5', 'r-6', 'r-7'])
  })
})

describe('WOW-2C — human_prep et hors-canon', () => {
  const human: PrepItem[] = [
    {
      id: 'ph-1', siteId: 's', organizationId: 'o', stableKey: 'verify:cs-h',
      label: 'Vérifier la clim salle serveurs', sourceKind: 'verify', sourceRef: null,
      canonicalSubjectId: 'cs-h', priority: 'important', reason: null,
      preparedBy: 'u', createdAt: '2026-01-01T00:00:00Z',
    },
  ]

  it('6. human_prep n’est jamais filtré par la mémoire machine et reste en tête', () => {
    const auto = projectedAuto(SIGNALS, null, [], new Map())
    const merged = mergeProposals(human, auto)
    expect(merged[0].source_kind).toBe('human_prep')
    expect(merged[0].label).toBe('Vérifier la clim salle serveurs')
  })

  it('7. décisions/obligations hors canon restent seedables après projection', () => {
    const projected = projectedAuto(SIGNALS, null, [], new Map())
    expect(projected.some((p) => p.source_kind === 'decision_unapplied')).toBe(true)
    expect(projected.some((p) => p.source_kind === 'obligation_neglected')).toBe(true)
  })

  it('8/10. aucune dépendance canonicalSubjectId / label / LLM : la projection ne lit que source_kind', () => {
    // Sans enrichissement fourni, tous les candidats existent et portent un mode.
    const kept = buildWatchlistProposals(SIGNALS, null, Number.MAX_SAFE_INTEGER)
    const candidates = deriveVisitCandidates(kept)
    expect(candidates).toHaveLength(kept.length)
    expect(candidates.every((c) => c.canonicalSubjectId === undefined)).toBe(true)
    expect(candidates.every((c) => c.verificationMode === VISIT_MODE_POLICY[c.sourceKind])).toBe(true)
  })
})
