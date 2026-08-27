import { describe, it, expect } from 'vitest'
import { BASE_SYSTEM_PROMPT, type SimilarityResult } from '@/lib/subjects/similarity-analyze'

// P-UI-R2 / R2e — le juge doit, quand verdict='related', distinguer « même SUJET canonique (une
// seule ligne de vie) » (same_object_hypothesis=true) de « même objet/lieu mais préoccupations
// distinctes » (false). Le concept n'est PAS « même objet physique » : co-localisation ≠ identité.
// Le contenu du prompt est protégé ici ; la séparation réelle est prouvée par la re-sonde LLM.

describe('BASE_SYSTEM_PROMPT — contrat same_object_hypothesis (R2e : identité/ligne de vie)', () => {
  it('déclare le champ dans le JSON de sortie', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/"same_object_hypothesis":\s*true\s*\|\s*false/)
  })
  it('précise qu’il est pertinent uniquement pour verdict=related', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/PERTINENT UNIQUEMENT quand verdict = "related"/i)
  })
  it('pose la question d’IDENTITÉ / d’UNE SEULE ligne de vie (pas « même objet/lieu »)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/M[ÊE]ME IDENTIT[ÉE] m[ée]tier durable/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/UNE SEULE ligne de vie/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/ne demande PAS/i)
  })
  it('liste les conditions INSUFFISANTES à elles seules (même lieu, objet↔anomalie/document/contrôle…)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/Ne suffisent JAMAIS/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/même lieu/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/objet↔anomalie/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/objet↔document/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/objet↔contrôle/i)
  })
  it('distingue « même ligne de vie » de « mêmes états » (évolutions préservées)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/≠ « mêmes états »|≠ .*mêmes états/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/non conforme → corrigé → conforme/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/PR[ÉE]OCCUPATIONS métier distinctes/i)
  })
  it('porte les contre-exemples false obligatoires (Largeur/Mall, Local tech/élec, Registre/Contrôle, SSI, porte CF)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/Largeur de passage réduite.*vs.*Dégagement extérieur du Mall/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/Local technique.*vs.*Local électrique/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/Registre .*vs .*Contr[ôo]le/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/SSI/)
    expect(BASE_SYSTEM_PROMPT).toMatch(/porte CF/i)
  })
  it('garde le témoin true (food court ↔ Mall) sous condition de contexte', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/Issue de secours du food court/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/quand le contexte établit/i)
  })
  it('prudence observation isolée = signal, PAS règle absolue', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/observation isolée/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/PAS règle absolue|ne l'exclus donc pas/i)
  })
  it('favorise le faux négatif (doute → false)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/doute.*false/i)
  })
})

describe('SimilarityResult — champ typé', () => {
  it('same_object_hypothesis est un booléen du contrat', () => {
    const r: Pick<SimilarityResult, 'same_object_hypothesis'> = { same_object_hypothesis: false }
    expect(typeof r.same_object_hypothesis).toBe('boolean')
  })
})
