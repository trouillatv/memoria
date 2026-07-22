import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// M3-D — SUR UNE FICHE CHANTIER PRÉCISE, LA RESSOURCE DÉTERMINE L'ORGANISATION.
//
// Doctrine : /sites/[id] est déjà gardée en amont (getSiteIdentity → notFound).
// Ses loaders ne doivent donc PAS agréger (getOrgIdsOfUser) ni appeler getOrgId()
// (qui lève pour un compte multi-org et faisait planter la page). Le contexte
// vient de la RESSOURCE ouverte :
//   · loaders scopés par la ressource (siteId/actionId/decisionId) → aucune org ;
//   · loaders qui ont besoin de l'org → membership sur site.organization_id ;
//   · les catch ne masquent JAMAIS une portée : plus de `() => []` / `() => null`
//     nu ; seule une vraie panne technique reste tolérée, et elle est tracée.

const racine = process.cwd()
const lire = (p: string) => readFileSync(join(racine, p), 'utf8')

const siteGraph = lire('lib/knowledge/site-graph.ts')
const actionFiche = lire('lib/knowledge/action-fiche.ts')
const decisionFiche = lire('lib/knowledge/decision-fiche.ts')
const siteActions = lire('lib/db/site-actions.ts')
const interventions = lire('lib/db/interventions.ts')
const page = lire('app/(dashboard)/sites/[id]/page.tsx')

describe('les 3 fiches (graph/action/décision) : accès par la ressource, jamais getOrgId', () => {
  const fiches: Array<[string, string]> = [
    ['site-graph', siteGraph],
    ['action-fiche', actionFiche],
    ['decision-fiche', decisionFiche],
  ]

  for (const [nom, src] of fiches) {
    it(`${nom} : n'IMPORTE ni n'APPELLE plus getOrgId()`, () => {
      // getOrgId ne subsiste qu'en commentaire d'explication, jamais en import/appel.
      expect(src).not.toMatch(/import\s*\{[^}]*\bgetOrgId\b/)
      expect(src).not.toMatch(/\bawait\s+getOrgId\s*\(/)
    })

    it(`${nom} : vérifie l'appartenance à l'org DU chantier (fail-closed)`, () => {
      expect(src).toMatch(/requireOrganizationMembership\(/)
      // La garde lit l'org du site chargé, pas une org ambiante.
      expect(src).toMatch(/organization_id/)
    })
  }
})

describe('loaders partagés : le mode "ressource fournie" court-circuite getOrgId', () => {
  it('listOpenSiteActions : siteIds fourni → aucun getOrgId (fallback réservé à l’org-wide)', () => {
    const i = siteActions.indexOf('export async function listOpenSiteActions')
    const corps = siteActions.slice(i, i + 1200)
    // getOrgId n'est appelé QUE dans la branche ni-orgIds-ni-siteIds.
    expect(corps).toMatch(/else if \(!opts\?\.siteIds\)/)
  })

  it('listInterventionsSupervisor : siteId fourni → orgId null (missions du chantier = scope)', () => {
    const i = interventions.indexOf('export async function listInterventionsSupervisor')
    const corps = interventions.slice(i, i + 1200)
    expect(corps).toMatch(/query\.siteId \? null : await getOrgId\(\)/)
  })
})

describe('/sites/[id]/page.tsx : ni portée ambiante, ni catch masquant', () => {
  it('aucun getOrgId() sur le chemin de rendu de la page', () => {
    expect(page).not.toMatch(/getOrgId/)
  })

  it('aucun catch NU `() => []` ou `() => null` sur les loaders Lot D', () => {
    // Les catch conservés tracent la vraie panne ; plus de dégradation muette.
    expect(page).not.toMatch(/(listOpenSiteActions|listInterventionsSupervisor|getSiteActionFiche|getSiteDecisionFiche)\([^)]*\)\.catch\(\(\)\s*=>/)
  })

  it('getSiteGraph reste SANS catch (une vraie panne doit remonter)', () => {
    expect(page).not.toMatch(/getSiteGraph\([^)]*\)\.catch/)
  })
})
