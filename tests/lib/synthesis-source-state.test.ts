// Provenance de la synthèse IA — même vocabulaire que l'audit.
// « Une page inventée est pire que pas de page » : une source non vérifiée ne
// présente jamais sa page comme un fait ; sans pièce démontrée, non localisée.

import { describe, expect, it } from 'vitest'
import { deriveSynthesisSourceState, provenanceSourceLabel } from '@/lib/tenders/provenance-label'

describe('deriveSynthesisSourceState — les trois états', () => {
  it('pièce + page + vérifiée → exact', () => {
    expect(deriveSynthesisSourceState({ document: 'CCTP.pdf', page: 12, verified: true })).toBe('exact')
  })

  it('pièce + page mais verified absent (legacy) → exact', () => {
    // Une source historique sans champ verified reste affichée telle quelle.
    expect(deriveSynthesisSourceState({ document: 'CCTP.pdf', page: 12 })).toBe('exact')
  })

  it('pièce + page mais NON vérifiée → document_only (la page tombe)', () => {
    expect(deriveSynthesisSourceState({ document: 'CCTP.pdf', page: 12, verified: false })).toBe('document_only')
  })

  it('pièce sans page → document_only', () => {
    expect(deriveSynthesisSourceState({ document: 'CCTP.pdf', page: null, verified: true })).toBe('document_only')
  })

  it('pas de pièce démontrée → unavailable', () => {
    expect(deriveSynthesisSourceState({ document: null, page: null })).toBe('unavailable')
    expect(deriveSynthesisSourceState({})).toBe('unavailable')
  })
})

describe('libellé — la page non vérifiée ne s\'affiche jamais comme un fait', () => {
  it('non vérifiée → « CCTP.pdf — page non localisée », jamais « page 12 »', () => {
    const state = deriveSynthesisSourceState({ document: 'CCTP.pdf', page: 12, verified: false })
    const label = provenanceSourceLabel({ state, filename: 'CCTP.pdf', pageNumber: 12 })
    expect(label).toBe('CCTP.pdf — page non localisée')
    expect(label).not.toContain('page 12')
  })

  it('vérifiée → « CCTP.pdf — page 12 »', () => {
    const state = deriveSynthesisSourceState({ document: 'CCTP.pdf', page: 12, verified: true })
    expect(provenanceSourceLabel({ state, filename: 'CCTP.pdf', pageNumber: 12 })).toBe('CCTP.pdf — page 12')
  })

  it('sans pièce → « Source non localisée »', () => {
    const state = deriveSynthesisSourceState({ document: null, page: null })
    expect(provenanceSourceLabel({ state, filename: null, pageNumber: null })).toBe('Source non localisée')
  })
})
