// Presenter partagé de la source d'un engagement : UNIQUE source de vérité pour
// badge / libellé / document du filtre / état de localisation. Couvre les cinq
// états, dont ceux qui ne doivent JAMAIS retomber sur « source non localisée ».

import { describe, expect, it } from 'vitest'
import {
  classifyEngagementSource,
  engagementSourceDisplay,
  MEMOIRE_FILTER_VALUE,
  UNLOCATED_FILTER_VALUE,
  type EngagementSourceInput,
} from '@/lib/tenders/engagement-source-display'

const input = (over: Partial<EngagementSourceInput>): EngagementSourceInput => ({
  sourceType: 'ao_clause',
  tenderDocumentId: null,
  documentExists: false,
  documentFilename: null,
  page: null,
  ...over,
})

describe('classifyEngagementSource', () => {
  it('mémoire → memoire (même sans page ni document)', () => {
    expect(classifyEngagementSource(input({ sourceType: 'memoire_engagement' }))).toBe('memoire')
  })
  it('pièce connue + page → ao_exact', () => {
    expect(classifyEngagementSource(input({ tenderDocumentId: 'd', documentExists: true, page: 18 }))).toBe('ao_exact')
  })
  it('pièce connue sans page → ao_document_only', () => {
    expect(classifyEngagementSource(input({ tenderDocumentId: 'd', documentExists: true, page: null }))).toBe('ao_document_only')
  })
  it('id présent mais pièce absente → document_unavailable', () => {
    expect(classifyEngagementSource(input({ tenderDocumentId: 'd', documentExists: false }))).toBe('document_unavailable')
  })
  it('aucun document → unlocated', () => {
    expect(classifyEngagementSource(input({ tenderDocumentId: null }))).toBe('unlocated')
  })
})

describe('engagementSourceDisplay — libellés & valeurs de filtre', () => {
  it('ao_exact', () => {
    const d = engagementSourceDisplay(input({ tenderDocumentId: 'd1', documentExists: true, documentFilename: 'CCTP.pdf', page: 18 }))
    expect(d).toMatchObject({ kind: 'ao_exact', documentId: 'd1', filterValue: 'd1', page: 18, label: '📘 Exigence AO — CCTP.pdf — page 18' })
  })

  it('ao_document_only → « page non localisée », jamais « source non localisée »', () => {
    const d = engagementSourceDisplay(input({ tenderDocumentId: 'd1', documentExists: true, documentFilename: 'CCTP.pdf', page: null }))
    expect(d.kind).toBe('ao_document_only')
    expect(d.label).toBe('📘 Exigence AO — CCTP.pdf — page non localisée')
    expect(d.label).not.toContain('Source non localisée')
    expect(d.filterValue).toBe('d1')
  })

  it('mémoire → jamais « source non localisée », valeur de filtre dédiée', () => {
    const d = engagementSourceDisplay(input({ sourceType: 'memoire_engagement' }))
    expect(d).toMatchObject({ kind: 'memoire', documentId: null, filterValue: MEMOIRE_FILTER_VALUE, label: '✍️ Proposé dans le mémoire technique' })
    expect(d.label).not.toContain('non localisée')
  })

  it('document supprimé → « Document indisponible », distinct de non localisé', () => {
    const d = engagementSourceDisplay(input({ tenderDocumentId: 'ghost', documentExists: false, sourceType: 'ao_clause' }))
    expect(d.kind).toBe('document_unavailable')
    expect(d.documentLabel).toBe('Document indisponible')
    expect(d.label).not.toContain('Source non localisée')
  })

  it('vraiment non localisé → ⚠️ Source non localisée + valeur de filtre dédiée', () => {
    const d = engagementSourceDisplay(input({ tenderDocumentId: null, sourceType: 'ao_clause' }))
    expect(d).toMatchObject({ kind: 'unlocated', documentId: null, filterValue: UNLOCATED_FILTER_VALUE, label: '⚠️ Source non localisée' })
  })

  it('deux pièces de nom identique → valeurs de filtre DIFFÉRENTES (id, pas le nom)', () => {
    const a = engagementSourceDisplay(input({ tenderDocumentId: 'id-A', documentExists: true, documentFilename: 'Annexe.pdf', page: 1 }))
    const b = engagementSourceDisplay(input({ tenderDocumentId: 'id-B', documentExists: true, documentFilename: 'Annexe.pdf', page: 2 }))
    expect(a.filterValue).not.toBe(b.filterValue)
    expect(a.documentLabel).toBe(b.documentLabel) // même nom affiché
  })
})
