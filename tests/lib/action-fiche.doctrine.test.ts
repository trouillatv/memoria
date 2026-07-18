import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Lot 4 · Slice 3 — la fiche Action lit UNE action, sûrement ───────────────
// getSiteActionFiche est un module `server-only` (DB) → on protège ses
// invariants par lecture de source (même pattern que site-intervenants-view).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/action-fiche.ts'), 'utf8')

describe('getSiteActionFiche — lecture canonique, fail-closed', () => {
  it('l’action est scopée au chantier (garde IDOR)', () => {
    expect(src).toMatch(/eq\('site_id', siteId\)/)
    expect(src).toMatch(/eq\('id', actionId\)/)
  })

  it('l’org du site est vérifiée (fail-closed, service-role bypasse la RLS)', () => {
    expect(src).toContain('getOrgId')
    expect(src).toContain('organization_id')
  })

  it('le responsable identifié vient de assigned_contact_id, jamais de assigned_to seul', () => {
    expect(src).toContain('assigned_contact_id')
    expect(src).toContain("kind: 'contact'")
    // assigned_to n'est qu'un repli « ancien suivi », jamais une personne.
    expect(src).toContain("kind: 'text'")
  })

  it('le retard ne compte jamais une action terminée ou annulée', () => {
    expect(src).toMatch(/status !== 'done'/)
    expect(src).toMatch(/status !== 'cancelled'/)
  })
})
