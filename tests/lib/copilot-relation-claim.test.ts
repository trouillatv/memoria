/**
 * P4-D1 — extraction déterministe RELATION_CLAIM (mandat Vincent, 2026-08-17).
 *
 * extractRelationClaim() est pure : cinq verbes → relation_type, texte source
 * ORIGINAL (casse/accents préservés, sert de preuve verbatim).
 */
import { describe, it, expect } from 'vitest'
import { extractRelationClaim } from '@/lib/visits/copilot-relation-claim'

describe('extractRelationClaim — cinq verbes reconnus', () => {
  it('"Le SSI dépend de la mise sous tension." → requires', () => {
    expect(extractRelationClaim('Le SSI dépend de la mise sous tension.')).toEqual({
      relationType: 'requires',
      sourceText: 'SSI',
      targetText: 'mise sous tension',
    })
  })
  it('"La mise sous tension permet le SSI." → enables', () => {
    expect(extractRelationClaim('La mise sous tension permet le SSI.')).toEqual({
      relationType: 'enables',
      sourceText: 'mise sous tension',
      targetText: 'SSI',
    })
  })
  it('"Le rapport d\'essai valide la mise en service." → validates', () => {
    expect(extractRelationClaim("Le rapport d'essai valide la mise en service.")).toEqual({
      relationType: 'validates',
      sourceText: "rapport d'essai",
      targetText: 'mise en service',
    })
  })
  it('"La fuite cause le retard du terrassement." → causes', () => {
    expect(extractRelationClaim('La fuite cause le retard du terrassement.')).toEqual({
      relationType: 'causes',
      sourceText: 'fuite',
      targetText: 'retard du terrassement',
    })
  })
  it('"Le nouveau schéma remplace le schéma électrique." → replaces', () => {
    expect(extractRelationClaim('Le nouveau schéma remplace le schéma électrique.')).toEqual({
      relationType: 'replaces',
      sourceText: 'nouveau schéma',
      targetText: 'schéma électrique',
    })
  })
})

describe('extractRelationClaim — nettoyage (article de tête, ponctuation)', () => {
  it("strip l'article de tête sur la cible, pas sur la source si absent", () => {
    const r = extractRelationClaim('SSI dépend de la mise sous tension.')
    expect(r?.sourceText).toBe('SSI')
    expect(r?.targetText).toBe('mise sous tension')
  })
  it('strip la ponctuation finale (!, ?)', () => {
    expect(extractRelationClaim('Le SSI dépend de la mise sous tension !')?.targetText).toBe('mise sous tension')
  })
})

describe('extractRelationClaim — hors périmètre (aucun verbe reconnu) → null', () => {
  it('"Clim Expair s\'occupe de la climatisation." → null (acteur↔domaine, hors périmètre)', () => {
    expect(extractRelationClaim("Clim Expair s'occupe de la climatisation.")).toBeNull()
  })
  it('"Jérôme travaille chez BECIB." → null (affiliation, hors périmètre)', () => {
    expect(extractRelationClaim('Jérôme travaille chez BECIB.')).toBeNull()
  })
  it('phrase sans verbe relationnel → null', () => {
    expect(extractRelationClaim('Les gaines sont arrivées ce matin.')).toBeNull()
  })
})

describe('extractRelationClaim — syntagme vide après nettoyage → null', () => {
  it('cible réduite à un seul caractère après nettoyage → null', () => {
    expect(extractRelationClaim('Le SSI dépend de x.')).toBeNull()
  })
})
