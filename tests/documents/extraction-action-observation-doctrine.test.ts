import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/documents/historical-visit-extractor'

// Lot 1 (A–D) — le contrat d'extraction doit énoncer :
//   A. la frontière action/observation décidée sur la NATURE (état vs chose à faire),
//      jamais sur la présence d'un responsable/date ;
//   B. la coexistence constat + action sur un même passage ;
//   C. la consolidation intra-document (un sujet répété = une proposition à preuves multiples) ;
//   D. une synthèse/conclusion ne crée pas un nouvel objet (agrégé) par défaut.
// On protège le CONTENU du contrat ici ; la séparation réelle est prouvée par la recette LLM
// (corpus témoin CAPSE/Dumbéa) — jamais par un compteur d'objets.

const PROMPT = buildExtractionPrompt('[[page 1]] texte', 1)

describe('A — frontière action/observation par NATURE, pas par owner/date', () => {
  it('la famille se décide sur la nature (état vs chose à faire)', () => {
    expect(PROMPT).toMatch(/La FAMILLE se décide sur la NATURE de l'énoncé, JAMAIS sur la présence d'un responsable ou d'une date/i)
    expect(PROMPT).toMatch(/un ÉTAT constaté → \*\*observation\*\*/i)
    expect(PROMPT).toMatch(/une CHOSE À FAIRE explicitement demandée/i)
  })
  it('une action reste une action même sans responsable ni date, quelle que soit la section', () => {
    expect(PROMPT).toMatch(/même sans responsable ni date/i)
    expect(PROMPT).toMatch(/quelle que soit la colonne ou la section/i)
  })
  it('owner/date = enrichissement facultatif, leur absence ne rétrograde jamais', () => {
    expect(PROMPT).toMatch(/sont des ENRICHISSEMENTS facultatifs/i)
    expect(PROMPT).toMatch(/NE transforme JAMAIS une prescription en observation/i)
    expect(PROMPT).toMatch(/Ne jamais inventer un responsable ni une date/i)
  })
  it('observation = état décrit, pas prescription (témoins CTA/extincteur)', () => {
    expect(PROMPT).toMatch(/un ÉTAT constaté, une alerte ou un signal/i)
    expect(PROMPT).toMatch(/ce que le document DÉCRIT, pas ce qu'il demande de faire/i)
    expect(PROMPT).toMatch(/CTA non relié au SSI/i)
  })
})

describe('B — constat + action dans un même passage', () => {
  it('énonce la production de DEUX propositions partageant sujet/page/preuves', () => {
    expect(PROMPT).toMatch(/Constat \+ action dans un même passage/i)
    expect(PROMPT).toMatch(/produis DEUX propositions/i)
    expect(PROMPT).toMatch(/MÊME sujet, la MÊME page \(sourcePage\) et les MÊMES preuves/i)
  })
  it('n’invente jamais l’action à partir d’un simple constat', () => {
    expect(PROMPT).toMatch(/Ne produis l'action que si la prescription est RÉELLEMENT présente/i)
  })
})

describe('C — consolidation intra-document (un sujet répété = une proposition à preuves multiples)', () => {
  it('énonce UNE seule proposition par sujet répété, avec cumul des preuves', () => {
    expect(PROMPT).toMatch(/Consolidation intra-document/i)
    expect(PROMPT).toMatch(/UNE SEULE proposition\*\* par sujet/i)
    expect(PROMPT).toMatch(/cumule les\s+`evidenceKeys` de chaque mention/i)
  })
  it('s’applique à TOUTES les familles, pas seulement aux tableaux', () => {
    expect(PROMPT).toMatch(/S'applique à TOUTES les familles/i)
  })
  it('distingue consolidation (même sujet) et éclatement (sujets indépendants)', () => {
    expect(PROMPT).toMatch(/Distinguer consolidation et éclatement/i)
    expect(PROMPT).toMatch(/regroupe PLUSIEURS mentions d'UN MÊME sujet/i)
  })
  it('reste conservateur : doute → ne pas fusionner (sur-fusion irréversible)', () => {
    expect(PROMPT).toMatch(/Rester CONSERVATEUR/i)
    expect(PROMPT).toMatch(/En cas de DOUTE, \*\*ne pas fusionner\*\*/i)
    expect(PROMPT).toMatch(/fusionner deux vrais sujets distincts est\s+irréversible/i)
  })
})

describe('D — synthèse/conclusion ne crée pas un objet agrégé', () => {
  it('une synthèse reprenant des sujets déjà détectés = preuve/priorité, pas nouvel objet', () => {
    expect(PROMPT).toMatch(/qui REPREND des sujets DÉJÀ détectés/i)
    expect(PROMPT).toMatch(/ne crée AUCUN nouvel objet — et surtout aucun objet COMPOSITE/i)
    expect(PROMPT).toMatch(/sert de \*\*preuve supplémentaire\*\*/i)
  })
})
