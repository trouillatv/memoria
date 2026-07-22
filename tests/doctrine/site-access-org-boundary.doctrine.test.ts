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

  it('le rôle plateforme n’ouvre PAS les données métier — aucune exemption', () => {
    // Doctrine (Vincent, 2026-07-22) : `users.role === 'admin'` administre
    // MemorIA, il ne donne AUCUN accès aux chantiers. L'accès métier passe
    // toujours par l'appartenance. La ligne `if (user.role === 'admin') return
    // true` a été RETIRÉE — la remettre rouvrirait la porte universelle.
    // On lit le CODE, commentaires retirés : l'en-tête explique justement
    // pourquoi l'exemption a disparu, et ces phrases-là ne s'exécutent pas.
    const codeSeul = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const corps = codeSeul.slice(codeSeul.indexOf('export async function userCanAccessSite'))
    expect(corps).not.toContain("role === 'admin'")
    // La seule décision d'accès est l'appartenance à l'org du site.
    expect(corps).toContain('requireOrganizationMembership(orgId)')
  })

  it('le seul return true est le chantier sans organisation, pas un rôle', () => {
    // Un chantier orphelin ne peut pas fuiter entre orgs. Tout autre chemin
    // d'accès passe par l'appartenance : aucun `return true` conditionné à un
    // rôle ne doit exister.
    const corps = helper.slice(helper.indexOf('export async function userCanAccessSite'))
    const returnsTrue = corps.match(/return true/g) ?? []
    expect(returnsTrue.length).toBe(1)
    expect(corps).toMatch(/if \(!orgId\) return true/)
  })

  it('elle est fail-closed : sans session, aucun accès', () => {
    expect(helper).toMatch(/if \(!\(await getCurrentUserWithProfile\(\)\)\) return false/)
    expect(helper).toMatch(/if \(error\) return false/)
  })

  it('un chantier sans organisation n’est pas une fuite inter-org (accès inchangé)', () => {
    // Il n'appartient à aucune organisation : le P0 ne lui invente pas de refus.
    expect(helper).toMatch(/if \(!orgId\) return true/)
  })
})
