// WOW-2E — le plan next_visit du Copilote consomme la population object-first,
// VisitControl n'enrichit que par rattachement déterministe et n'ajoute jamais d'item.

import { describe, it, expect } from 'vitest'
import { buildNextVisitPlan, MODE_LABEL, type SubjectEnrichmentFacts } from '@/lib/visits/next-visit-plan'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'
import type { ObjectVisitCandidate } from '@/lib/visits/visit-candidates'

function candidate(sourceKind: string, sourceRef: string, mode: 'field_check' | 'ask_confirm'): ObjectVisitCandidate {
  return {
    candidateKind: 'object', sourceKind, sourceRef,
    label: `${sourceKind} ${sourceRef}`, reason: null,
    verificationMode: mode, priority: 'important', reopenedBoost: false,
  }
}

// Population type Briefing/seed : 2 réserves (field_check) + 1 décision hors canon (ask_confirm).
const CANDIDATES: ObjectVisitCandidate[] = [
  candidate('reserve_open', 'res-0', 'field_check'),
  candidate('reserve_open', 'res-1', 'field_check'),
  candidate('decision_unapplied', 'dec-1', 'ask_confirm'),
]
const facts = (why: string): SubjectEnrichmentFacts => ({ why, lastKnown: 'ouvert', changeSinceLastVisit: null })

describe('WOW-2E — plan next_visit == population machine', () => {
  it('1/8. mappe 1:1 les candidats, aucun ajout, aucune perte, même ordre', () => {
    const plan = buildNextVisitPlan(CANDIDATES, new Map(), new Map())
    expect(plan.map((p) => [p.sourceKind, p.sourceRef]))
      .toEqual([['reserve_open', 'res-0'], ['reserve_open', 'res-1'], ['decision_unapplied', 'dec-1']])
    expect(plan).toHaveLength(CANDIDATES.length)
  })

  it('6. verificationMode n’est jamais recalculé (passe-plat depuis le candidat)', () => {
    const plan = buildNextVisitPlan(CANDIDATES, new Map(), new Map())
    expect(plan.map((p) => p.verificationMode)).toEqual(['field_check', 'field_check', 'ask_confirm'])
    expect(plan[0].tierLabel).toBe(MODE_LABEL.field_check)
    expect(plan[2].tierLabel).toBe(MODE_LABEL.ask_confirm)
  })

  it('7. l’ordre n’est jamais modifié', () => {
    const plan = buildNextVisitPlan(CANDIDATES, new Map(), new Map())
    expect(plan.map((p) => p.sourceRef)).toEqual(['res-0', 'res-1', 'dec-1'])
  })

  it('3. décisions hors canon conservées, sans enrichissement', () => {
    const plan = buildNextVisitPlan(CANDIDATES, new Map(), new Map())
    const dec = plan.find((p) => p.sourceKind === 'decision_unapplied')!
    expect(dec).toBeDefined()
    expect(dec.canonicalSubjectId).toBeUndefined()
    expect(dec.why).toBeUndefined()
    expect(dec.id).toBe('decision_unapplied:dec-1')
  })
})

describe('WOW-2E — VisitControl enrichit mais n’ajoute jamais', () => {
  it('4. enrichit un candidat rattaché (why/lastKnown/changeSince), COUNT inchangé', () => {
    const subjectByRef = new Map([[watchlistSourceKey('reserve_open', 'res-0'), 'cs-A']])
    const controlByCs = new Map([['cs-A', facts('Réserve ouverte depuis 62 j')]])
    const plan = buildNextVisitPlan(CANDIDATES, subjectByRef, controlByCs)
    expect(plan).toHaveLength(3) // aucun item ajouté
    const enriched = plan.find((p) => p.sourceRef === 'res-0')!
    expect(enriched.canonicalSubjectId).toBe('cs-A')
    expect(enriched.why).toBe('Réserve ouverte depuis 62 j')
    expect(enriched.lastKnown).toBe('ouvert')
  })

  it('un VisitControl SANS candidat objet correspondant n’ajoute aucune ligne', () => {
    // controlByCs contient un sujet (échéance/stagnation) sans candidat objet.
    const subjectByRef = new Map<string, string>() // aucun rattachement
    const controlByCs = new Map([['cs-DEADLINE', facts('2 échéances en retard')]])
    const plan = buildNextVisitPlan(CANDIDATES, subjectByRef, controlByCs)
    expect(plan).toHaveLength(3)
    expect(plan.some((p) => p.why === '2 échéances en retard')).toBe(false)
  })

  it('5. aucun fuzzy : enrichissement seulement si subjectByRef porte la clé exacte ET controlByCs le cs', () => {
    // subjectByRef rattache res-1 → cs-B, mais controlByCs ne connaît PAS cs-B.
    const subjectByRef = new Map([[watchlistSourceKey('reserve_open', 'res-1'), 'cs-B']])
    const plan = buildNextVisitPlan(CANDIDATES, subjectByRef, new Map())
    const r1 = plan.find((p) => p.sourceRef === 'res-1')!
    // rattachement connu → id = cs, mais pas de faits → pas d'enrichissement narratif
    expect(r1.id).toBe('cs-B')
    expect(r1.why).toBeUndefined()
  })
})
