import { describe, it, expect } from 'vitest'
import { TERRAIN_VISIT_ORIGINS, isTerrainVisitOrigin, isImportedDocumentOrigin } from './visit-origins'

describe('visit-origins — contrat P0.5-Vérité', () => {
  it('les 4 origines terrain satisfont isTerrainVisitOrigin', () => {
    for (const o of TERRAIN_VISIT_ORIGINS) expect(isTerrainVisitOrigin(o)).toBe(true)
    expect(TERRAIN_VISIT_ORIGINS).toEqual(['planned', 'spontaneous', 'qr', 'gps'])
  })

  it("origin='import' n'est JAMAIS une visite terrain", () => {
    expect(isTerrainVisitOrigin('import')).toBe(false)
    expect(isImportedDocumentOrigin('import')).toBe(true)
  })

  it('une réunion (origin null) ni terrain ni import', () => {
    expect(isTerrainVisitOrigin(null)).toBe(false)
    expect(isTerrainVisitOrigin(undefined)).toBe(false)
    expect(isImportedDocumentOrigin(null)).toBe(false)
  })

  it('une valeur inconnue ne devient pas terrain par défaut', () => {
    expect(isTerrainVisitOrigin('legacy_unknown')).toBe(false)
    expect(isImportedDocumentOrigin('legacy_unknown')).toBe(false)
  })
})
