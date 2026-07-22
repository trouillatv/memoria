import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2B — LA FRONTIÈRE DE LECTURE COMMUNE ──────────────────────────────────
//
// P0/P0.5 avaient trois primitives (`userCanAccessSite`, `userCanAccessOrgRow`)
// disant la même règle. M2B les remplace par UN moteur. Ce fichier protège ses
// invariants de sécurité ; le comportement runtime (accès/refus par famille,
// multi-org) est prouvé dynamiquement contre la base.

const racine = process.cwd()
const moteur = readFileSync(join(racine, 'lib/auth/resource-access.ts'), 'utf8')

describe('l’organisation vient de la RESSOURCE, jamais du caller', () => {
  it('le moteur n’appelle JAMAIS getOrgId()', () => {
    // C'est ce qui le rend correct en multi-org : aucune ambiguïté à lever.
    // On cherche un APPEL, pas la mention en commentaire (l'en-tête l'explique).
    const code = moteur.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/import[^\n]*getOrgId/)
  })

  it('l’org est résolue depuis la table de la ressource', () => {
    expect(moteur).toMatch(/resourceResolvers\[req\.kind\]\(req\.id\)/)
  })

  it('AUCUNE exemption de rôle — ni plateforme, ni org', () => {
    const corps = moteur.slice(moteur.indexOf('export async function resolveResourceAccess'))
    expect(corps).not.toContain("role === 'admin'")
  })
})

describe('non authentifié ≠ non autorisé', () => {
  it('le résultat interne DISCRIMINE l’authentification du cloisonnement', () => {
    for (const reason of ['unauthenticated', 'not_found', 'missing_organization', 'membership_missing', 'membership_inactive']) {
      expect(moteur, `reason ${reason}`).toContain(`'${reason}'`)
    }
  })

  it('la surface : unauthenticated → /login, tout autre refus → notFound()', () => {
    const req = moteur.slice(moteur.indexOf('export async function requireResourceAccess'))
    expect(req).toMatch(/if \(r\.reason === 'unauthenticated'\) redirect\('\/login'\)/)
    expect(req).toMatch(/notFound\(\)/)
  })
})

describe('les refus sont fail-closed et sans oracle', () => {
  it('ressource inexistante ET org null → refus (jamais true par défaut)', () => {
    expect(moteur).toMatch(/if \(orgId === undefined\) return \{ ok: false, reason: 'not_found' \}/)
    expect(moteur).toMatch(/if \(orgId === null\)/)
    // org null est aussi une anomalie observable côté serveur.
    expect(moteur).toMatch(/console\.error\(`\[resource-access\]/)
  })

  it('membership suspendu ≠ actif → refus', () => {
    expect(moteur).toMatch(/if \(m\.status !== 'active'\) return \{ ok: false, reason: 'membership_inactive' \}/)
  })

  it('cinq résolveurs NOMMÉS, aucun nom de table libre hors du module', () => {
    for (const r of ['resolveSiteOrganization', 'resolveClientOrganization', 'resolveMissionOrganization', 'resolveInterventionOrganization', 'resolveContractOrganization']) {
      expect(moteur, r).toContain(`function ${r}`)
    }
    // La mécanique SELECT est privée et fermée : pas d'export d'un helper à table libre.
    expect(moteur).not.toMatch(/export .*selectOrganizationIdFromKnownTable/)
  })

  it('cinq façades typées', () => {
    for (const f of ['requireSiteAccess', 'requireClientAccess', 'requireMissionAccess', 'requireInterventionAccess', 'requireContractAccess']) {
      expect(moteur, f).toMatch(new RegExp(`export const ${f}\\b`))
    }
  })
})

describe('les anciennes primitives ont disparu', () => {
  it('lib/auth/site-access.ts est supprimé', () => {
    expect(existsSync(join(racine, 'lib/auth/site-access.ts'))).toBe(false)
  })

  it('plus aucun appelant de userCanAccessSite / userCanAccessOrgRow (hors commentaire)', () => {
    // On lit les fichiers migrés : ils importent le moteur, plus les helpers.
    const migres = [
      'lib/db/site-cockpit.ts',
      'lib/db/sites.ts',
      'app/(dashboard)/clients/[id]/page.tsx',
      'app/(dashboard)/interventions/[id]/page.tsx',
      'app/(dashboard)/missions/[missionId]/page.tsx',
      'app/(dashboard)/contracts/[id]/page.tsx',
      'app/(field)/m/site/[siteId]/page.tsx',
    ]
    for (const f of migres) {
      const src = readFileSync(join(racine, f), 'utf8')
      const code = src.replace(/\/\/.*$/gm, '')
      expect(code, `${f} appelle encore un ancien helper`).not.toMatch(/userCanAccess(Site|OrgRow)\(/)
      expect(code, `${f} n'importe pas le moteur`).toMatch(/from '@\/lib\/auth\/resource-access'/)
    }
  })
})

describe('getSiteIdentity : la garde reste AVANT toute lecture', () => {
  for (const f of ['lib/db/site-cockpit.ts', 'lib/db/sites.ts']) {
    it(`${f} : resolveResourceAccess précède le SELECT sites`, () => {
      const src = readFileSync(join(racine, f), 'utf8')
      const i = src.indexOf('export async function getSiteIdentity')
      const corps = src.slice(i, i + 900)
      const garde = corps.indexOf('resolveResourceAccess')
      const lecture = corps.indexOf(".from('sites')")
      expect(garde).toBeGreaterThan(-1)
      expect(lecture).toBeGreaterThan(-1)
      expect(garde).toBeLessThan(lecture)
      // Le refus reste un `null`, contrat historique du loader.
      expect(corps).toMatch(/\)\.ok\) return null/)
    })
  }
})

describe('les 4 pages P0.5 utilisent les façades, garde avant loader', () => {
  const pages: Array<[string, string, string]> = [
    ['app/(dashboard)/clients/[id]/page.tsx', 'requireClientAccess(id)', 'getClientDetail(id)'],
    ['app/(dashboard)/interventions/[id]/page.tsx', 'requireInterventionAccess(id)', 'getIntervention(id)'],
    ['app/(dashboard)/missions/[missionId]/page.tsx', 'requireMissionAccess(missionId)', 'getMission(missionId)'],
    ['app/(dashboard)/contracts/[id]/page.tsx', 'requireContractAccess(id)', 'getContract(id)'],
  ]
  for (const [chemin, facade, loader] of pages) {
    it(`${chemin} : ${facade} avant ${loader}`, () => {
      const src = readFileSync(join(racine, chemin), 'utf8')
      const garde = src.indexOf(`await ${facade}`)
      const charge = src.indexOf(`await ${loader}`)
      expect(garde, `${facade} absente`).toBeGreaterThan(-1)
      expect(charge, `${loader} absent`).toBeGreaterThan(-1)
      expect(garde, 'garde après le loader').toBeLessThan(charge)
    })
  }
})
