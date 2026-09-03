// P0-2B — Contrat : la vérité d'état courant partagée (displayState) ATTEINT le contexte
// que reçoit le LLM du Copilote. Le LLM explique etatCourant, il ne le recalcule pas.
//
// Témoin Système Sprinkler : displayState='reopened' alors qu'une occurrence porte 'done'
// (VGP réalisée). etatCourant doit valoir 'reopened', currentStatus brut reste séparé.

import { describe, it, expect } from 'vitest'
import { buildSubjectDetailForCopilot } from '@/lib/visits/copilot-subject-context'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'

function makeLife(over: Partial<CanonicalSubjectLife> = {}): CanonicalSubjectLife {
  return {
    canonicalSubjectId: 'cs-sprinkler',
    siteId: 'site-rus',
    label: 'Système Sprinkler',
    aliases: [],
    csStatus: 'active',
    mergedInto: null,
    mergedIntoLabel: null,
    mergesAsWinner: [],
    firstSeenAt: '2025-01-29',
    lastSeenAt: '2026-07-22',
    currentStatus: 'done',            // rawStatus historique (preuve : VGP réalisée)
    displayState: 'reopened',         // vérité d'état courant partagée
    provenOpen: true,
    primaryFamily: 'action',
    threadIds: ['t1'],
    pvCount: 8,
    fieldVisitCount: 0,
    runs: [],
    occurrences: [],
    links: [],
    materializedEvents: [],
    terrainObjects: [],
    lastMeaningfulChangeAt: '2026-07-22',
    stagnationDays: 0,
    consecutiveMentionsWithoutChange: 0,
    isStagnant: false,
    ...over,
  }
}

describe('P0-2B — displayState atteint le contexte Copilote', () => {
  it('etatCourant = displayState (reopened), distinct du currentStatus brut (done)', () => {
    const ctx = buildSubjectDetailForCopilot(makeLife())
    expect(ctx.etatCourant).toBe('reopened')
    expect(ctx.provenOpen).toBe(true)
    // Le rawStatus reste exposé séparément — pour décrire une preuve, jamais comme état courant.
    expect(ctx.currentStatus).toBe('done')
  })

  it('propage chaque valeur de displayState telle quelle (aucune réinterprétation)', () => {
    const states: CanonicalDisplayState[] = ['open', 'resolved', 'reopened', 'unknown']
    for (const s of states) {
      const ctx = buildSubjectDetailForCopilot(makeLife({ displayState: s, provenOpen: s !== 'resolved' && s !== 'unknown' }))
      expect(ctx.etatCourant).toBe(s)
    }
  })
})
