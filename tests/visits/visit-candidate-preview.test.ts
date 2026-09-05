// WOW-2D — le Briefing mobile et le seed consomment la MÊME population machine.
// Tests purs (chaîne reproduite) + doctrine (source des surfaces) : « preview == seed »,
// mémoire WOW-2A′ partagée, groupement field_check / ask_confirm, S1 legacy remplacé.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildWatchlistProposals, WATCHLIST_MAX, type WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import { filterSettledNotApplicable, type NotApplicableVerdict } from '@/lib/visits/watchlist-not-applicable-memory'
import { deriveVisitCandidates, type ObjectVisitCandidate } from '@/lib/visits/visit-candidates'
import { partitionByVerificationMode } from '@/lib/visits/visit-candidate-preview'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const SIGNALS: MemorySignal[] = [
  { kind: 'proof_window_closing', title: 'preuves', source: 't', items: [{ id: 'pw-1', label: 'coulage dalle' }] },
  { kind: 'reserve_open', title: 'réserves', source: 't', items: [{ id: 'res-0', label: 'porte CF' }, { id: 'res-1', label: 'sprinkler' }] },
  { kind: 'action_overdue', title: 'actions', source: 't', items: [{ id: 'act-1', label: 'étanchéité' }] },
  { kind: 'decision_unapplied', title: 'décisions', source: 't', items: [{ id: 'dec-1', label: 'accès employés' }] },
  { kind: 'obligation_neglected', title: 'obligations', source: 't', items: [{ id: 'obl-1', label: 'journal photo' }] },
]

/** Cœur PUR partagé par le read-model et le seed : mémoire → projection → top N. */
function machinePopulation(signals: MemorySignal[], verdicts: NotApplicableVerdict[], changedAt: Map<string, string | null>): ObjectVisitCandidate[] {
  const proposals = buildWatchlistProposals(signals, null, Number.MAX_SAFE_INTEGER)
  const kept = filterSettledNotApplicable(proposals, null, verdicts, changedAt)
  return deriveVisitCandidates(kept).slice(0, WATCHLIST_MAX)
}
const toProp = (c: ObjectVisitCandidate): WatchlistProposal =>
  ({ label: c.label, source_kind: c.sourceKind, source_ref: c.sourceRef, priority: c.priority, reason: c.reason })

describe('WOW-2D — preview == population machine seedée', () => {
  it('1/3. le Briefing et le seed lisent la même population (top WATCHLIST_MAX)', () => {
    const pop = machinePopulation(SIGNALS, [], new Map())
    // Le seed mappe cette population en propositions ; le Briefing la partitionne.
    const seedProposals = pop.map(toProp)
    const { field_check, ask_confirm } = partitionByVerificationMode(pop)
    // Aucune perte : l'union des deux registres = la population machine.
    expect([...field_check, ...ask_confirm].map((c) => c.sourceRef).sort())
      .toEqual(seedProposals.map((p) => p.source_ref).sort())
    expect(pop.length).toBeLessThanOrEqual(WATCHLIST_MAX)
  })

  it('4/8. groupement par mode : field_check = constats, ask_confirm = décisions/obligations/actions', () => {
    const { field_check, ask_confirm } = partitionByVerificationMode(machinePopulation(SIGNALS, [], new Map()))
    expect(field_check.every((c) => c.verificationMode === 'field_check')).toBe(true)
    expect(ask_confirm.every((c) => c.verificationMode === 'ask_confirm')).toBe(true)
    expect(field_check.map((c) => c.sourceKind).sort()).toEqual(['proof_window_closing', 'reserve_open', 'reserve_open'])
    // Décision HORS CANON bien visible dans « À demander / confirmer ».
    expect(ask_confirm.some((c) => c.sourceKind === 'decision_unapplied')).toBe(true)
    expect(ask_confirm.some((c) => c.sourceKind === 'obligation_neglected')).toBe(true)
  })

  it('partition conserve l’ordre historique À L’INTÉRIEUR de chaque mode (pas un nouveau ranking)', () => {
    const pop = machinePopulation(SIGNALS, [], new Map())
    const { field_check } = partitionByVerificationMode(pop)
    const orderInPop = pop.filter((c) => c.verificationMode === 'field_check').map((c) => c.sourceRef)
    expect(field_check.map((c) => c.sourceRef)).toEqual(orderInPop)
  })

  it('2. mémoire WOW-2A′ partagée : un not_applicable inchangé disparaît des DEUX surfaces', () => {
    const verdicts: NotApplicableVerdict[] = [{ source_kind: 'reserve_open', source_ref: 'res-1', visit_motive: null, decided_at: '2026-01-01T00:00:00Z' }]
    const changedAt = new Map([['reserve_open|res-1', null]])
    const pop = machinePopulation(SIGNALS, verdicts, changedAt)
    expect(pop.some((c) => c.sourceRef === 'res-1')).toBe(false)
    const { field_check } = partitionByVerificationMode(pop)
    expect(field_check.some((c) => c.sourceRef === 'res-1')).toBe(false)
  })

  it('7. human_prep n’entre JAMAIS dans la population machine', () => {
    const pop = machinePopulation(SIGNALS, [], new Map())
    expect(pop.some((c) => c.sourceKind === 'human_prep')).toBe(false)
  })

  it('9. aucune dépendance à canonicalSubjectId : tous les candidats existent sans enrichissement', () => {
    const pop = machinePopulation(SIGNALS, [], new Map())
    expect(pop.length).toBe(6)
    expect(pop.every((c) => c.canonicalSubjectId === undefined)).toBe(true)
  })
})

describe('WOW-2D — doctrine des surfaces (source)', () => {
  const BLOCK = read('app/(field)/m/site/[siteId]/prepare/VisitBriefingBlock.tsx')
  const PREVIEW = read('lib/visits/visit-candidate-preview.ts')

  it('5. S1 legacy « À vérifier aujourd’hui » est REMPLACÉ par les deux registres', () => {
    expect(BLOCK).not.toContain("À vérifier aujourd'hui")
    expect(BLOCK).toContain('À constater sur place')
    expect(BLOCK).toContain('À demander / confirmer')
  })

  it('6. le delta « Depuis votre dernière visite » est conservé', () => {
    expect(BLOCK).toContain('Depuis votre dernière visite')
  })

  it('le Briefing ne rend plus l’urgence legacy (pas de pastille critical/high)', () => {
    expect(BLOCK).not.toContain('URGENCY_DOT')
    expect(BLOCK).not.toContain('item.urgency')
  })

  it('10. le read-model n’APPELLE PAS rankVisitCandidates (ordre historique)', () => {
    expect(PREVIEW).not.toContain('rankVisitCandidates(')
  })
})
