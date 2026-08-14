// Dry-run P1-A — Préparation spontanée de visite depuis le moteur d'attention.
//
// Prouve, sur données réelles et EN LECTURE SEULE, que « prépare ma prochaine
// visite » dispose désormais d'un plan calculé par MemorIA sur un chantier sans
// PV analysé (PETRO ATTITI) — cas où l'ancien chemin (`overview.pvToVerify`
// seul) renvoyait une liste vide et faisait poser la question à l'utilisateur.
//
// Usage :
//   npx tsx scripts/dry-run-p1a-visit-plan.ts                     # PETRO ATTITI
//   npx tsx scripts/dry-run-p1a-visit-plan.ts --site <uuid>       # autre chantier
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { buildVisitBriefing } from '../lib/knowledge/visit-briefing'
import { getSiteOverview } from '../lib/knowledge/site-overview'
import {
  buildSiteCopilotContext,
  filterContextForIntent,
  isVisitPlanSignal,
  buildFallbackText,
} from '../lib/visits/copilot-context'

const args = process.argv.slice(2)
const idx = args.indexOf('--site')
const SITE_ID = idx >= 0 ? args[idx + 1] : '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATTITI

async function main() {
  const [overview, briefing] = await Promise.all([
    getSiteOverview(SITE_ID),
    buildVisitBriefing(SITE_ID),
  ])

  // NB : `identity.name` est vide hors session (RLS sur `sites`). Le reste de
  // l'overview provient de lecteurs admin et est bien chargé — vérifié : 10
  // actions actives sur PETRO. `pvToVerify = 0` est donc une vraie mesure, pas
  // un artefact d'authentification.
  console.log(`\n=== P1-A dry-run — ${overview.identity.name || SITE_ID} ===\n`)

  // AVANT : le plan ne pouvait venir que du moteur PV.
  console.log(`AVANT (overview.pvToVerify seul) : ${overview.pvToVerify.length} point(s)`)

  // APRÈS : moteur canonique + moteur PV.
  const eligible = briefing.allAttention.filter((i) => isVisitPlanSignal(i.signal))
  console.log(`APRÈS (moteur d'attention + PV)  : ${eligible.length} signal(aux) éligibles ` +
    `sur ${briefing.allAttention.length} bruts (${briefing.attention.length} après ranking UI)\n`)

  for (const item of eligible) {
    console.log(`  [${item.urgency}] ${item.signal} — ${item.title}`)
    if (item.reason) console.log(`      ${item.reason}`)
  }

  const context = buildSiteCopilotContext(
    SITE_ID,
    overview.identity.name,
    overview,
    [], // aucun plan humain : c'est précisément le cas testé
    briefing.allAttention,
  )
  const { items, prepItems } = filterContextForIntent(context, 'next_visit')

  console.log(`\nItems transmis au LLM pour next_visit : ${items.length}`)
  console.log(`Plan humain (prepItems)              : ${prepItems.length}\n`)
  console.log('--- Fallback déterministe (si le provider IA échoue) ---')
  console.log(buildFallbackText(items, 'next_visit', null, prepItems))

  console.log(
    items.length > 0
      ? '\n✓ MemorIA produit un plan sans rien demander à l\'utilisateur.'
      : '\n✗ Plan toujours vide — le moteur n\'a aucun signal sur ce chantier.',
  )
}

main().catch((e) => { console.error(e); process.exit(1) })
