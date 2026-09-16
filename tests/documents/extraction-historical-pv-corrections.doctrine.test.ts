import { describe, it, expect } from 'vitest'
import { buildExtractionPrompt } from '@/lib/documents/historical-visit-extractor'

// Correctif ciblé (audit Dumbéa Mall 10/12 vs 13/12, 2026-09-16) — quatre défauts
// génériques constatés sur une extraction historique et corrigés dans la doctrine
// du prompt : (1) briefing/rappel de contenu déjà couvert classé à tort en action
// future, (2) recommandation hédée sur une action unique classée à tort en decision,
// (3) absence de capture des évolutions positives (mémoire mécaniquement pessimiste),
// (4) statusAtDocumentDate='ouvert' inféré par défaut sans preuve textuelle explicite,
// (5) présence sous rubrique "Présents" non reconnue selon la syntaxe suivant le nom.
// On protège le CONTENU du contrat ici ; le comportement réel se prouve par la
// recette LLM corpus, jamais par un compteur d'objets ni par un nom propre témoin.

const PROMPT = buildExtractionPrompt('[[page 1]] texte', 1)

describe('2b — briefing/rappel de contenu déjà couvert pendant la visite ≠ action future', () => {
  it('un item Briefing/Rappel/Présentation/Test/Démonstration couvert pendant la visite n’est pas une action', () => {
    expect(PROMPT).toMatch(/« Briefing sur X »/i)
    expect(PROMPT).toMatch(/décrit un contenu COUVERT PENDANT la visite/i)
    expect(PROMPT).toMatch(/n'est PAS une action future/i)
  })
  it('une obligation restante, un responsable, une échéance ou une tournure prospective reste une action', () => {
    expect(PROMPT).toMatch(/une obligation restante, un responsable, une échéance, ou une tournure prospective claire/i)
    expect(PROMPT).toMatch(/à refaire.*à programmer.*prévoir un prochain/i)
  })
  it('doute sur le moment (pendant vs après la visite) → rester conservateur, ne pas créer d’action', () => {
    expect(PROMPT).toMatch(/doute sur le moment \(pendant vs après la visite\), rester conservateur/i)
  })
})

describe('2c — symétrie constat positif/négatif : les évolutions positives sont capturées', () => {
  it('une amélioration/correction/test réussi est un ÉTAT constaté au même titre qu’une défaillance', () => {
    expect(PROMPT).toMatch(/Symétrie constat positif\/négatif/i)
    expect(PROMPT).toMatch(/est un ÉTAT constaté au même titre qu'une défaillance/i)
    expect(PROMPT).toMatch(/Ne jamais omettre un constat au seul motif qu'il est positif ou rassurant/i)
  })
  it('réutilise observation ou knowledge_fact — pas de nouvelle famille', () => {
    expect(PROMPT).toMatch(/produire une proposition \*\*observation\*\* \(ou \*\*knowledge_fact\*\*, thematic_category='test_control'/i)
  })
  it('une amélioration ne résout jamais automatiquement les défaillances résiduelles du même sujet', () => {
    expect(PROMPT).toMatch(/ne doit jamais, à elle seule, faire passer un autre problème du même sujet à statusAtDocumentDate='réalisé'/i)
    expect(PROMPT).toMatch(/coexiste avec les défaillances résiduelles encore actives sur le même sujet, elle ne les résout pas automatiquement/i)
  })
})

describe('3c — doute hédé sur une action unique reste une action, jamais une décision', () => {
  it('un choix explicite entre plusieurs options ou un arbitrage réellement acté reste une decision', () => {
    expect(PROMPT).toMatch(/présente explicitement PLUSIEURS options entre lesquelles un arbitrage reste à faire/i)
    expect(PROMPT).toMatch(/un choix\/décision effectivement acté lors de la visite/i)
  })
  it('« semble nécessaire »/« pourrait être utile »/« il faudrait » sur une action unique restent une action hédée', () => {
    expect(PROMPT).toMatch(/semble nécessaire.*pourrait être utile.*il faudrait.*serait souhaitable.*à envisager/i)
    expect(PROMPT).toMatch(/n'est PAS un choix entre options ni une décision actée/i)
    expect(PROMPT).toMatch(/ne pas basculer en decision au seul motif que la formulation est hédée/i)
  })
})

describe('Statut d’exécution — "ouvert" n’est jamais une valeur par défaut', () => {
  it('famille action : "ouvert" exige une qualification explicite, pas l’absence de résolution', () => {
    expect(PROMPT).toMatch(/jamais par défaut[\s\S]*Le simple fait qu'une action soit nouvellement listée/i)
    expect(PROMPT).toMatch(/"ouvert" n'est jamais une valeur par défaut appliquée à toute action non résolue/i)
    expect(PROMPT).toMatch(/un statut absent est le résultat normal et attendu pour une action simplement listée sans indication d'état/i)
  })
  it('famille decision : "ouvert" exige une qualification explicite de l’exécution', () => {
    expect(PROMPT).toMatch(/"ouvert" n'est jamais une valeur par défaut appliquée à toute décision non soldée/i)
    expect(PROMPT).toMatch(/En l'absence de toute mention explicite de l'état d'exécution, laisser sourcePayload\.statusAtDocumentDate absent/i)
  })
})

describe('Présence — rubrique "Présents" appliquée uniformément quelle que soit la syntaxe après le nom', () => {
  it('un item sous "Présents" reste présent avec un tiret+société ou un deux-points+qualification', () => {
    expect(PROMPT).toMatch(/application uniforme, quelle que soit la syntaxe qui suit le nom/i)
    expect(PROMPT).toMatch(/un tiret suivi d'une société/i)
    expect(PROMPT).toMatch(/un deux-points suivi d'une qualification, d'un diplôme ou d'une fonction/i)
  })
  it('ne retire jamais la preuve de présence apportée par le fait d’être listé sous la rubrique', () => {
    expect(PROMPT).toMatch(/ne retire JAMAIS la preuve de présence apportée par le fait d'être listé sous cette rubrique/i)
  })
  it('une personne seulement évoquée ailleurs (hors item de la rubrique) reste "inconnu"', () => {
    expect(PROMPT).toMatch(/une personne seulement ÉVOQUÉE ailleurs dans le texte[\s\S]*sans figurer comme item de la rubrique « Présents » reste "inconnu"/i)
  })
})
