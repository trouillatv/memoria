import { describe, it, expect } from 'vitest'
import { classifyDocument, guessDocumentType } from '../../lib/documents/classify'

describe('guessDocumentType', () => {
  it('reconnaît "pv" dans un nom de fichier', () => {
    expect(guessDocumentType('pv_visite_juillet_2024.pdf')).toBe('historical_visit_report')
  })

  it("reconnaît procès-verbal dans un nom de fichier", () => {
    expect(guessDocumentType('proces-verbal-chantier-2023.pdf')).toBe('historical_visit_report')
  })

  it("reconnaît rapport-de-visite dans un nom de fichier", () => {
    expect(guessDocumentType('rapport_de_visite_ocef_2024.pdf')).toBe('historical_visit_report')
  })

  it("ne confond pas procédure avec un PV", () => {
    const t = guessDocumentType('procedure-securite.pdf')
    expect(t).toBe('procedure')
    expect(t).not.toBe('historical_visit_report')
  })

  it("retourne autre pour un nom générique sans indice", () => {
    expect(guessDocumentType('document_2024.pdf')).toBe('autre')
  })
})

describe('classifyDocument — historical_visit_report', () => {
  it("tier = froide (jamais consultable ni vivante)", () => {
    const c = classifyDocument({ documentType: 'historical_visit_report' })
    expect(c.tier).toBe('froide')
  })

  it("embedding = false — pas indexé automatiquement", () => {
    const c = classifyDocument({ documentType: 'historical_visit_report' })
    expect(c.embeddingRecommended).toBe(false)
  })

  it("reason ne contient pas indéterminé — type explicitement connu", () => {
    const c = classifyDocument({ documentType: 'historical_visit_report' })
    expect(c.reason).not.toMatch(/ind[eé]termin[eé]/)
  })

  it("filename ne change pas le tier du historical_visit_report", () => {
    const c = classifyDocument({ documentType: 'historical_visit_report', filename: 'pv-visite.pdf' })
    expect(c.tier).toBe('froide')
    expect(c.embeddingRecommended).toBe(false)
  })
})
