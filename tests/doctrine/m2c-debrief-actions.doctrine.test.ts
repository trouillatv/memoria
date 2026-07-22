import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C (surface debrief-actions) : l'org vient de la RESSOURCE ─────────────
//
// Avant : `getOrgId()` (org du caller) + comparaison — levait en multi-org, donc
// les ecritures de visite cassaient pour un compte a deux entreprises. Apres :
// membership actif a l'org de la visite. La politique write (role terrain) reste
// portee par `requireFieldAgent`.

const src = readFileSync(join(process.cwd(), 'app/(field)/m/visite/[reportId]/debrief-actions.ts'), 'utf8')

describe('debrief-actions ne depend plus de l’org du caller', () => {
  it('AUCUN appel getOrgId() ne subsiste', () => {
    const code = src.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/import[^\n]*getOrgId/)
  })

  it('la frontiere est le membership a l’org de la visite', () => {
    expect(src).toMatch(/requireOrganizationMembership\(visit\.organization_id/)
  })

  it('plus de comparaison a une org de caller', () => {
    expect(src).not.toMatch(/visit\.organization_id !== orgId/)
  })

  it('la politique write terrain (requireFieldAgent) est conservee', () => {
    expect(src).toMatch(/requireFieldAgent\(\)/)
  })

  it('l’org passee aux mutations vient de la ressource, pas du caller', () => {
    expect(src).not.toMatch(/orgId \?\? visit\.organization_id/)
  })
})
