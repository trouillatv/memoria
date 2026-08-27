import { describe, it, expect } from 'vitest'
import {
  isSameSubjectQuestion,
  shouldPersistSemanticSuggestion,
} from '@/lib/subjects/similarity-analyze'

// P-UI-R2b — le raccord ne falsifie pas recommendation. La carte « Même sujet ? » et la
// persistance d'une suggestion sémantique dérivent de (verdict, recommendation, same_object_hypothesis).

describe('isSameSubjectQuestion — quelle carte présenter', () => {
  it('recommendation=merge → question « Même sujet ? »', () => {
    expect(isSameSubjectQuestion({ verdict: 'same_subject', recommendation: 'merge', same_object_hypothesis: false })).toBe(true)
  })
  it('related + same_object_hypothesis=true → question « Même sujet ? » (sans falsifier reco)', () => {
    expect(isSameSubjectQuestion({ verdict: 'related', recommendation: 'link', same_object_hypothesis: true })).toBe(true)
  })
  it('related + same_object_hypothesis=false → PAS une question de fusion', () => {
    expect(isSameSubjectQuestion({ verdict: 'related', recommendation: 'link', same_object_hypothesis: false })).toBe(false)
  })
  it('none / uncertain → pas de question de fusion', () => {
    expect(isSameSubjectQuestion({ verdict: 'uncertain', recommendation: 'none', same_object_hypothesis: false })).toBe(false)
  })
  it('un same_object_hypothesis=true hors related ne force rien (normalisé faux en amont)', () => {
    // Par contrat analyzeSubjectPair ne met true que pour related ; défense en profondeur :
    expect(isSameSubjectQuestion({ verdict: 'distinct', recommendation: 'none', same_object_hypothesis: true })).toBe(false)
  })
})

describe('shouldPersistSemanticSuggestion — gate d’alimentation de la voie sémantique', () => {
  it('same_subject → persister', () => {
    expect(shouldPersistSemanticSuggestion('same_subject', false)).toBe(true)
  })
  it('related + hypothèse même objet → persister', () => {
    expect(shouldPersistSemanticSuggestion('related', true)).toBe(true)
  })
  it('related sans hypothèse (distinct lié) → ne PAS persister', () => {
    expect(shouldPersistSemanticSuggestion('related', false)).toBe(false)
  })
  it('distinct / uncertain → ne PAS persister', () => {
    expect(shouldPersistSemanticSuggestion('distinct', false)).toBe(false)
    expect(shouldPersistSemanticSuggestion('uncertain', false)).toBe(false)
    expect(shouldPersistSemanticSuggestion('uncertain', true)).toBe(false)
  })
})
