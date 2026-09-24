// Revue ChatGPT 2026-09-25 sur P0-3 : « Prestations prévues » doit être une
// capacité PERMANENTE du chantier, visible même à zéro Engagement — pas une
// pill masquée comme 'documents'. On appelle le composant directement (comme
// tests/knowledge/field-actions-page-scope.test.ts) pour inspecter l'arbre
// React sans monter un DOM complet.

import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/m/site/site-1',
}))

import { SiteTabs } from '@/app/(field)/m/site/[siteId]/SiteTabs'

/** Cherche un texte exact parmi les enfants d'un arbre React non monté. */
function treeContainsText(node: unknown, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node === text
  if (Array.isArray(node)) return node.some((n) => treeContainsText(n, text))
  const el = node as { props?: { children?: unknown } }
  return el.props ? treeContainsText(el.props.children, text) : false
}

describe('SiteTabs — visibilité permanente de « Prestations prévues »', () => {
  it('l\'onglet est présent même quand showDocuments=false (aucun Engagement à influencer)', () => {
    const tree = SiteTabs({ siteId: 'site-1', showDocuments: false })
    expect(treeContainsText(tree, 'Prestations prévues')).toBe(true)
  })

  it('l\'onglet reste présent quand showDocuments=true', () => {
    const tree = SiteTabs({ siteId: 'site-1', showDocuments: true })
    expect(treeContainsText(tree, 'Prestations prévues')).toBe(true)
  })

  it('« Documents », lui, reste conditionné à showDocuments (non régressé)', () => {
    const withoutDocs = SiteTabs({ siteId: 'site-1', showDocuments: false })
    const withDocs = SiteTabs({ siteId: 'site-1', showDocuments: true })
    expect(treeContainsText(withoutDocs, 'Documents')).toBe(false)
    expect(treeContainsText(withDocs, 'Documents')).toBe(true)
  })
})
