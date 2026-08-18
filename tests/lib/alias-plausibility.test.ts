// @vitest-environment node
/**
 * Q5 — plausibilité structurelle d'un `transcription_alias` (Vincent,
 * 2026-08-18). Trois paliers, jamais recombinés : normal / reinforced /
 * refused. Cas requis par le mandat : Bessie/imbécile → BECIB (reinforced),
 * stopwords-only (refused), collision exacte (refused).
 */
import { describe, it, expect } from 'vitest'
import { evaluateTranscriptionAliasPlausibility } from '@/lib/ai/alias-plausibility'

describe('evaluateTranscriptionAliasPlausibility', () => {
  it('recouvrement fort (distance faible) → normal', () => {
    const r = evaluateTranscriptionAliasPlausibility('Vincent Millon', 'Vincent Milon')
    expect(r.level).toBe('normal')
  })

  it('containment (forme courte incluse dans la cible) → normal', () => {
    const r = evaluateTranscriptionAliasPlausibility('Cégélec', 'CEGELEC Nouvelle-Calédonie')
    expect(r.level).toBe('normal')
  })

  it('« Bessie » → « BECIB » : aucun recouvrement clair → reinforced', () => {
    const r = evaluateTranscriptionAliasPlausibility('Bessie', 'BECIB')
    expect(r.level).toBe('reinforced')
    expect(r.reason).toBe('no_structural_overlap')
  })

  it('« imbécile » → « BECIB » : même verdict que Bessie, aucune distinction lexicale tentée', () => {
    const r = evaluateTranscriptionAliasPlausibility('imbécile', 'BECIB')
    expect(r.level).toBe('reinforced')
    expect(r.reason).toBe('no_structural_overlap')
  })

  it('alias composé uniquement de mots-outils → refused', () => {
    const r = evaluateTranscriptionAliasPlausibility('le la les', 'BECIB')
    expect(r.level).toBe('refused')
    expect(r.reason).toBe('stopwords_only')
  })

  it('alias vide → refused', () => {
    const r = evaluateTranscriptionAliasPlausibility('   ', 'BECIB')
    expect(r.level).toBe('refused')
    expect(r.reason).toBe('stopwords_only')
  })

  it('collision exacte avec un autre acteur connu du périmètre → refused, jamais confirmation silencieuse', () => {
    const r = evaluateTranscriptionAliasPlausibility('BECIB', 'Jérôme Martin', ['BECIB', 'Cegelec'])
    expect(r.level).toBe('refused')
    expect(r.reason).toBe('collision')
    expect(r.collidesWith).toBe('BECIB')
  })

  it('la cible elle-même ne compte jamais comme collision (otherKnownLabels exclut déjà la cible)', () => {
    const r = evaluateTranscriptionAliasPlausibility('BECIB', 'BECIB', [])
    expect(r.level).toBe('normal')
  })

  it('périmètre vide (UI sans accès DB) : ne peut jamais détecter de collision', () => {
    const r = evaluateTranscriptionAliasPlausibility('BECIB', 'Jérôme Martin', [])
    expect(r.level).toBe('reinforced')
  })
})
