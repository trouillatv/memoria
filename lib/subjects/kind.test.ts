// #228 — doctrine du kind DURABLE : l'éligibilité opérationnelle se décide sur canonical_subject.kind
// (actor | business_subject), jamais sur la famille des occurrences.

import { describe, it, expect } from 'vitest'
import { isOperationalSubject, isActorKind } from './kind'

describe('isOperationalSubject — nature durable', () => {
  it('actor → non opérationnel', () => {
    expect(isOperationalSubject('actor')).toBe(false)
  })
  it('business_subject → opérationnel', () => {
    expect(isOperationalSubject('business_subject')).toBe(true)
  })
  it('null / undefined (legacy) → opérationnel (business-like)', () => {
    expect(isOperationalSubject(null)).toBe(true)
    expect(isOperationalSubject(undefined)).toBe(true)
  })
  it('une FAMILLE d\'occurrence n\'est jamais non opérationnelle par elle-même', () => {
    // knowledge_fact/person/company sont des familles, pas des natures durables :
    // passées ici (par erreur), elles ne valent que « ≠ actor » → opérationnel.
    expect(isOperationalSubject('knowledge_fact')).toBe(true)
    expect(isOperationalSubject('reservation')).toBe(true)
  })
})

describe('isActorKind — nature durable acteur', () => {
  it('actor → true', () => {
    expect(isActorKind('actor')).toBe(true)
  })
  it('business_subject / null → false', () => {
    expect(isActorKind('business_subject')).toBe(false)
    expect(isActorKind(null)).toBe(false)
  })
})
