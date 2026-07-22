import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P0 — LA FRONTIÈRE D'ORGANISATION SUR L'ACCÈS DIRECT À UN CHANTIER ───────
//
// Fuite prouvée dynamiquement : un compte membre d'une autre entreprise ouvrait
// un chantier par URL et en voyait le contenu. La garde vit maintenant DANS la
// primitive de lecture `getSiteIdentity` (les deux versions) — le seul point
// qui ferme les 40 appelants d'un coup. Ce fichier empêche qu'une relecture la
// retire, ou qu'une nouvelle version de la primitive naisse sans elle.

const racine = process.cwd()
const cockpit = readFileSync(join(racine, 'lib/db/site-cockpit.ts'), 'utf8')
const sites = readFileSync(join(racine, 'lib/db/sites.ts'), 'utf8')
const helper = readFileSync(join(racine, 'lib/auth/site-access.ts'), 'utf8')

describe('getSiteIdentity garde l’accès AVANT toute lecture', () => {
  for (const [nom, src] of [['site-cockpit', cockpit], ['sites', sites]] as const) {
    it(`${nom} : la garde est la première instruction de getSiteIdentity`, () => {
      const i = src.indexOf('export async function getSiteIdentity')
      const corps = src.slice(i, i + 700)
      // La garde doit précéder le premier SELECT métier.
      const garde = corps.indexOf('userCanAccessSite')
      const lecture = corps.indexOf(".from('sites')")
      expect(garde).toBeGreaterThan(-1)
      expect(lecture).toBeGreaterThan(-1)
      expect(garde).toBeLessThan(lecture)
    })

    it(`${nom} : le refus est un null, jamais un message distinct`, () => {
      const i = src.indexOf('export async function getSiteIdentity')
      const corps = src.slice(i, i + 700)
      expect(corps).toMatch(/if \(!\(await userCanAccessSite\(siteId\)\)\) return null/)
    })
  }
})

describe('la garde suit la doctrine d’ownership du dépôt', () => {
  it('elle vérifie l’appartenance à l’organisation du site', () => {
    expect(helper).toMatch(/requireOrganizationMembership\(orgId\)/)
  })

  it('elle exempte le super-admin, comme decideOwnership', () => {
    // La doctrine centrale (`lib/auth/ownership.ts`) laisse passer role==='admin'.
    expect(helper).toMatch(/user\.role === 'admin'/)
    expect(helper).toMatch(/return true/)
  })

  it('elle est fail-closed : sans session, aucun accès', () => {
    expect(helper).toMatch(/if \(!user\) return false/)
    expect(helper).toMatch(/if \(error\) return false/)
  })

  it('un chantier sans organisation n’est pas une fuite inter-org (accès inchangé)', () => {
    // Il n'appartient à aucune organisation : le P0 ne lui invente pas de refus.
    expect(helper).toMatch(/if \(!orgId\) return true/)
  })
})
