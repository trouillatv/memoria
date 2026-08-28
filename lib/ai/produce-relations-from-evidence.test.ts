// Tests V3 — buildEvidencePairs (helper pur, appariement borné/déterministe).

import { describe, it, expect } from 'vitest'
import { buildEvidencePairs, type EvidenceRow } from './produce-relations-from-evidence'

const ev = (id: string, subjectIds: string[]): EvidenceRow => ({ id, evidenceText: `preuve ${id}`, subjectIds, sourceProposalId: null })

describe('buildEvidencePairs', () => {
  it('ignore les preuves à 0 ou 1 sujet', () => {
    expect(buildEvidencePairs([ev('e1', []), ev('e2', ['a'])])).toHaveLength(0)
  })

  it('génère 1 paire pour 2 sujets', () => {
    const p = buildEvidencePairs([ev('e', ['a', 'b'])])
    expect(p).toHaveLength(1)
    expect([p[0].a, p[0].b].sort()).toEqual(['a', 'b'])
    expect(p[0].evidenceText).toBe('preuve e')
  })

  it('génère C(n,2) paires pour 3 sujets', () => {
    expect(buildEvidencePairs([ev('e', ['a', 'b', 'c'])])).toHaveLength(3)
  })

  it('borne : > 4 sujets → aucune paire (sur-appariement)', () => {
    expect(buildEvidencePairs([ev('e', ['a', 'b', 'c', 'd', 'f'])])).toHaveLength(0)
  })

  it('déduplique une même paire vue dans deux preuves', () => {
    const p = buildEvidencePairs([ev('e1', ['a', 'b']), ev('e2', ['b', 'a'])])
    expect(p).toHaveLength(1)
  })

  it('déduplique les sujets répétés dans une preuve', () => {
    const p = buildEvidencePairs([ev('e', ['a', 'a', 'b'])])
    expect(p).toHaveLength(1)
  })
})
