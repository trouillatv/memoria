import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C surface 5a (reserves) : quatre écritures qui n'avaient PAS de frontière ─
//
// Avant : rôle seul (`chef_equipe` interdit), aucun contrôle d'appartenance —
// écriture inter-tenants ouverte. Après : `requireSiteWriteAccess(siteId,
// 'managerOrAdmin')` sur les quatre ; et une réserve/un document désigné doit
// appartenir à CE chantier / cette org (pas d'identifiant étranger sous un
// siteId légitime).

const src = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/reserves/actions.ts'), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('plus aucune écriture réserve sans frontière d’org', () => {
  it('aucun getOrgId / user.organization_id / getCurrentUserWithProfile', () => {
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/user\.organization_id/)
    expect(code).not.toMatch(/getCurrentUserWithProfile/)
  })

  it('les quatre gestes passent requireSiteWriteAccess(siteId, managerOrAdmin)', () => {
    const uses = code.match(/requireSiteWriteAccess\([^,]+,\s*'managerOrAdmin'\)/g) ?? []
    expect(uses.length).toBe(4)
  })
})

describe('intégrité : la ressource désignée appartient bien à ce chantier', () => {
  it('lift / corrective / linkDoc vérifient reserveOnSite', () => {
    for (const fn of ['liftReserveAction', 'addCorrectiveActionAction', 'linkDocumentToReserveAction']) {
      const i = src.indexOf(`export async function ${fn}`)
      const corps = src.slice(i, i + 900)
      expect(corps, `${fn} sans reserveOnSite`).toMatch(/reserveOnSite\(/)
    }
  })

  it('le document lié doit être de la même organisation que le chantier', () => {
    const i = src.indexOf('export async function linkDocumentToReserveAction')
    const corps = src.slice(i, i + 1100)
    expect(corps).toMatch(/organization_id.*!==.*access\.organizationId|access\.organizationId/)
    expect(corps).toMatch(/from\('documents'\)/)
  })

  // Régression : reserveOnSite() interrogeait 'site_reserves' (pluriel), une
  // table qui n'existe pas (la table réelle est 'site_reserve', singulier —
  // migration 110_site_reserve.sql, cohérent avec lib/db/site-reserve.ts et
  // lib/knowledge/live-debrief.ts). Conséquence : reserveOnSite renvoyait
  // TOUJOURS false, donc liftReserveAction/addCorrectiveActionAction/
  // linkDocumentToReserveAction échouaient systématiquement avec « Réserve
  // introuvable », avant même d'atteindre la mutation réelle.
  it("reserveOnSite interroge bien la table singulière 'site_reserve'", () => {
    const i = src.indexOf('async function reserveOnSite')
    const corps = src.slice(i, i + 300)
    expect(corps).toMatch(/from\('site_reserve'\)/)
    expect(corps).not.toMatch(/from\('site_reserves'\)/)
  })
})
