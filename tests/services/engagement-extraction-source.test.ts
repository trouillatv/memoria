// Commit 1 — l'agent d'extraction est MONO-SOURCE : une source structurée par
// appel, dont la NATURE (source_type) et la PIÈCE d'origine (tender_document_id)
// sont IMPOSÉES par l'appelant, jamais devinées par l'IA. C'est ce qui garantit
// qu'une exigence d'AO ne sera jamais confondue avec une proposition du mémoire
// technique généré.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildEngagementExtractionMessage,
  runEngagementExtractionAgent,
} from '@/services/ai/engagement-extraction'

// Neutralise le tracking IA (écriture Supabase) : on ne teste que l'agent.
vi.mock('@/services/ai/tracking', () => ({
  withAITracking: async (
    _feature: string,
    _userId: string | null,
    fn: () => Promise<{ result: unknown }>,
  ) => (await fn()).result,
}))

const originalProvider = process.env.AI_PROVIDER
beforeAll(() => { process.env.AI_PROVIDER = 'mock' })
afterAll(() => { process.env.AI_PROVIDER = originalProvider })

describe('runEngagementExtractionAgent — source imposée', () => {
  it('pièce AO → source_type=ao_clause et tender_document_id imposés sur CHAQUE engagement', async () => {
    const res = await runEngagementExtractionAgent({
      sourceText: 'contenu de la pièce (ignoré par le mock)',
      sourceType: 'ao_clause',
      tenderDocumentId: 'doc-42',
      sourceLabel: 'CCTP — cctp.pdf',
      userId: null,
    })

    expect(res.engagements.length).toBeGreaterThan(0)
    // Le fixture mock contient des 'memoire_engagement' : l'imposition doit
    // TOUS les ramener à la source réellement lue.
    for (const e of res.engagements) {
      expect(e.source_type).toBe('ao_clause')
      expect(e.tender_document_id).toBe('doc-42')
    }
  })

  it('mémoire technique → source_type=memoire_engagement et tender_document_id=null', async () => {
    const res = await runEngagementExtractionAgent({
      sourceText: 'texte du mémoire technique',
      sourceType: 'memoire_engagement',
      tenderDocumentId: null,
      sourceLabel: 'Mémoire technique proposé',
      userId: null,
    })

    expect(res.engagements.length).toBeGreaterThan(0)
    for (const e of res.engagements) {
      expect(e.source_type).toBe('memoire_engagement')
      expect(e.tender_document_id).toBeNull()
    }
  })

  it('la métadonnée trace la source (document, libellé, taille) — coût par passe', async () => {
    const res = await runEngagementExtractionAgent({
      sourceText: 'x'.repeat(1234),
      sourceType: 'ao_clause',
      tenderDocumentId: 'doc-1',
      sourceLabel: 'CCAP — ccap.pdf',
      userId: null,
    })
    expect(res.metadata).toMatchObject({
      source_type: 'ao_clause',
      source_label: 'CCAP — ccap.pdf',
      tender_document_id: 'doc-1',
      source_chars: 1234,
    })
    expect(res.metadata.engagements_count).toBe(res.engagements.length)
  })
})

describe('buildEngagementExtractionMessage — texte intégral, sans plafond', () => {
  it('inclut le texte COMPLET de la source et son libellé (aucune troncature)', () => {
    // > ancien plafond de 30 000 : c'est précisément ce qui permet d'atteindre
    // les clauses profondes des gros CCTP/CCAP.
    const big = 'CLAUSE CONTRACTUELLE. '.repeat(2000) // ~44 000 caractères
    const msg = buildEngagementExtractionMessage(big, 'CCTP — cctp.pdf')
    expect(msg).toContain('=== Source : CCTP — cctp.pdf ===')
    expect(msg).toContain(big)
  })
})
