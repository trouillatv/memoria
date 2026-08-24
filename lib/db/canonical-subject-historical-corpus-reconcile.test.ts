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

import { readFileSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  reconcileHistoricalCorpusForSite,
  getMaterializedRunIdsForSite,
} from './canonical-subject-historical-corpus-reconcile'

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

// P0-J.3 — sourcing des runIds pour le branchement production (GO Vincent 2026-08-24).

function fakeSiteReportsClient(rows: Array<{ extraction_run_id: string | null }>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => Promise.resolve({ data: rows }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('getMaterializedRunIdsForSite — P0-J.3 sentinelles 4 et 5', () => {
  it('sentinelle 5 : un run matérialisé (site_reports) est pris en compte, aucun filtre is_canonical', async () => {
    const sb = fakeSiteReportsClient([{ extraction_run_id: 'run-non-canonical' }])
    const runIds = await getMaterializedRunIdsForSite(sb, 'site-x')
    expect(runIds).toEqual(['run-non-canonical'])
  })

  it('sentinelle 4 : un run non matérialisé (absent de site_reports) est structurellement absent du résultat', async () => {
    // La requête interroge site_reports, jamais document_extraction_run : un run
    // canonique fantôme sans site_report n'apparaît jamais dans les lignes reçues.
    const sb = fakeSiteReportsClient([])
    const runIds = await getMaterializedRunIdsForSite(sb, 'site-x')
    expect(runIds).toEqual([])
  })

  it('déduplique plusieurs site_reports pointant vers le même run', async () => {
    const sb = fakeSiteReportsClient([
      { extraction_run_id: 'run-A' },
      { extraction_run_id: 'run-A' },
      { extraction_run_id: 'run-B' },
    ])
    const runIds = await getMaterializedRunIdsForSite(sb, 'site-x')
    expect(runIds.sort()).toEqual(['run-A', 'run-B'])
  })
})

describe('P0-J.3 — doctrine des points d’entrée production (régression source)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('le chemin import (review-actions.ts) reconverge tout le corpus du chantier, pas seulement le run créé', () => {
    const src = read('app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts')
    expect(src).toMatch(/getMaterializedRunIdsForSite\(sb, siteId\)/)
    expect(src).toMatch(/reconcileHistoricalCorpusForSite\(\{ siteId, runIds: siteRunIds \}\)/)
    // Non-convergence après maxPasses = échec observable, jamais silencieux.
    expect(src).toMatch(/if \(!corpusResult\.reachedFixedPoint\)/)
  })

  it('le sweep (recovery) rejoue par le même sourcing de runIds, pas une variante appauvrie', () => {
    const sweep = read('lib/db/reconciliation-sweep.ts')
    expect(sweep).toMatch(/getMaterializedRunIdsForSite\(sb, item\.siteId\)/)
    expect(sweep).toMatch(/reconcileHistoricalCorpusForSite\(/)
  })

  it('sentinelle 4/5 : aucun des deux points d’entrée ne filtre sur is_canonical', () => {
    const helper = read('lib/db/canonical-subject-historical-corpus-reconcile.ts')
    // getMaterializedRunIdsForSite interroge exactement site_reports.extraction_run_id
    // (jamais document_extraction_run/is_canonical) : on isole son corps précis pour
    // éviter que la prose de doctrine (qui nomme ces deux termes pour expliquer
    // pourquoi ils sont écartés) ne fausse l'assertion.
    const body = helper.slice(
      helper.indexOf('export async function getMaterializedRunIdsForSite'),
      helper.indexOf('export async function reconcileHistoricalCorpusForSite'),
    )
    expect(body).not.toMatch(/is_canonical/)
    expect(body).not.toMatch(/document_extraction_run/)
    expect(body).toMatch(/\.from\('site_reports'\)/)
    expect(body).toMatch(/\.select\('extraction_run_id'\)/)
  })

  it('sentinelle 7 : ce lot ne touche aucun code de thème', () => {
    const files = [
      'lib/db/canonical-subject-historical-corpus-reconcile.ts',
      'app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts',
      'lib/db/reconciliation-sweep.ts',
    ]
    for (const f of files) {
      expect(read(f).toLowerCase()).not.toMatch(/theme|thème/)
    }
  })
})
