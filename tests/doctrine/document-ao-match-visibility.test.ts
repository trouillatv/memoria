// A2 — matchAoToKnowledge élargi aux documents, visibilité respectée.
//
// Contrainte non négociable : visibility_level respecté PARTOUT. Un chunk
// document ne doit jamais fuiter dans le contexte AO d'un appelant qui n'a
// pas le droit de le voir. Tripwire structurel pur (server-only → pas
// d'import runtime).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const src = readFileSync(join(ROOT, 'lib/ai/match-ao-knowledge.ts'), 'utf-8')

describe('A2 — matchAoToKnowledge : documents + visibilité', () => {
  it("inclut le domaine 'document' dans le recall", () => {
    expect(/p_source_domains:\s*\[\s*'library',\s*'tender_history',\s*'document'\s*\]/.test(src)).toBe(true)
  })

  it('filtre les chunks document via canViewDocument (visibilité au recall)', () => {
    expect(src).toContain("import { canViewDocument } from '@/lib/documents/access'")
    // Le filtre ne s'applique qu'au domaine document ; library/tender_history
    // (savoir entreprise) passent toujours.
    expect(/source_domain\s*!==\s*'document'\)\s*return true/.test(src)).toBe(true)
    expect(/canViewDocument\(role,\s*lvl\)/.test(src)).toBe(true)
  })

  it('rôle par défaut = null → aucun document (pas de fuite si non câblé)', () => {
    expect(/role:\s*UserRole\s*\|\s*null\s*=\s*null/.test(src)).toBe(true)
  })

  it('recall reste borné (p_limit inchangé + requête cappée)', () => {
    expect(/p_limit:\s*15/.test(src)).toBe(true)
    // La requête d'embedding est cappée (texte AO tronqué) — pas de dump.
    expect(/rawText\.slice\(0,\s*2000\)/.test(src)).toBe(true)
  })

  it('lien source conservé pour les documents ([doc:id] ré-ouvrable)', () => {
    expect(/Document \[doc:\$\{match\.source_id\}\]/.test(src)).toBe(true)
  })
})
