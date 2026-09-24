// P0-1B3 — une version remplacée (fn_supersede_document, P0-1B2) a ses
// knowledge_chunks supprimés en base : le libellé d'indexation doit refléter
// ce fait quel que soit analysis_status/memory_tier, sinon l'UI ment.

import { describe, it, expect } from 'vitest'
import { indexationState } from '@/lib/documents/labels'

describe('indexationState — supersession neutralise l’indexation (P0-1B3)', () => {
  it('document remplacé (status=superseded) → Non indexé (remplacé), même si analysis_status=ready et couche vivante', () => {
    expect(indexationState('ready', 'vivante', 'superseded')).toEqual({
      label: 'Non indexé (remplacé)',
      indexed: false,
    })
  })

  it('la supersession prime sur un statut d’analyse en échec (même verdict, message dédié)', () => {
    expect(indexationState('failed', 'vivante', 'superseded')).toEqual({
      label: 'Non indexé (remplacé)',
      indexed: false,
    })
  })

  it('document actif (status=active) conserve le comportement existant', () => {
    expect(indexationState('ready', 'vivante', 'active')).toEqual({ label: 'Indexé', indexed: true })
    expect(indexationState('ready', 'froide', 'active')).toEqual({ label: 'Non indexé', indexed: false })
    expect(indexationState('chunking', 'vivante', 'active')).toEqual({ label: 'Indexation…', indexed: null })
  })

  it('documentStatus omis (appelant existant, CollectionLibrary) → comportement inchangé', () => {
    expect(indexationState('ready', 'vivante')).toEqual({ label: 'Indexé', indexed: true })
    expect(indexationState('failed', null)).toEqual({ label: 'Indexation échouée', indexed: false })
  })
})
