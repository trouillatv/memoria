import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C surface 5b : le pipeline de CR terrain passe la frontière ───────────
//
// ~16 gestes reposaient sur `requireFieldAgent()` (rôle seul). Chacun passe
// désormais la frontière de SA ressource : CR (site_report), site, action ou
// contrat. La politique 'operator' reprend EXACTEMENT l'ensemble field agent
// (admin/manager/chef_equipe). L'org d'un CR vient de sa ligne, jamais du
// `tenant_id` legacy.

const racine = process.cwd()
const src = readFileSync(join(racine, 'app/(field)/m/site/[siteId]/report-actions.ts'), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const moteur = readFileSync(join(racine, 'lib/auth/resource-access.ts'), 'utf8')

describe('plus aucune écriture CR sur le rôle seul', () => {
  it('requireFieldAgent a totalement disparu du pipeline', () => {
    expect(code).not.toMatch(/requireFieldAgent/)
  })

  it('aucun getOrgId / user.organization_id', () => {
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/user\.organization_id/)
  })

  it('chaque racine a sa frontière (CR, site, action, contrat)', () => {
    expect(code).toMatch(/requireSiteReportWriteAccess\(/)
    expect(code).toMatch(/requireSiteWriteAccess\(/)
    expect(code).toMatch(/requireSiteActionWriteAccess\(/)
    expect(code).toMatch(/requireContractWriteAccess\(/)
  })

  it('la proposition curée est résolue via SON compte-rendu', () => {
    const i = src.indexOf('export async function curateProposalAction')
    const corps = src.slice(i, i + 1500)
    expect(corps).toMatch(/site_report_proposals'\)[\s\S]*report_id/)
    expect(corps).toMatch(/requireSiteReportWriteAccess\(propReportId\)/)
  })
})

describe('le résolveur site_report : org de la ligne, jamais le tenant_id legacy', () => {
  it('résout organization_id puis retombe sur le site / le contrat', () => {
    const i = moteur.indexOf('async function resolveSiteReportOrganization')
    const corps = moteur.slice(i, i + 700)
    expect(corps).toMatch(/from\('site_reports'\)/)
    expect(corps).toMatch(/if \(r\.organization_id\) return r\.organization_id/)
    expect(corps).toMatch(/resolveSiteOrganization\(r\.site_id\)/)
    expect(corps).toMatch(/resolveContractOrganization\(r\.contract_id\)/)
  })

  it('ne lit JAMAIS le tenant_id pour décider l’accès', () => {
    const i = moteur.indexOf('async function resolveSiteReportOrganization')
    const corps = moteur.slice(i, i + 700)
    expect(corps).not.toMatch(/tenant_id/)
  })

  it('site_report est un kind résolu du moteur', () => {
    expect(moteur).toMatch(/site_report: resolveSiteReportOrganization/)
  })
})
