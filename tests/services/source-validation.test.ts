import { describe, it, expect } from 'vitest'
import { validateSources } from '@/services/ai/source-validation'
import type { Source } from '@/types/sources'

describe('validateSources', () => {
  it('drops PDF citations not present in extracted_text', () => {
    const sources: Source[] = [
      { type: 'pdf', quote: 'Astreinte 24/7 obligatoire pendant la durée' },
      { type: 'pdf', quote: 'PHRASE QUI N\'EXISTE PAS DU TOUT XYZ123' },
    ]
    const result = validateSources(sources, {
      extractedText: 'Le candidat doit assurer une astreinte 24/7 obligatoire pendant la durée du marché.',
      knowledgeItems: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0].verified).toBe(true)
  })

  it('enriches library citations with id when title matches', () => {
    const sources: Source[] = [
      { type: 'library', quote: 'X', library_item_title: 'Référence CHU' },
    ]
    const result = validateSources(sources, {
      extractedText: '',
      knowledgeItems: [
        { id: 'abc-123', title: 'Référence CHU', category: 'references_clients' } as never,
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0].library_item_id).toBe('abc-123')
    expect(result[0].library_item_category).toBe('references_clients')
  })

  it('drops library citations without matching title', () => {
    const sources: Source[] = [
      { type: 'library', quote: 'X', library_item_title: 'Inexistant' },
    ]
    const result = validateSources(sources, {
      extractedText: '',
      knowledgeItems: [],
    })
    expect(result).toHaveLength(0)
  })
})
