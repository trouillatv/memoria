import { describe, expect, it } from 'vitest'
import type { FoundingOutcomeV2, FoundingUnit } from './tracked-point-founding'
import { buildFingerprint, buildInputSnapshot, canonicalStringify, computeInputFingerprint } from './tracked-point-fingerprint'

function unit(overrides: Partial<FoundingUnit> & { outcomeV2: FoundingOutcomeV2 }): FoundingUnit {
  return {
    threadId: overrides.threadId ?? 'thread-1',
    scope: overrides.scope ?? 'thread',
    proposalSetOf: overrides.proposalSetOf,
    props: overrides.props ?? [],
    families: overrides.families ?? [],
    threadLabel: overrides.threadLabel ?? 'Sujet 1',
    outcomeOld: overrides.outcomeOld ?? 'UNCOVERED_FAMILY_COMBINATION',
    outcomeV2: overrides.outcomeV2,
    trackability: overrides.trackability,
  }
}

describe('canonicalStringify', () => {
  it('trie les clés d\'objet indépendamment de l\'ordre d\'insertion', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }))
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('null et undefined convergent tous deux vers "null"', () => {
    expect(canonicalStringify(null)).toBe('null')
    expect(canonicalStringify(undefined)).toBe('null')
    expect(canonicalStringify({ a: undefined })).toBe(canonicalStringify({ a: null }))
  })

  it('préserve l\'ordre des arrays fourni (pas de tri implicite)', () => {
    expect(canonicalStringify(['b', 'a'])).toBe('["b","a"]')
  })
})

describe('buildInputSnapshot', () => {
  it('normalise proposalSetOf et trackability absents en null explicite', () => {
    const u = unit({ outcomeV2: { kind: 'NO_POINT_EMPTY_THREAD' } })
    const snapshot = buildInputSnapshot(u)
    expect(snapshot.proposalSetOf).toBeNull()
    expect(snapshot.trackability).toBeNull()
  })

  it('trie families quel que soit l\'ordre du unit', () => {
    const u = unit({ families: ['reservation', 'decision'], outcomeV2: { kind: 'NO_POINT_EMPTY_THREAD' } })
    expect(buildInputSnapshot(u).families).toEqual(['decision', 'reservation'])
  })

  it('cboIds = [cboId] uniquement pour un outcome CONFIRMED', () => {
    const confirmed = unit({ outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } })
    expect(buildInputSnapshot(confirmed).cboIds).toEqual(['cbo-1'])

    const provisional = unit({ outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    expect(buildInputSnapshot(provisional).cboIds).toEqual([])
  })
})

describe('computeInputFingerprint / buildFingerprint', () => {
  it('est déterministe pour la même unité', () => {
    const u = unit({ threadId: 't1', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } })
    const a = buildFingerprint(u)
    const b = buildFingerprint(u)
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('produit le même fingerprint peu importe l\'ordre de construction de families', () => {
    const u1 = unit({ threadId: 't1', families: ['decision', 'reservation'], outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    const u2 = unit({ threadId: 't1', families: ['reservation', 'decision'], outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
    expect(computeInputFingerprint(buildInputSnapshot(u1))).toBe(computeInputFingerprint(buildInputSnapshot(u2)))
  })

  it('change si threadId change', () => {
    const a = buildFingerprint(unit({ threadId: 't1', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } }))
    const b = buildFingerprint(unit({ threadId: 't2', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-1' } }))
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('change si outcomeV2 change (même threadId/scope)', () => {
    const a = buildFingerprint(unit({ threadId: 't1', outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'decision' } }))
    const b = buildFingerprint(unit({ threadId: 't1', outcomeV2: { kind: 'PROVISIONAL', triggerFamily: 'reservation' } }))
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('produit un hex sha256 (64 caractères)', () => {
    const { fingerprint } = buildFingerprint(unit({ outcomeV2: { kind: 'NO_POINT_EMPTY_THREAD' } }))
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})
