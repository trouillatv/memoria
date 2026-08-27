import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/documents/historical-visit-extractor'

// P3-B2-workflow — le contrat d'extraction doit énoncer l'atomicité (1 proposition = 1 sujet durable),
// avec le contre-test anti-sur-split et les cas de non-split obligatoires. On protège le CONTENU du
// contrat ici ; la séparation réelle est prouvée par la recette LLM sur Bella 2025.

const PROMPT = buildExtractionPrompt('[[page 1]] texte', 1)

describe('contrat d’atomicité — invariant', () => {
  it('énonce « une proposition = un sujet métier durable »', () => {
    expect(PROMPT).toMatch(/une proposition = un sujet métier durable/i)
    expect(PROMPT).toMatch(/UNE SEULE identité métier durable/i)
  })
  it('précise que ce n’est PAS 1 équipement / 1 nom / 1 élément de liste', () => {
    expect(PROMPT).toMatch(/un équipement/i)
    expect(PROMPT).toMatch(/nom »/i)
    expect(PROMPT).toMatch(/élément d'une liste/i)
  })
})

describe('contrat d’atomicité — éclatement (MUST_SPLIT)', () => {
  it('éclate un même état sur N sujets à évolution indépendante', () => {
    expect(PROMPT).toMatch(/PLUSIEURS sujets qui pourront ensuite/i)
    expect(PROMPT).toMatch(/INDÉPENDAMMENT/)
    expect(PROMPT).toMatch(/produis PLUSIEURS propositions/i)
  })
  it('donne l’exemple témoin électrique / éclairage / cuisson → 3 propositions', () => {
    expect(PROMPT).toMatch(/Contrôle des installations électriques/i)
    expect(PROMPT).toMatch(/Contrôle de l'éclairage de sécurité/i)
    expect(PROMPT).toMatch(/Contrôle des appareils de cuisson/i)
  })
  it('impose preuve/page/extrait PARTAGÉS, jamais inventés', () => {
    expect(PROMPT).toMatch(/evidenceKeys identiques/i)
    expect(PROMPT).toMatch(/Ne jamais inventer une preuve/i)
  })
})

describe('contrat d’atomicité — garde anti-sur-split', () => {
  it('pose le double contre-test (états futurs indépendants + ré-identifiabilité)', () => {
    expect(PROMPT).toMatch(/ÉTATS FUTURS INDÉPENDANTS/i)
    expect(PROMPT).toMatch(/RETROUVER chacun de ces sujets INDIVIDUELLEMENT dans un prochain CR/i)
  })
  it('doute → une seule proposition (pas de micro-sujets artificiels)', () => {
    expect(PROMPT).toMatch(/UNE SEULE proposition/i)
    expect(PROMPT).toMatch(/en cas de DOUTE/i)
    expect(PROMPT).toMatch(/micro-sujets artificiels/i)
  })
  it('interdit tout éclatement lexical (et / + / , / liste)', () => {
    expect(PROMPT).toMatch(/Ne JAMAIS éclater par simple présence de « et »/i)
  })
  it('liste les non-split obligatoires (conduits, tableau+câblage, portes CF, SSI, coordination)', () => {
    expect(PROMPT).toMatch(/conduits d'extraction d'air vicié/i)
    expect(PROMPT).toMatch(/tableau \+ câblage/i)
    expect(PROMPT).toMatch(/portes CF/i)
    expect(PROMPT).toMatch(/SSI avec CMSI/i)
    expect(PROMPT).toMatch(/coordination entre LOT01 et LOT02/i)
  })
  it('hésitation → conserver la proposition composite (sous-split récupérable)', () => {
    expect(PROMPT).toMatch(/hésitation.*conserve la proposition composite/i)
    expect(PROMPT).toMatch(/sur-découpage fragmente la mémoire/i)
  })
})
