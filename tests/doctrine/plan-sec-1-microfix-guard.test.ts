// PLAN-SEC-1 — micro-fix (mandat Vincent 2026-09-26), 4 écarts relevés en
// revue sur le checkpoint 20b58494 :
//
//   1. recurrences-actions.ts mutait un template de récurrence en ne gardant
//      qu'un rôle global (requireManagerOrAdmin) — jamais l'organisation
//      RÉELLE de la mission ciblée par mission_id / existing.mission_id, venue
//      du client. Un UUID d'un autre tenant passait le rôle sans jamais être
//      confronté à son organisation.
//   2. listTeamsForSite() ne filtrait pas `active = false` : une équipe
//      désactivée restait proposée à un nouveau choix.
//   3. listFieldTeamsAction(siteId) ne prouvait pas que l'appelant appartient
//      à l'organisation du chantier ciblé avant de lister ses équipes.
//
// Tripwires structurels (pas de DB, pas de mock d'auth — cohérent avec
// tests/doctrine/document-actions-guard.test.ts et
// tests/doctrine/m3-mobile-multi-org.doctrine.test.ts) : si un futur refactor
// retire la garde, ces tests cassent avant la mise en prod.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

function extractBlock(src: string, name: string): string {
  const idx = src.indexOf(name)
  if (idx === -1) return ''
  const tail = src.slice(idx)
  const next = tail.slice(name.length).search(/\nexport (async )?function /)
  return next === -1 ? tail : tail.slice(0, name.length + next)
}

describe('PLAN-SEC-1 micro-fix — recurrences-actions.ts garde la mission RÉELLE', () => {
  const src = read('app/(dashboard)/contracts/[id]/recurrences-actions.ts')

  it('createRecurrenceAction : requireOwned sur mission_id fourni par le client', () => {
    const block = extractBlock(src, 'export async function createRecurrenceAction')
    expect(block).toMatch(/requireOwned\(auth\.role,\s*'missions',\s*parsed\.data\.mission_id\)/)
  })

  it('updateRecurrenceAction : requireOwned sur la mission DU TEMPLATE existant', () => {
    const block = extractBlock(src, 'export async function updateRecurrenceAction')
    expect(block).toMatch(/requireOwned\(auth\.role,\s*'missions',\s*existing\.mission_id\)/)
  })

  it('archiveRecurrenceAction : requireOwned sur la mission DU TEMPLATE existant', () => {
    const block = extractBlock(src, 'export async function archiveRecurrenceAction')
    expect(block).toMatch(/requireOwned\(auth\.role,\s*'missions',\s*existing\.mission_id\)/)
  })

  it('les trois mutations importent bien requireOwned depuis lib/auth/ownership', () => {
    expect(src).toMatch(/import \{ requireOwned \} from '@\/lib\/auth\/ownership'/)
  })
})

describe('PLAN-SEC-1 micro-fix — listTeamsForSite exclut les équipes désactivées', () => {
  it("filtre active = true (une équipe désactivée n'est plus proposée)", () => {
    const src = read('lib/db/teams.ts')
    const block = extractBlock(src, 'export async function listTeamsForSite')
    expect(block).toMatch(/\.eq\('active', true\)/)
  })
})

describe('PLAN-SEC-1 micro-fix — listFieldTeamsAction prouve l’accès au chantier avant de lister', () => {
  it('vérifie l’appartenance à l’organisation DU CHANTIER (siteId vient du client)', () => {
    const src = read('app/(field)/m/ponctuel-actions.ts')
    const block = extractBlock(src, 'export async function listFieldTeamsAction')
    expect(block).toMatch(/requireOrganizationMembership\(site\.organization_id\)/)
    expect(block).toMatch(/if \(!membership\.ok\) return \[\]/)
  })
})
