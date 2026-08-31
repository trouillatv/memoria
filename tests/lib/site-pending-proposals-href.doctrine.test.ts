import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Doctrine « Voir la visite source » (Vincent, 2026-09-01) ─────────────────
// L'arbitrage (Confirmer / Modifier / Écarter) est INLINE dans
// PendingProposalsSection — le lien « Voir la visite source » n'est donc PAS
// l'arbitrage : c'est une PORTE DE VÉRIFICATION (provenance). Il mène à la PAGE
// PRINCIPALE de la visite (l'objet), pas à son sous-espace d'édition
// /compte-rendu (ni à /memoire, qui est l'archive des propositions). Depuis la
// visite, on accède ensuite au CR, aux photos, aux objets produits, à l'archive.

const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-pending-proposals.ts'), 'utf8')

describe('getSitePendingActionProposals — reportHref = page principale de la visite', () => {
  it('pointe vers la visite (l’objet), pas un sous-espace', () => {
    expect(src).toContain('reportHref: r.report_id ? `/sites/${siteId}/visites/${r.report_id}` : null')
  })

  it('ne pointe plus vers le sous-espace d’édition /compte-rendu', () => {
    expect(src).not.toContain('/visites/${r.report_id}/compte-rendu')
  })
})
