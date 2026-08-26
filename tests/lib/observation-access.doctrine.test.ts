import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Bug 2026-08-26 (Vincent, recette Terrain) ────────────────────────────────
// La fiche Observation comparait site.organization_id au SEUL organization_id
// primaire de l'utilisateur. Un utilisateur membre ACTIF d'une autre
// organisation (cas réel : plusieurs memberships actifs par utilisateur)
// voyait le chantier sur Terrain (garde requireOwned, ensemble complet des
// memberships) mais recevait « Page introuvable » sur l'observation d'une
// capture du MÊME chantier. Preuve en base : capture existante, accès refusé
// à tort par la comparaison naïve. Ce test échoue avant qu'une comparaison
// d'organisation réécrite à la main ne revienne sur cette page.

const PAGE_PATH = join(process.cwd(), 'app/(field)/m/observation/[captureId]/page.tsx')

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('Fiche Observation — garde d’appartenance par requireOwned, pas par comparaison naïve', () => {
  const src = codeOf(PAGE_PATH)

  it('la garde passe par requireOwned — pas par une comparaison d’org réécrite à la main', () => {
    expect(src).toContain('requireOwned')
    expect(src).not.toMatch(/organization_id\s*!==\s*user\.organization_id/)
    expect(src).not.toMatch(/user\.organization_id\s*!==\s*site\.organization_id/)
  })

  it('la garde rend 404, jamais 403', () => {
    expect(src).toContain('notFound()')
    expect(src).not.toMatch(/403|forbidden|Accès refusé/i)
  })
})
