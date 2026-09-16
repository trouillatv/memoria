/**
 * P0-INT-5 — recette du correctif d'alias sur listSiteIntervenants/getRoleActorMap.
 * Utilise les VRAIES fonctions de lib/db/site-intervenants.ts contre la base
 * reelle, sur le chantier temoin RUS DUMBEA MALL, avec le couple canon/alias
 * Clim Exp'Air / Clim'Expair (mig 407) et Lylo comme temoin de non-regression.
 * READ-ONLY — aucune ecriture.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { listSiteIntervenants, getRoleActorMap } from '../lib/db/site-intervenants'

const SITE = 'bebcdf12-fec0-44d8-858b-249ddea02db4' // RUS DUMBEA MALL
const CLIM_EXPAIR = "298927de-87f3-4c31-bdd6-538efd8e31ab" // canonique
const CLIM_EXPAIR_ALIAS = '2488c63a-5d7f-414d-bd70-883edb3c392f' // alias, mig 407

let failed = false
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`OK   — ${label}`)
  else { failed = true; console.log(`FAIL — ${label}`, detail ?? '') }
}

async function main() {
  const list = await listSiteIntervenants(SITE)

  const climRows = list.filter((i) => i.companyId === CLIM_EXPAIR || i.companyId === CLIM_EXPAIR_ALIAS)
  console.log(`\n=== Participations Clim Exp'Air (canon+alias) apres listSiteIntervenants : ${climRows.length} ===`)
  for (const r of climRows) console.log(`  id=${r.id} role=${r.role} companyId=${r.companyId} companyName="${r.companyName}"`)

  check('au moins une participation Clim Exp\'Air active', climRows.length > 0, climRows.length)
  check('toutes les participations resolvent vers le MEME companyId canonique', climRows.every((r) => r.companyId === CLIM_EXPAIR), [...new Set(climRows.map((r) => r.companyId))])
  check('toutes les participations affichent le MEME companyName canonique', climRows.every((r) => r.companyName === "Clim Exp'Air"), [...new Set(climRows.map((r) => r.companyName))])
  check('aucun alias n\'apparait plus comme identite separee (companyId alias absent)', !list.some((i) => i.companyId === CLIM_EXPAIR_ALIAS))

  const map = await getRoleActorMap(SITE)
  console.log('\n=== getRoleActorMap — entrees dont le libelle contient "Clim" ===')
  for (const [key, v] of map.entries()) {
    if (v.company.includes('Clim')) console.log(`  role="${key}" company="${v.company}"`)
  }
  const climEntries = [...map.entries()].filter(([, v]) => v.company.includes('Clim'))
  check('aucune entree "Clim Exp\'Air, Clim Exp\'Air" (auto-duplication par alias)', climEntries.every(([, v]) => !/(.+), \1$/.test(v.company) && v.company !== "Clim Exp'Air, Clim Exp'Air"), climEntries)

  console.log(failed ? '\n=== RECETTE : ECHEC ===' : '\n=== RECETTE : SUCCES ===')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
