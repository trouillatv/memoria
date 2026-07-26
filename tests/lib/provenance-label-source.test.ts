// Commit 4 — le libellé de provenance distingue les DEUX natures de source :
// 📘 Exigence AO (clause d'une pièce, document connu) vs ✍️ Proposé dans le
// mémoire technique (rédigé par MemorIA). Jamais « source non localisée » quand
// le document est connu ; jamais d'avertissement pour le mémoire ; aucune
// régression sur les anciens enregistrements (source_type absent).

import { describe, expect, it } from 'vitest'
import { provenanceSourceLabel } from '@/lib/tenders/provenance-label'
import { deriveEngagementProvenanceReadRow } from '@/lib/tenders/engagement-provenance'

describe('provenanceSourceLabel — Exigence AO (ao_clause)', () => {
  it('page exacte → « 📘 Exigence AO — CCTP.pdf — page 18 »', () => {
    expect(provenanceSourceLabel({ state: 'exact', filename: 'CCTP.pdf', pageNumber: 18, sourceType: 'ao_clause' }))
      .toBe('📘 Exigence AO — CCTP.pdf — page 18')
  })

  it('pièce connue mais page non localisée → « … — page non localisée » (jamais « source non localisée »)', () => {
    const label = provenanceSourceLabel({ state: 'document_only', filename: 'CCAP.pdf', pageNumber: null, sourceType: 'ao_clause' })
    expect(label).toBe('📘 Exigence AO — CCAP.pdf — page non localisée')
    expect(label).not.toContain('Source non localisée')
  })
})

describe('provenanceSourceLabel — Proposé (memoire_engagement)', () => {
  it('toujours « ✍️ Proposé dans le mémoire technique », sans avertissement ni pièce', () => {
    for (const state of ['exact', 'document_only', 'unavailable'] as const) {
      const label = provenanceSourceLabel({ state, filename: null, pageNumber: null, sourceType: 'memoire_engagement' })
      expect(label).toBe('✍️ Proposé dans le mémoire technique')
      expect(label).not.toContain('non localisée')
      expect(label).not.toContain('AO')
    }
  })
})

describe('provenanceSourceLabel — rétrocompat (source_type absent / historique)', () => {
  it('libellé NEUTRE, sans préfixe, comme avant (pas de régression)', () => {
    expect(provenanceSourceLabel({ state: 'exact', filename: 'X.pdf', pageNumber: 3 })).toBe('X.pdf — page 3')
    expect(provenanceSourceLabel({ state: 'document_only', filename: 'X.pdf', pageNumber: null })).toBe('X.pdf — page non localisée')
    expect(provenanceSourceLabel({ state: 'unavailable', filename: null, pageNumber: null })).toBe('Source non localisée')
  })
})

describe('read model — source_type porté et exposé', () => {
  it('deriveEngagementProvenanceReadRow expose sourceType (ao_clause)', () => {
    const row = deriveEngagementProvenanceReadRow({
      engagementId: 'e', tenderId: 't', sourceRef: null, sourceType: 'ao_clause',
      tenderDocumentId: 'd', pageNumber: 5, document: { id: 'd', filename: 'CCTP.pdf' },
    })
    expect(row.sourceType).toBe('ao_clause')
    expect(row.state).toBe('exact')
    expect(provenanceSourceLabel(row)).toBe('📘 Exigence AO — CCTP.pdf — page 5')
  })

  it('sourceType absent → null (historique)', () => {
    const row = deriveEngagementProvenanceReadRow({
      engagementId: 'e', tenderId: 't', sourceRef: null,
      tenderDocumentId: null, pageNumber: null, document: null,
    })
    expect(row.sourceType).toBeNull()
  })
})
