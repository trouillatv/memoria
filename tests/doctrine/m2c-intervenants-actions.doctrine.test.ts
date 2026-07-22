import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C (surface intervenants-actions) : associer + rechercher passent la porte ─
//
// Avant : `requireManagerOrAdmin` (rôle du profil) + `requireSiteInOrg` (org du
// caller via getOrgId). Les DEUX recherches d'aide reçoivent un `site_id` : c'est
// leur contexte métier (on cherche dans l'organisation propriétaire du chantier),
// donc M2C — pas M3. Tout passe par `requireSiteWriteAccess(siteId, 'managerOrAdmin')`.

const src = readFileSync(
  join(process.cwd(), 'app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions.ts'),
  'utf8',
)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('plus aucune dépendance à l’org du caller', () => {
  it('aucun getOrgId(), aucun user.organization_id', () => {
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/user\.organization_id/)
  })

  it('les anciens helpers requireSiteInOrg / requireManagerOrAdmin ont disparu', () => {
    expect(code).not.toMatch(/requireSiteInOrg/)
    expect(code).not.toMatch(/function requireManagerOrAdmin/)
  })
})

describe('la frontière SITE, politique managerOrAdmin, sur les trois gestes', () => {
  for (const fn of ['searchOrgContactsAction', 'associateContactAction', 'searchIntervenantTargetsAction']) {
    it(`${fn} : requireSiteWriteAccess(site_id, 'managerOrAdmin')`, () => {
      const i = src.indexOf(`export async function ${fn}`)
      const corps = src.slice(i, i + 700)
      expect(corps).toMatch(/requireSiteWriteAccess\(parsed\.data\.site_id, 'managerOrAdmin'\)/)
    })
  }

  it('l’org qui scope la recherche vient de la ressource (access.organizationId)', () => {
    expect(code).toMatch(/const orgId = access\.organizationId/)
  })
})
