// MEMORIA-HOME-V2 — tests du delta canonique du hero (chantier actif uniquement).
//
// Couvre :
//   - Delta : mapping figé occurrence → 4 métriques hero (mandat home-hero-delta.ts)
//   - Hero : 0 PV → null ; 1 PV → date affichable mais pas de comparaison ; 2+ PV → delta réel
//   - Performance : jamais plus d'UN appel buildOccurrencePvSummary par résolution (pas de boucle)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const canonicalRunsForSite = vi.fn()
const runEffectiveDate = vi.fn((run: { effectiveDate: string }) => run.effectiveDate)
const buildOccurrencePvSummary = vi.fn()

vi.mock('@/lib/documents/pv-history', () => ({
  canonicalRunsForSite: (...args: unknown[]) => canonicalRunsForSite(...args),
  runEffectiveDate: (run: { effectiveDate: string }) => runEffectiveDate(run),
}))
vi.mock('@/lib/documents/occurrence-pv-summary', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documents/occurrence-pv-summary')>(
    '@/lib/documents/occurrence-pv-summary',
  )
  return {
    ...actual,
    buildOccurrencePvSummary: (...args: unknown[]) => buildOccurrencePvSummary(...args),
  }
})

import {
  getHomeHeroDelta,
  mapOccurrenceSummaryToHeroMetrics,
} from '@/lib/documents/home-hero-delta'
import { emptyOccurrencePvSummary, type OccurrencePvSummary, type PvSubjectRef } from '@/lib/documents/occurrence-pv-summary'

function ref(id: string): PvSubjectRef {
  return { canonicalSubjectId: id, label: id }
}

function summary(overrides: Partial<OccurrencePvSummary>): OccurrencePvSummary {
  return { ...emptyOccurrencePvSummary(), ...overrides }
}

beforeEach(() => {
  canonicalRunsForSite.mockReset()
  runEffectiveDate.mockReset().mockImplementation((run: { effectiveDate: string }) => run.effectiveDate)
  buildOccurrencePvSummary.mockReset()
})

describe('mapOccurrenceSummaryToHeroMetrics — mapping figé, documenté', () => {
  it('nouveaux = nouveau uniquement', () => {
    const s = summary({ nouveau: [ref('a')], réapparu: [ref('b')] })
    expect(mapOccurrenceSummaryToHeroMetrics(s).nouveaux).toEqual([ref('a')])
  })

  it('évolutions = réouvert + aggravé + progressé + réapparu + changé + annulé', () => {
    const s = summary({
      réouvert: [ref('r')],
      aggravé: [ref('ag')],
      progressé: [ref('pr')],
      réapparu: [ref('re')],
      changé: [ref('ch')],
      annulé: [ref('an')],
      nouveau: [ref('n')],
      résolu: [ref('rs')],
    })
    expect(mapOccurrenceSummaryToHeroMetrics(s).evolutions).toEqual([
      ref('r'), ref('ag'), ref('pr'), ref('re'), ref('ch'), ref('an'),
    ])
  })

  it('résolus = résolu uniquement', () => {
    const s = summary({ résolu: [ref('x')], maintenu: [ref('m')] })
    expect(mapOccurrenceSummaryToHeroMetrics(s).resolus).toEqual([ref('x')])
  })

  it('non mentionnés = nonMentionné uniquement', () => {
    const s = summary({ nonMentionné: [ref('nm')] })
    expect(mapOccurrenceSummaryToHeroMetrics(s).nonMentionnes).toEqual([ref('nm')])
  })

  it('maintenu est exclu des 4 compteurs', () => {
    const s = summary({ maintenu: [ref('stable-1'), ref('stable-2')] })
    const m = mapOccurrenceSummaryToHeroMetrics(s)
    const all = [...m.nouveaux, ...m.evolutions, ...m.resolus, ...m.nonMentionnes]
    expect(all).toHaveLength(0)
  })
})

describe('getHomeHeroDelta — 0/1/2+ PV, jamais de boucle multi-chantier', () => {
  it('0 PV matérialisé → null', async () => {
    canonicalRunsForSite.mockResolvedValue([])
    const result = await getHomeHeroDelta('site-1')
    expect(result).toBeNull()
    expect(buildOccurrencePvSummary).not.toHaveBeenCalled()
  })

  it('1 seul PV → date affichable, mais fromRunId/metrics restent null (pas de comparaison inventée)', async () => {
    canonicalRunsForSite.mockResolvedValue([{ id: 'run-1', effectiveDate: '2026-09-01' }])
    const result = await getHomeHeroDelta('site-1')
    expect(result).toEqual({
      toRunId: 'run-1',
      toEffectiveDate: '2026-09-01',
      fromRunId: null,
      metrics: null,
      metricsFailed: false,
    })
    expect(buildOccurrencePvSummary).not.toHaveBeenCalled()
  })

  it('2+ PV → compare EXACTEMENT les deux derniers, un seul appel', async () => {
    canonicalRunsForSite.mockResolvedValue([
      { id: 'run-1', effectiveDate: '2026-07-01' },
      { id: 'run-2', effectiveDate: '2026-08-01' },
      { id: 'run-3', effectiveDate: '2026-09-01' },
    ])
    buildOccurrencePvSummary.mockResolvedValue(summary({ nouveau: [ref('a')], résolu: [ref('b')] }))

    const result = await getHomeHeroDelta('site-1')

    expect(buildOccurrencePvSummary).toHaveBeenCalledTimes(1)
    expect(buildOccurrencePvSummary).toHaveBeenCalledWith('site-1', 'run-2', 'run-3')
    expect(result?.toRunId).toBe('run-3')
    expect(result?.fromRunId).toBe('run-2')
    expect(result?.metrics?.nouveaux).toEqual([ref('a')])
    expect(result?.metrics?.resolus).toEqual([ref('b')])
    expect(result?.metricsFailed).toBe(false)
  })

  it('échec du delta (buildOccurrencePvSummary rejette) → metricsFailed=true, metrics null, jamais un résumé vide fabriqué', async () => {
    canonicalRunsForSite.mockResolvedValue([
      { id: 'run-1', effectiveDate: '2026-08-01' },
      { id: 'run-2', effectiveDate: '2026-09-01' },
    ])
    buildOccurrencePvSummary.mockRejectedValue(new Error('boom'))

    const result = await getHomeHeroDelta('site-1')

    expect(result).toEqual({
      toRunId: 'run-2',
      toEffectiveDate: '2026-09-01',
      fromRunId: 'run-1',
      metrics: null,
      metricsFailed: true,
    })
  })
})
