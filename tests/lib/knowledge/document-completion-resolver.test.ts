// Test UNITAIRE — P1-4B2a. Logique déterministe de décision + idempotence de l'orchestrateur.
//
// deriveCompletionDecision est pure (aucune DB). L'orchestrateur est testé avec un client admin
// mocké en mémoire + les primitives de persistance mockées : on prouve que si une résolution
// effective existe déjà, AUCUN appel LLM et AUCUNE persistance ne sont déclenchés (skip idempotent),
// et que sinon le resolver est appelé puis persisté. La preuve DB réelle (contraintes, empreinte)
// vit dans tests/lib/db/document-completion-resolution-constraints.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/document-completion-resolution', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return {
    ...actual,
    getEffectiveResolution: vi.fn(),
    persistCompletionResolution: vi.fn(async () => ({ kind: 'created', resolutionId: 'r1', contextFingerprint: 'fp' })),
  }
})

const completeMock = vi.fn()
vi.mock('@/services/ai/factory', () => ({
  getAIProvider: () => ({ name: 'mock', complete: completeMock }),
}))

let PROOFS: Array<Record<string, unknown>> = []
let SUBJECTS: Array<Record<string, unknown>> = []
let CBOS: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        in: () => api,
        then: (resolve: (v: { data: unknown }) => unknown) => {
          const data =
            table === 'canonical_subject_occurrence' ? PROOFS
            : table === 'canonical_subject' ? SUBJECTS
            : table === 'canonical_business_object' ? CBOS
            : []
          return Promise.resolve({ data }).then(resolve)
        },
      }
      return api
    },
  }),
}))

import { deriveCompletionDecision, resolveSiteDocumentCompletions } from '@/lib/knowledge/document-completion-resolver'
import { getEffectiveResolution, persistCompletionResolution } from '@/lib/db/document-completion-resolution'

const acc = (cboId: string, intentMatch: 'exact' | 'related' | 'different' = 'exact', evidenceDirectness: 'direct' | 'inferred' = 'direct') =>
  ({ cboId, verdict: 'accomplished' as const, intentMatch, evidenceDirectness, reason: '' })
const unc = (cboId: string) => ({ cboId, verdict: 'uncertain' as const, intentMatch: 'related' as const, evidenceDirectness: 'inferred' as const, reason: '' })
const no = (cboId: string) => ({ cboId, verdict: 'not_accomplished' as const, intentMatch: 'different' as const, evidenceDirectness: 'inferred' as const, reason: '' })

describe('deriveCompletionDecision — conservateur (V2.2 : exact + direct)', () => {
  it('exactement 1 accompli + exact + direct, 0 incertain → MATCH/HIGH', () => {
    const d = deriveCompletionDecision([acc('a'), no('b')])
    expect(d).toMatchObject({ decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: 'a' })
  })
  it('1 accompli exact mais INFÉRÉ → MATCH/MEDIUM (jamais HIGH)', () => {
    const d = deriveCompletionDecision([acc('a', 'exact', 'inferred'), no('b')])
    expect(d).toMatchObject({ decision: 'MATCH', confidenceClass: 'MEDIUM', selectedCboId: 'a' })
  })
  it('1 accompli non-exact → MATCH/MEDIUM', () => {
    const d = deriveCompletionDecision([acc('a', 'related'), no('b')])
    expect(d).toMatchObject({ decision: 'MATCH', confidenceClass: 'MEDIUM', selectedCboId: 'a' })
  })
  it('accompli exact+direct mais un candidat incertain présent → AMBIGUOUS (pas HIGH)', () => {
    const d = deriveCompletionDecision([acc('a'), unc('b')])
    expect(d).toMatchObject({ decision: 'AMBIGUOUS', selectedCboId: null })
  })
  it('plusieurs accomplis → AMBIGUOUS', () => {
    const d = deriveCompletionDecision([acc('a'), acc('b')])
    expect(d).toMatchObject({ decision: 'AMBIGUOUS', selectedCboId: null })
  })
  it('aucun accompli → NO_MATCH', () => {
    const d = deriveCompletionDecision([no('a'), no('b')])
    expect(d).toMatchObject({ decision: 'NO_MATCH', selectedCboId: null })
  })
})

describe('resolveSiteDocumentCompletions — idempotence (skip sans LLM)', () => {
  beforeEach(() => {
    completeMock.mockReset()
    vi.mocked(getEffectiveResolution).mockReset()
    vi.mocked(persistCompletionResolution).mockClear()
    PROOFS = [{ id: 'p1', canonical_subject_id: 's1', label: 'Porte CF posée', effective_date: '2026-05-23' }]
    SUBJECTS = [{ id: 's1', label: 'Portes coupe-feu' }]
    CBOS = [{ id: 'cbo1', label: 'Poser la porte CF', canonical_subject_id: 's1' }]
  })

  it('résolution effective existante → skip : aucun appel LLM, aucune persistance', async () => {
    vi.mocked(getEffectiveResolution).mockResolvedValue({ id: 'r0', decision: 'MATCH', confidenceClass: 'HIGH', selectedCboId: 'cbo1', policyVersion: 'p1.4b.v2', contextFingerprint: 'fp', resolvedAt: 'x' })
    const stats = await resolveSiteDocumentCompletions('site1')
    expect(completeMock).not.toHaveBeenCalled()
    expect(persistCompletionResolution).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
    expect(stats.resolverCalls).toBe(0)
  })

  it('aucune résolution effective → resolver appelé puis persistance', async () => {
    vi.mocked(getEffectiveResolution).mockResolvedValue(null)
    completeMock.mockResolvedValue({ text: '', parsed: { verdicts: [{ id: 'cbo1', verdict: 'accomplished', intent_match: 'exact', evidence_directness: 'direct', reason: 'ok' }] }, tokens: { input: 0, output: 0 }, model: 'mock', durationMs: 1 })
    const stats = await resolveSiteDocumentCompletions('site1')
    expect(completeMock).toHaveBeenCalledTimes(1)
    expect(persistCompletionResolution).toHaveBeenCalledTimes(1)
    expect(stats.created).toBe(1)
    expect(stats.resolverCalls).toBe(1)
    expect(stats.distribution['MATCH/HIGH']).toBe(1)
  })

  it('preuve sans candidat CBO → NO_MATCH déterministe sans LLM', async () => {
    CBOS = []
    vi.mocked(getEffectiveResolution).mockResolvedValue(null)
    const stats = await resolveSiteDocumentCompletions('site1')
    expect(completeMock).not.toHaveBeenCalled()
    expect(persistCompletionResolution).toHaveBeenCalledTimes(1)
    expect(stats.distribution['NO_MATCH/—']).toBe(1)
  })
})
