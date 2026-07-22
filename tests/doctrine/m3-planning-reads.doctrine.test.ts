import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// M3 Lot A — les LECTURES de /semaine et /mois agrègent sur les organisations de
// l'utilisateur (`getOrgIdsOfUser` + `.in`), jamais une org par défaut, et JAMAIS
// un chemin « scope absent → aucun filtre » (la fuite `buildMonthRows`). Les
// écritures (requireOwned) ne sont PAS touchées.

const racine = process.cwd()
const read = (p: string) => readFileSync(join(racine, p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('les pages /semaine et /mois n’appellent plus getOrgId', () => {
  for (const p of ['app/(dashboard)/(planning)/semaine/page.tsx', 'app/(dashboard)/(planning)/mois/page.tsx']) {
    it(`${p} : getOrgIdsOfUser, plus getOrgId ni user.organization_id`, () => {
      const code = strip(read(p))
      expect(code).not.toMatch(/getOrgId\s*\(/)
      expect(code).not.toMatch(/user\.organization_id/)
      expect(code).toMatch(/getOrgIdsOfUser\(\)/)
    })
  }
})

describe('buildMonthRows : la FUITE est fermée', () => {
  const src = read('lib/db/month-view.ts')
  it('plus de `getOrgId().catch(() => null)` (chemin scope-absent → aucun filtre)', () => {
    expect(src).not.toMatch(/getOrgId\(\)\.catch/)
    expect(src).not.toMatch(/getOrgId\s*\(/)
  })
  it('le filtre est FAIL-CLOSED : `!orgIds.includes(...)` (vide → rien), jamais `if (orgId && ...)`', () => {
    expect(src).toMatch(/!orgIds\.includes\(/)
    expect(src).not.toMatch(/if \(orgId && /)
  })
})

describe('les loaders de lecture agrègent (.in), fail-closed', () => {
  const cases: Array<[string, string]> = [
    ['lib/db/week-planning.ts', 'getWeekByTeam'],
    ['lib/db/week-vigilance.ts', 'getWeekVigilance'],
    ['lib/db/week-operational-signals.ts', 'getWeekOperationalSignals'],
    ['lib/db/teams.ts', 'listTeams'],
  ]
  for (const [file, fn] of cases) {
    it(`${fn} : getOrgIdsOfUser + .in('organization_id', orgIds)`, () => {
      const src = read(file)
      const i = src.indexOf(`export async function ${fn}`)
      const corps = src.slice(i, i + 1200)
      expect(corps).toMatch(/getOrgIdsOfUser\(\)/)
      expect(corps).toMatch(/\.in\('organization_id', orgIds\)/)
    })
  }

  it('plan-menu-data.fetch* prennent orgIds[] et filtrent en .in', () => {
    const src = read('app/(dashboard)/(planning)/semaine/plan-menu-data.ts')
    for (const fn of ['fetchMissionOptions', 'fetchSiteOptions', 'fetchTeamMemberCounts']) {
      expect(src, fn).toMatch(new RegExp(`${fn}\\(orgIds: string\\[\\]\\)`))
    }
    expect(strip(src)).not.toMatch(/\.eq\('organization_id'/)
  })
})

describe('les écritures ne sont pas touchées par ce lot', () => {
  it('les 3 fichiers d’actions planning restent sur requireManagerOrAdmin/requireOwned, sans getOrgIdsOfUser', () => {
    for (const f of ['actions', 'conflict-actions', 'occurrence-actions']) {
      const src = read(`app/(dashboard)/(planning)/semaine/${f}.ts`)
      expect(src, f).not.toMatch(/getOrgIdsOfUser/)
    }
  })
})
