// P1-4C2E2 — CONTRAT : la vérité CBO autoritative C2A (computedCurrentState / stateBasis / conflicts /
// documentaryDivergences) atteint le contexte réellement envoyé au modèle, et l'instruction
// « état autoritatif, ne pas recalculer » est présente. Le LLM explique, il ne reprojette pas.

import { describe, it, expect } from 'vitest'
import { buildSubjectDetailForCopilot } from '@/lib/visits/copilot-subject-context'
import { prepareFreeAnswerRequest, SYSTEM_PROMPT } from '@/lib/visits/copilot-free-answer'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

function makeLife(over: Partial<CanonicalSubjectLife> = {}): CanonicalSubjectLife {
  return {
    canonicalSubjectId: 'cs-1', siteId: 'site-rus', label: 'Calfeutrement local ECS',
    aliases: [], csStatus: 'active', mergedInto: null, mergedIntoLabel: null, mergesAsWinner: [],
    firstSeenAt: '2025-01-29', lastSeenAt: '2025-07-10', currentStatus: 'done',
    displayState: 'resolved', provenOpen: false, primaryFamily: 'action', threadIds: ['t1'],
    pvCount: 3, fieldVisitCount: 0, runs: [], occurrences: [], links: [], materializedEvents: [],
    terrainObjects: [{ entityType: 'site_action', entityId: 'a1', title: 'Reprendre le calfeutrement', description: null, status: 'open', createdAt: '2026-09-03', fromImport: true } as never],
    lastMeaningfulChangeAt: '2025-07-10', stagnationDays: 0, consecutiveMentionsWithoutChange: 0, isStagnant: false,
    ...over,
  }
}

const cbo = (state: CboComputedCurrentState, over: Partial<CboReducedEntry['reduced']> = {}): CboReducedEntry => ({
  cboId: 'cbo-1', canonicalSubjectId: 'cs-1', label: 'Reprendre le calfeutrement',
  nature: { nature: 'one_shot', stateChar: 'terminal_candidate' },
  reduced: { computedCurrentState: state, historicalTrajectory: [], stateBasis: [`x@2025-07-10`], conflicts: [], documentaryDivergences: [], ...over },
  documentaryHighCount: 1, suppressedByNature: 0, docOpenCount: 1, membersSharedWithCompletionDoc: 0,
  targetActionId: null,
})

describe('P1-4C2E2 — businessObjects (C2A) dans le contexte sujet', () => {
  it('buildSubjectDetailForCopilot propage computedCurrentState/stateBasis tels quels', () => {
    const ctx = buildSubjectDetailForCopilot(makeLife(), [cbo('documentary_completed', { stateBasis: ['doc_completion@2025-07-10'] })])
    expect(ctx.businessObjects).toHaveLength(1)
    expect(ctx.businessObjects[0]).toMatchObject({
      label: 'Reprendre le calfeutrement', computedCurrentState: 'documentary_completed', stateBasis: ['doc_completion@2025-07-10'],
    })
    // L'état du SUJET reste distinct (P0-2), non recalculé depuis les CBO.
    expect(ctx.etatCourant).toBe('resolved')
  })

  it('propage chaque état C2A verbatim (témoins + synthétiques)', () => {
    const states: CboComputedCurrentState[] = ['documentary_completed', 'documentary_reopened', 'native_completed', 'native_cancelled', 'conflict', 'unknown', 'open']
    for (const s of states) {
      const ctx = buildSubjectDetailForCopilot(makeLife(), [cbo(s)])
      expect(ctx.businessObjects[0].computedCurrentState).toBe(s)
    }
  })

  it('conflict + divergence remontent (jamais aplatis en DONE)', () => {
    const ctx = buildSubjectDetailForCopilot(makeLife(), [
      cbo('conflict', { conflicts: ['événements natifs contradictoires à 2025-07-10'] }),
      cbo('native_completed', { documentaryDivergences: ['PV 2025-08-27 suggère une réouverture (natif=completed, non renversé)'] }),
    ])
    expect(ctx.businessObjects[0].conflicts).toHaveLength(1)
    expect(ctx.businessObjects[1].documentaryDivergences).toHaveLength(1)
    expect(ctx.businessObjects.map((b) => b.computedCurrentState)).not.toContain('documentary_completed') // conflict/native_completed ≠ documentary_completed
  })

  it('aucun CBO → businessObjects vide (jamais d\'état inventé)', () => {
    expect(buildSubjectDetailForCopilot(makeLife()).businessObjects).toEqual([])
  })
})

describe('P1-4C2E2 — le contexte RÉELLEMENT envoyé au modèle porte la vérité CBO', () => {
  const detail = buildSubjectDetailForCopilot(makeLife(), [cbo('documentary_completed', {
    stateBasis: ['doc_completion@2025-07-10'], conflicts: [], documentaryDivergences: [],
  })])
  const req = prepareFreeAnswerRequest('Que reste-t-il à faire ?', [], [], [detail], null, [], 'RUS')
  const ctx = JSON.parse(req.contextJson)

  it('sujets_detail[].businessObjects[].computedCurrentState atteint le contexte', () => {
    const bo = ctx.sujets_detail[0].businessObjects[0]
    expect(bo.computedCurrentState).toBe('documentary_completed')
    expect(bo.stateBasis).toEqual(['doc_completion@2025-07-10'])
    expect(bo).toHaveProperty('conflicts')
    expect(bo).toHaveProperty('documentaryDivergences')
  })

  it('aucun état CBO concurrent : terrainObjects ne porte PAS de computedCurrentState (seulement status brut)', () => {
    const to = ctx.sujets_detail[0].terrainObjects[0]
    expect(to).toHaveProperty('status')
    expect(to).not.toHaveProperty('computedCurrentState')
  })
})

describe('P1-4C2E2 — instruction prompt « état autoritatif, ne pas recalculer »', () => {
  it('SYSTEM_PROMPT désigne computedCurrentState comme AUTORITATIF et interdit de le recalculer', () => {
    expect(SYSTEM_PROMPT).toContain('computedCurrentState')
    expect(SYSTEM_PROMPT).toContain('AUTORITATIF')
    expect(SYSTEM_PROMPT).toMatch(/ne le recalcule/i)
  })
  it('distingue explicitement l\'état SUJET (etatCourant) de l\'état OBJET (computedCurrentState)', () => {
    expect(SYSTEM_PROMPT).toContain('businessObjects')
    expect(SYSTEM_PROMPT).toMatch(/documentary_completed/)
    expect(SYSTEM_PROMPT).toMatch(/native_cancelled = annul/i)
  })
  it('terrainObjects.status est déclaré BRUT, pas l\'état courant', () => {
    expect(SYSTEM_PROMPT).toMatch(/status.*BRUT|BRUT.*preuve/i)
  })
})
