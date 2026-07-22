import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C (surface cr-concretisation) : l'org vient de la RESSOURCE ───────────
//
// Le SECOND pattern du domaine chantier (le pattern B) : `open()` comparait
// `visit.organization_id` a `user.organization_id` — l'org PAR DEFAUT du profil.
// Fausse des qu'un compte appartient a deux entreprises (elle refusait a tort
// une visite SERVINOR a un profil dont l'org par defaut est AGP). Apres :
// membership actif a l'org de la visite, sans exemption de role. La politique
// write reste ce qu'elle etait (le geste passe par `open()`, garde partagee des
// deux server actions `prepareCrConcretisationAction` / `createFromCrAction`).

const src = readFileSync(
  join(process.cwd(), 'app/(field)/m/visite/[reportId]/cr/cr-concretisation-actions.ts'),
  'utf8',
)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('cr-concretisation ne compare plus a l’org du caller', () => {
  it('le pattern B a disparu du code : aucune comparaison a user.organization_id', () => {
    expect(code).not.toMatch(/user\.organization_id/)
  })

  it('aucun appel getOrgId() (le domaine chantier n’en depend plus)', () => {
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/import[^\n]*getOrgId/)
  })

  it('la frontiere est le membership a l’org de la visite', () => {
    expect(src).toMatch(/requireOrganizationMembership\(visit\.organization_id/)
  })

  it('la garde reste dans open(), partagee par les deux gestes serveur', () => {
    const open = src.slice(src.indexOf('async function open'), src.indexOf('async function open') + 1200)
    const garde = open.indexOf('requireOrganizationMembership')
    const lecture = open.indexOf('getVisitCrDocument')
    expect(garde).toBeGreaterThan(-1)
    expect(lecture).toBeGreaterThan(-1)
    expect(garde).toBeLessThan(lecture)
  })
})
