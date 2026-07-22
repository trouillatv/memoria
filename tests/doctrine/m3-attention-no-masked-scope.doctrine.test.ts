import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// M3 — L'AttentionBlock ne doit plus AVALER une erreur de portée.
//
// Avant : getAttentionDigest appelait des helpers qui font `getOrgId()` (lève en
// multi-org) enveloppés dans `.catch(() => [])` → l'AttentionBlock pouvait
// afficher « rien » alors que des actions existent. Correctif : on PASSE `orgIds`
// aux helpers (ils ne lèvent plus), et les `catch` restants TRACENT (vraie panne
// seulement), jamais une dégradation silencieuse.

const racine = process.cwd()
const attention = readFileSync(join(racine, 'lib/db/attention.ts'), 'utf8')
const siteActions = readFileSync(join(racine, 'lib/db/site-actions.ts'), 'utf8')
const weekPlanning = readFileSync(join(racine, 'lib/db/week-planning.ts'), 'utf8')

describe('getAttentionDigest : le scope est passé, jamais masqué', () => {
  it('passe orgIds à listOpenSiteActions et à getWeekBySite', () => {
    expect(attention).toMatch(/listOpenSiteActions\(\{ siteIds, orgIds \}\)/)
    expect(attention).toMatch(/getWeekBySite\(week, orgIds\)/)
  })

  it('aucun catch NU `() => []` ne subsiste', () => {
    expect(attention).not.toMatch(/\.catch\(\(\)\s*=>\s*\[\]/)
  })

  it('une OrganisationAmbigueError REMONTE (jamais avalée en liste vide)', () => {
    // Le garde re-lève la faute de portée et ne trace/absorbe qu'une vraie panne.
    expect(attention).toMatch(/if \(e instanceof OrganisationAmbigueError\) throw e/)
    expect(attention).toMatch(/console\.error\(`\[attention\] \$\{label\}`/)
  })
})

describe('les helpers acceptent un scope multi-org explicite', () => {
  it('listOpenSiteActions : orgIds fourni → .in(organization_id), pas getOrgId', () => {
    const i = siteActions.indexOf('export async function listOpenSiteActions')
    const corps = siteActions.slice(i, i + 1400)
    expect(corps).toMatch(/orgIds\?: string\[\]/)
    expect(corps).toMatch(/if \(opts\?\.orgIds\)[^]*\.in\('organization_id', opts\.orgIds\)/)
  })

  it('listInterventionsForWeek : orgIds fourni → agrège sans getOrgId', () => {
    const i = weekPlanning.indexOf('export async function listInterventionsForWeek')
    const corps = weekPlanning.slice(i, i + 700)
    expect(corps).toMatch(/orgIds\?: string\[\]/)
    expect(corps).toMatch(/scopeOrgIds = orgIds/)
    expect(corps).toMatch(/\.in\('organization_id', scopeOrgIds\)|scopeOrgIds/)
  })

  it('getWeekBySite transmet orgIds au délégué', () => {
    expect(weekPlanning).toMatch(/getWeekBySite\(range: WeekRange, orgIds\?: string\[\]\)/)
    expect(weekPlanning).toMatch(/listInterventionsForWeek\(range, orgIds\)/)
  })
})
