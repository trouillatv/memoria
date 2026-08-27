import { describe, it, expect } from 'vitest'
import { BASE_SYSTEM_PROMPT, type SimilarityResult } from '@/lib/subjects/similarity-analyze'

// P-UI-R2 — le juge doit, quand verdict='related', distinguer « même objet plausible mais
// confiance insuffisante » (same_object_hypothesis=true) de « objets distincts liés » (false).
// Le contenu du prompt est protégé ici ; la séparation réelle est prouvée par le dry-run LLM.

describe('BASE_SYSTEM_PROMPT — contrat same_object_hypothesis', () => {
  it('déclare le champ dans le JSON de sortie', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/"same_object_hypothesis":\s*true\s*\|\s*false/)
  })
  it('précise qu’il est pertinent uniquement pour verdict=related', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/PERTINENT UNIQUEMENT quand verdict = "related"/i)
  })
  it('pose la bonne question (même OBJET, pas « sont-ils liés »)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/M[ÊE]ME objet m[ée]tier durable/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/NON « sont-ils liés/i)
  })
  it('porte les contre-exemples false (document/registre/rapport/réserve ≠ contrôle/équipement)', () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/Registre .*vs .*Contr[ôo]le/i)
    expect(BASE_SYSTEM_PROMPT).toMatch(/SSI/)
    expect(BASE_SYSTEM_PROMPT).toMatch(/porte CF/i)
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
