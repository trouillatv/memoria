// P0-3.1A (mandat Vincent 2026-09-25) — un Engagement Porte B manuel n'a, par
// construction, aucun document (documentId null). ProvenanceLine doit afficher
// « Créé manuellement », jamais un libellé générique « Document » ni un lien
// vide qui affirmerait une provenance documentaire fictive.

import { describe, it, expect } from 'vitest'
import { ProvenanceLine } from '@/components/engagements/PlannedEngagementCard'

function treeContainsText(node: unknown, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node === text
  if (Array.isArray(node)) return node.some((n) => treeContainsText(n, text))
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') {
    return treeContainsText((el.type as (props: unknown) => unknown)(el.props), text)
  }
  return el.props ? treeContainsText(el.props.children, text) : false
}

describe('ProvenanceLine — provenance manuelle vs documentaire', () => {
  it('documentId=null (Engagement manuel) : affiche "Créé manuellement", jamais "Document"', () => {
    const tree = ProvenanceLine({
      provenance: {
        documentId: null,
        documentFilename: null,
        pageNumber: null,
        excerpt: 'Nettoyage hebdomadaire des vitres',
        frequencyRaw: null,
      },
    })

    expect(treeContainsText(tree, 'Créé manuellement')).toBe(true)
    expect(treeContainsText(tree, 'Document')).toBe(false)
  })

  it('documentId présent : affiche le nom de fichier et la page, pas "Créé manuellement"', () => {
    const tree = ProvenanceLine({
      provenance: {
        documentId: 'doc-1',
        documentFilename: 'CCTP.pdf',
        pageNumber: 5,
        excerpt: 'Nettoyer les filtres tous les mois',
        frequencyRaw: 'Mensuel',
      },
    })

    expect(treeContainsText(tree, 'CCTP.pdf · p.5')).toBe(true)
    expect(treeContainsText(tree, 'Créé manuellement')).toBe(false)
  })

  it('documentId présent mais sans filename : retombe sur "Document", pas "Créé manuellement"', () => {
    const tree = ProvenanceLine({
      provenance: {
        documentId: 'doc-1',
        documentFilename: null,
        pageNumber: null,
        excerpt: null,
        frequencyRaw: null,
      },
    })

    expect(treeContainsText(tree, 'Document')).toBe(true)
    expect(treeContainsText(tree, 'Créé manuellement')).toBe(false)
  })
})
