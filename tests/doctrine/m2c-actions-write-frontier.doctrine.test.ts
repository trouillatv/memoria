import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C (surface actions/actions.ts) : TOUTE écriture chantier a une frontière ──
//
// Décision B : au-delà des deux patterns « org du caller » (getOrgId dans
// createQuickAction, user.organization_id dans planAction), les SEPT gestes qui
// n'avaient AUCUNE frontière d'org (rôle seul) en reçoivent une. Frontière
// unique, factorisée : `requireSiteWriteAccess` / `requireSiteActionWriteAccess`
// (org de la ressource → membership actif → politique write existante).

const racine = process.cwd()
const actions = readFileSync(join(racine, 'app/(dashboard)/actions/actions.ts'), 'utf8')
const code = actions.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const writeAccess = readFileSync(join(racine, 'lib/auth/site-write-access.ts'), 'utf8')

describe('les primitives d’écriture, pas de SQL ni de memberships dans les actions', () => {
  it('actions.ts ne lit JAMAIS organization_memberships directement', () => {
    expect(code).not.toMatch(/organization_memberships/)
  })

  it('aucune comparaison à user.organization_id ne subsiste', () => {
    expect(code).not.toMatch(/user\.organization_id/)
  })

  it('les deux primitives sont importées et utilisées', () => {
    expect(actions).toMatch(/import \{ requireSiteWriteAccess, requireSiteActionWriteAccess \}/)
    expect(code).toMatch(/requireSiteActionWriteAccess\(/)
    expect(code).toMatch(/requireSiteWriteAccess\(/)
  })
})

describe('getOrgId : réduit au SEUL point classé M3, et annoté', () => {
  it('un seul appel getOrgId() subsiste dans le fichier', () => {
    const appels = code.match(/getOrgId\s*\(/g) ?? []
    expect(appels.length).toBe(1)
  })

  it('ce point est listActiveTeamsForPlanningAction (signature sans ressource)', () => {
    const i = actions.indexOf('export async function listActiveTeamsForPlanningAction')
    const corps = actions.slice(i, i + 500)
    expect(corps).toMatch(/getOrgId\(\)/)
    // il est explicitement marqué M3 dans l'en-tête juste au-dessus.
    const entete = actions.slice(Math.max(0, i - 600), i)
    expect(entete).toMatch(/M3/)
  })
})

describe('la politique write : rôles EXISTANTS, source = l’organisation', () => {
  it('WRITE_POLICIES reprend exactement operator et managerOrAdmin, sans nouveau droit', () => {
    expect(writeAccess).toMatch(/operator:\s*\['admin',\s*'manager',\s*'chef_equipe'\]/)
    expect(writeAccess).toMatch(/managerOrAdmin:\s*\['admin',\s*'manager'\]/)
  })

  it('le rôle vérifié est celui de l’organisation (membershipRole), pas users.role', () => {
    const wcode = writeAccess.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(wcode).toMatch(/membershipRole/)
    expect(wcode).not.toMatch(/users\.role|user\.role/)
  })

  it('l’org vient de la ressource via la frontière M2B (resolveResourceAccess)', () => {
    expect(writeAccess).toMatch(/resolveResourceAccess/)
    expect(writeAccess.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/getOrgId/)
  })
})

describe('les gestes à deux ressources exigent la MÊME organisation', () => {
  for (const fn of ['associateActionToElementAction', 'planActionAction']) {
    it(`${fn} : action ET site, même organizationId`, () => {
      const i = actions.indexOf(`export async function ${fn}`)
      const corps = actions.slice(i, i + 1400)
      expect(corps).toMatch(/requireSiteActionWriteAccess\(/)
      expect(corps).toMatch(/requireSiteWriteAccess\(/)
      expect(corps).toMatch(/organizationId !== .*\.organizationId/)
    })
  }
})
