import { describe, expect, it } from 'vitest'
import {
  buildExtractionSources,
  dedupeEngagements,
  mapWithConcurrency,
  type ExtractionDoc,
} from '@/lib/tenders/extract-engagements'

const doc = (id: string, filename: string, extractedText: string | null): ExtractionDoc => ({
  id, filename, kind: null, extractedText,
})

describe('buildExtractionSources', () => {
  it('une source par pièce LISIBLE + une pour le mémoire', () => {
    const sources = buildExtractionSources(
      [doc('d1', 'CCAP.pdf', 'texte ccap'), doc('d2', 'CCTP.pdf', 'texte cctp')],
      'mémoire technique',
    )
    expect(sources).toHaveLength(3)
    expect(sources[0]).toMatchObject({ sourceType: 'ao_clause', tenderDocumentId: 'd1' })
    expect(sources[1]).toMatchObject({ sourceType: 'ao_clause', tenderDocumentId: 'd2' })
    expect(sources[2]).toMatchObject({ sourceType: 'memoire_engagement', tenderDocumentId: null })
  })

  it('ignore les pièces sans texte (plan sans OCR, extraction échouée)', () => {
    const sources = buildExtractionSources(
      [doc('d1', 'CCAP.pdf', 'texte'), doc('d2', 'Plan.pdf', null), doc('d3', 'Vide.pdf', '   ')],
      null,
    )
    expect(sources.map((s) => s.tenderDocumentId)).toEqual(['d1'])
  })

  it('pas de mémoire → pas de passe mémoire', () => {
    expect(buildExtractionSources([doc('d1', 'CCAP.pdf', 'x')], null)).toHaveLength(1)
    expect(buildExtractionSources([], '   ')).toHaveLength(0)
  })
})

describe('mapWithConcurrency', () => {
  it('préserve l\'ordre des résultats', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10)
    expect(out).toEqual([10, 20, 30, 40, 50])
  })

  it('ne dépasse JAMAIS la concurrence demandée', async () => {
    let active = 0
    let maxActive = 0
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(maxActive).toBeLessThanOrEqual(3)
  })
})

describe('dedupeEngagements — identité (document, type, libellé normalisé)', () => {
  const e = (tender_document_id: string | null, source_type: 'ao_clause' | 'memoire_engagement', short_label: string) =>
    ({ tender_document_id, source_type, short_label })

  it('fusionne un doublon dans la MÊME pièce (casse/espaces normalisés)', () => {
    const out = dedupeEngagements([
      e('d1', 'ao_clause', 'Nettoyage quotidien'),
      e('d1', 'ao_clause', '  nettoyage   QUOTIDIEN '),
    ])
    expect(out).toHaveLength(1)
  })

  it('garde la même clause présente dans DEUX pièces (chacune sa provenance)', () => {
    const out = dedupeEngagements([
      e('d1', 'ao_clause', 'Nettoyage quotidien'),
      e('d2', 'ao_clause', 'Nettoyage quotidien'),
    ])
    expect(out).toHaveLength(2)
  })

  it('garde exigence AO et proposition mémoire de même libellé (types différents)', () => {
    const out = dedupeEngagements([
      e('d1', 'ao_clause', 'Conformité totale'),
      e(null, 'memoire_engagement', 'Conformité totale'),
    ])
    expect(out).toHaveLength(2)
  })
})
