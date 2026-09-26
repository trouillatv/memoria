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
// PLAN-SEC-1 FINAL (mandat Vincent 2026-09-26, review du SHA e8a94b8f) :
// le trou cross-tenant brut de recurrences-actions.ts était fermé par le
// premier micro-fix (1. ci-dessus), mais la politique de rôle restait
// incorrecte : requireOwned(auth.role, ...) ne vérifie que l'appartenance de
// l'appelant à l'organisation de la mission, jamais son rôle DANS cette
// organisation — auth.role vient de users.role (profil global). Un compte
// manager au niveau plateforme mais chef_equipe (ou autre rôle non habilité)
// sur l'organisation propriétaire du chantier ciblé passait quand même les
// deux contrôles. Remplacé par requireSiteWriteAccess(mission.site_id,
// 'managerOrAdmin'), qui résout l'organisation ET le rôle dans cette même
// organisation. Couverture comportementale (mock du contexte organisationnel,
// pas un simple source-scan) : tests/actions/recurrences-actions.test.ts.
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

describe('PLAN-SEC-1 FINAL — recurrences-actions.ts résout le rôle dans l’organisation DU CHANTIER', () => {
  const src = read('app/(dashboard)/contracts/[id]/recurrences-actions.ts')

  it('createRecurrenceAction : requireSiteWriteAccess sur le site DE LA MISSION persistée, police managerOrAdmin', () => {
    const block = extractBlock(src, 'export async function createRecurrenceAction')
    expect(block).toMatch(/requireSiteWriteAccess\(mission\.site_id,\s*'managerOrAdmin'\)/)
  })

  it('updateRecurrenceAction : requireSiteWriteAccess sur le site de la mission DU TEMPLATE existant', () => {
    const block = extractBlock(src, 'export async function updateRecurrenceAction')
    expect(block).toMatch(/requireSiteWriteAccess\(mission\.site_id,\s*'managerOrAdmin'\)/)
  })

  it('archiveRecurrenceAction : requireSiteWriteAccess sur le site de la mission DU TEMPLATE existant', () => {
    const block = extractBlock(src, 'export async function archiveRecurrenceAction')
    expect(block).toMatch(/requireSiteWriteAccess\(mission\.site_id,\s*'managerOrAdmin'\)/)
  })

  it('les trois mutations importent requireSiteWriteAccess, plus jamais requireManagerOrAdmin/requireOwned comme politique de rôle', () => {
    expect(src).toMatch(/import \{ requireSiteWriteAccess \} from '@\/lib\/auth\/site-write-access'/)
    expect(src).not.toMatch(/requireManagerOrAdmin\(\)/)
    expect(src).not.toMatch(/requireOwned\(/)
  })

  it('ne fait jamais confiance à contract_id client pour l’autorisation', () => {
    // contract_id n'apparaît que dans les schémas Zod et les revalidatePath —
    // jamais passé à requireSiteWriteAccess ni à une fonction de garde.
    expect(src).not.toMatch(/requireSiteWriteAccess\([^)]*contract_id/)
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
