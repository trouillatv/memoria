// Tests P0-J.2 — boucle de convergence du rattrapage corpus.
//
// Le moteur sous-jacent (reconcileHistoricalPvCanonicalSubjects, matching/clustering) est déjà
// testé ailleurs et n'est pas modifié par ce lot : ces tests couvrent uniquement la LOGIQUE NEUVE
// (la boucle de passages répétés) via un mock scripté, sans DB ni Gemini réels.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoricalReconcileFamilyStat } from './canonical-subject-historical-reconcile'

const mockReconcile = vi.fn()

vi.mock('@/lib/db/canonical-subject-historical-reconcile', () => ({
  reconcileHistoricalPvCanonicalSubjects: (...args: unknown[]) => mockReconcile(...args),
}))

import { reconcileHistoricalCorpusForSite } from './canonical-subject-historical-corpus-reconcile'

function stat(overrides: Partial<HistoricalReconcileFamilyStat> = {}): HistoricalReconcileFamilyStat {
  return { family: 'action', threads: 1, alreadyIdentified: 0, matchedExisting: 0, created: 0, ambiguous: 0, unresolved: 0, ...overrides }
}

beforeEach(() => {
  mockReconcile.mockReset()
})

describe('reconcileHistoricalCorpusForSite — P0-J.2', () => {
  it('converge en plusieurs passages internes quand le rattachement dépend d\'un run traité plus tard (effet d\'ordre reproduit)', async () => {
    // Simule exactement le phénomène observé sur Guillaume : run-A crée un sujet que run-B
    // ne peut rattacher qu'au passage suivant (backward-matching), puis un 3e passage confirme
    // le point fixe (plus aucune écriture).
    const sequence = [
      stat({ created: 1 }),                                   // pass1 run-A : crée
      stat({ unresolved: 1 }),                                 // pass1 run-B : encore orphelin
      stat({ threads: 0 }),                                    // pass2 run-A : rien à faire
      stat({ matchedExisting: 1 }),                             // pass2 run-B : rattrape le sujet créé au pass1
      stat({ threads: 0 }),                                    // pass3 run-A : rien
      stat({ alreadyIdentified: 1 }),                           // pass3 run-B : déjà identifié, 0 écriture
    ]
    let i = 0
    mockReconcile.mockImplementation(async ({ runId }: { runId: string }) => {
      const s = sequence[i++]
      return {
        runId,
        siteId: 'site-x',
        totalThreads: s.threads,
        byFamily: [s],
        touchedCanonicalSubjectIds: s.created || s.matchedExisting ? [`cs-${i}`] : [],
      }
    })

    const result = await reconcileHistoricalCorpusForSite({ siteId: 'site-x', runIds: ['run-A', 'run-B'] })

    expect(result.passes).toBe(3)
    expect(result.reachedFixedPoint).toBe(true)
    expect(result.totalCreated).toBe(1)
    expect(result.totalMatched).toBe(1)
    expect(mockReconcile).toHaveBeenCalledTimes(6) // 3 passages x 2 runs
    // Ordre d'appel respecte l'ordre de runIds à chaque passage.
    expect(mockReconcile.mock.calls.map((c: any) => c[0].runId)).toEqual([
      'run-A', 'run-B', 'run-A', 'run-B', 'run-A', 'run-B',
    ])
  })

  it('seconde invocation (corpus déjà résolu) = strictement 1 passage, 0 écriture', async () => {
    mockReconcile.mockImplementation(async ({ runId }: { runId: string }) => ({
      runId,
      siteId: 'site-x',
      totalThreads: 1,
      byFamily: [stat({ alreadyIdentified: 1 })],
      touchedCanonicalSubjectIds: [],
    }))

    const result = await reconcileHistoricalCorpusForSite({ siteId: 'site-x', runIds: ['run-A', 'run-B', 'run-C'] })

    expect(result.passes).toBe(1)
    expect(result.reachedFixedPoint).toBe(true)
    expect(result.totalCreated).toBe(0)
    expect(result.totalMatched).toBe(0)
    expect(mockReconcile).toHaveBeenCalledTimes(3) // 1 passage x 3 runs
  })

  it('ne boucle jamais indéfiniment : borne maxPasses respectée même sans convergence', async () => {
    // Cas non observé en pratique (le point fixe est structurellement atteignable), mais la
    // boucle doit rester bornée par construction.
    mockReconcile.mockImplementation(async ({ runId }: { runId: string }) => ({
      runId,
      siteId: 'site-x',
      totalThreads: 1,
      byFamily: [stat({ created: 1 })], // écrit à chaque appel, jamais 0
      touchedCanonicalSubjectIds: ['cs-always'],
    }))

    const result = await reconcileHistoricalCorpusForSite({ siteId: 'site-x', runIds: ['run-A'], maxPasses: 3 })

    expect(result.passes).toBe(3)
    expect(result.reachedFixedPoint).toBe(false)
    expect(result.totalCreated).toBe(3)
    expect(mockReconcile).toHaveBeenCalledTimes(3)
  })

  it('touchedCanonicalSubjectIds est dédupliqué sur l\'ensemble des passages', async () => {
    // pass1 run-A crée cs-shared (écriture) ; pass1 run-B ne le voit pas encore (rien).
    // pass2 run-A n'a plus rien à faire ; pass2 run-B "revoit" cs-shared (déjà identifié entre-
    // temps, 0 écriture nette) → passWrites=0 sur pass2 → point fixe atteint après ce passage.
    mockReconcile.mockImplementationOnce(async ({ runId }: { runId: string }) => ({
      runId, siteId: 'site-x', totalThreads: 1, byFamily: [stat({ created: 1 })], touchedCanonicalSubjectIds: ['cs-shared'],
    }))
    mockReconcile.mockImplementationOnce(async ({ runId }: { runId: string }) => ({
      runId, siteId: 'site-x', totalThreads: 0, byFamily: [stat({ threads: 0 })], touchedCanonicalSubjectIds: [],
    }))
    mockReconcile.mockImplementationOnce(async ({ runId }: { runId: string }) => ({
      runId, siteId: 'site-x', totalThreads: 0, byFamily: [stat({ threads: 0 })], touchedCanonicalSubjectIds: [],
    }))
    mockReconcile.mockImplementationOnce(async ({ runId }: { runId: string }) => ({
      runId, siteId: 'site-x', totalThreads: 1, byFamily: [stat({ alreadyIdentified: 1 })], touchedCanonicalSubjectIds: ['cs-shared'],
    }))

    const result = await reconcileHistoricalCorpusForSite({ siteId: 'site-x', runIds: ['run-A', 'run-B'] })

    expect(result.reachedFixedPoint).toBe(true)
    expect(result.passes).toBe(2)
    expect(result.touchedCanonicalSubjectIds).toEqual(['cs-shared'])
  })
})
