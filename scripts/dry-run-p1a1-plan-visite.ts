// Dry-run P1-A.1 — ce que le LLM reçoit désormais pour « prépare ma visite ».
// Lecture seule : rejoue le routage + `buildVisitPlan` sur un chantier réel.
//
// Usage : npx tsx scripts/dry-run-p1a1-plan-visite.ts [--site <uuid>]
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { classifyIntent } from '../lib/visits/copilot-classify'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { getSiteOverview } from '../lib/knowledge/site-overview'
import { buildVisitBriefing } from '../lib/knowledge/visit-briefing'
import { isVisitPlanSignal, COPILOT_MAX_VISIT_PLAN } from '../lib/visits/copilot-context'
import { buildVisitPlan } from '../lib/visits/visit-plan-builder'

const args = process.argv.slice(2)
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const SITE_ID = argOf('--site') ?? '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATTITI

const QUESTIONS = [
  'Fais-moi les points de contrôle pour ma prochaine visite',
  'Prépare-moi ma visite de demain.',
  "Qu'est-ce que je dois surveiller si j'y vais demain ?",
  'Je vais sur le chantier demain, je vérifie quoi ?',
  'Que vérifier sur place ?',
]

async function main() {
  console.log('\n──── Routage des 5 formulations ────')
  for (const q of QUESTIONS) {
    const d = detectIntent(q)
    const c = classifyIntent(q)
    const ok = d.intent === 'READ' && c.primary === 'plan_visite'
    console.log(`${ok ? '✓' : '✗'} intent=${d.intent}/${d.confidence} primary=${c.primary}  « ${q} »`)
  }

  const [overview, briefing] = await Promise.all([
    getSiteOverview(SITE_ID),
    buildVisitBriefing(SITE_ID),
  ])
  const plan = buildVisitPlan(
    (briefing?.allAttention ?? []).filter((i) => isVisitPlanSignal(i.signal)),
    overview.pvToVerify,
    COPILOT_MAX_VISIT_PLAN,
  )

  console.log(`\n──── recommandations_memoria — ${overview.identity.name} (${plan.length}) ────`)
  plan.forEach((c, n) => {
    console.log(`\n${n + 1}. [${c.tierLabel} · ${c.priority}] ${c.label}`)
    console.log(`   check   : ${c.check}`)
    console.log(`   why     : ${c.why}`)
    console.log(`   état    : ${c.lastKnown ?? '—'}`)
    console.log(`   depuis  : ${c.changeSinceLastVisit ?? '—'}`)
  })

  const whys = new Set(plan.map((c) => c.why))
  console.log(`\n« Pourquoi celui-là ? » distincts : ${whys.size}/${plan.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
