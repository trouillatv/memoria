// Recette P1-A — « prépare ma prochaine visite » sur PETRO ATTITI.
//
// Rejoue le chemin EXACT de `askCopilotFreeAction` (compréhension → classification
// → contexte → visitPlanDetail → LLM) hors session, sans modifier ni le prompt ni
// le moteur. Lecture seule : aucune écriture, aucune télémétrie.
//
// Objet de la recette (Vincent, 2026-08-15) : le dry-run prouve « 0 → 5 points
// transmis ». Il ne prouve pas « 5 points → bon plan de visite ». Trois critères :
//   1. ne plus demander son plan à l'utilisateur ;
//   2. des points réellement actionnables sur le terrain (« vérifie si… »,
//      pas « ce sujet a changé ») ;
//   3. une priorité qui a du sens.
// Point de vigilance : « a changé depuis ma dernière visite » ≠ « doit être
// contrôlé sur place ». Un sujet résolu ne devrait pas devenir un point de
// contrôle ; un sujet immobile depuis 24 jours (Accès sécurisé / cadenas) devrait
// pouvoir en être un alors qu'il n'a précisément PAS changé.
//
// Usage : npx tsx scripts/recette-p1a-copilote-petro.ts [--site <uuid>]
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { classifyIntent } from '../lib/visits/copilot-classify'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { understandQuestion, mergeComprehension } from '../lib/visits/copilot-comprehension'
import { getSiteOverview } from '../lib/knowledge/site-overview'
import { buildVisitBriefing } from '../lib/knowledge/visit-briefing'
import {
  buildSiteCopilotContext,
  filterContextForIntent,
  isVisitPlanSignal,
  COPILOT_MAX_VISIT_PLAN,
} from '../lib/visits/copilot-context'
import { answerCopilotFreeQuestion, type FreeAnswerContext } from '../lib/visits/copilot-free-answer'
import { buildVisitPlan } from '../lib/visits/visit-plan-builder'

const args = process.argv.slice(2)
const i = args.indexOf('--site')
const SITE_ID = i >= 0 ? args[i + 1] : '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATTITI

const QUESTIONS = [
  "Qu'est-ce que je dois surveiller si j'y vais demain ?",
  'Prépare-moi ma visite de demain.',
  'Je vais sur le chantier demain, je vérifie quoi ?',
  'Fais-moi les points de contrôle pour ma prochaine visite.',
  "Qu'est-ce que je dois regarder en priorité sur place ?",
]

const INTENT_FILTER_MAP: Record<string, 'attention' | 'changes' | 'stale' | 'next_visit'> = {
  timeline: 'changes', plan_visite: 'next_visit', action_status: 'attention',
  subject_detail: 'attention', actor: 'attention', stagnation: 'stale', global: 'attention',
}

async function main() {
  const [overview, briefing] = await Promise.all([
    getSiteOverview(SITE_ID),
    buildVisitBriefing(SITE_ID),
  ])

  // ── Contexte injecté (identique pour les 5 questions) ──────────────────────
  const context = buildSiteCopilotContext(
    SITE_ID, overview.identity.name || 'PETRO ATTITI', overview,
    [], // hors session : aucun plan humain — c'est le cas testé
    briefing.allAttention,
  )

  // Depuis P1-A.1, la construction du plan n'est plus inline dans l'action
  // serveur : elle vient de `buildVisitPlan`. Le harnais appelle donc le même
  // module que l'app, sinon il recette autre chose que ce qui est livré.
  const visitPlanDetail = buildVisitPlan(
    briefing.allAttention.filter((s) => isVisitPlanSignal(s.signal)),
    overview.pvToVerify,
    COPILOT_MAX_VISIT_PLAN,
  )

  console.log('══════ CONTEXTE INJECTÉ (les 5 questions reçoivent le même) ══════\n')
  console.log(`visitPlanDetail — ${visitPlanDetail.length} contrôle(s) :`)
  visitPlanDetail.forEach((p, n) => {
    console.log(`  ${n + 1}. [${p.tierLabel} · ${p.priority}] ${p.label}`)
    console.log(`     check  : ${p.check}`)
    console.log(`     why    : ${p.why}`)
    console.log(`     état   : ${p.lastKnown ?? '—'}`)
    console.log(`     depuis : ${p.changeSinceLastVisit ?? '—'}`)
  })

  // Contrôle du point de vigilance : la stagnation est-elle représentée ?
  console.log(`\nStagnation mesurée par le briefing : ${briefing.stagnation.stagnantCount} sujet(s) stagnant(s)`)
  console.log(`  plus proche du seuil : ${briefing.stagnation.closest
    ? `« ${briefing.stagnation.closest.title} » à ${briefing.stagnation.closest.days} j`
    : '—'}`)
  const stagnantInPlan = visitPlanDetail.filter((p) => p.signals.includes('subject_stagnant'))
  console.log(`  dont présents dans le plan de visite : ${stagnantInPlan.length}`)
  console.log(`Signaux bruts du moteur : ${briefing.allAttention.map((s) => s.signal).join(', ') || '—'}`)

  // ── Rejeu des 5 formulations ───────────────────────────────────────────────
  for (const question of QUESTIONS) {
    console.log(`\n\n══════════════════════════════════════════════════════════`)
    console.log(`Q. ${question}`)
    console.log(`══════════════════════════════════════════════════════════`)

    const comprehension = await understandQuestion(question)
    const merged = mergeComprehension(question, classifyIntent(question), detectIntent(question), comprehension)
    const classification = merged.classification
    const safeIntent = INTENT_FILTER_MAP[classification.primary] ?? 'attention'
    console.log(`intent=${merged.intentResult.intent} | primaire=${classification.primary} → filtre=${safeIntent}`)

    // Fidélité du harnais : dans l'app, `intentResult.intent !== 'READ'` sort
    // AVANT toute lecture et renvoie un brouillon. La réponse imprimée ci-dessous
    // n'est alors PAS celle que l'utilisateur verrait.
    if (merged.intentResult.intent !== 'READ') {
      console.log('⚠️  routé en ÉCRITURE : l\'app renverrait un brouillon, pas un plan.')
      console.log('    (réponse ci-dessous = simulation lecture seule, non représentative)')
    }
    if (safeIntent !== 'next_visit') {
      console.log('⚠️  ne route PAS vers next_visit — visitPlanDetail non injecté')
    }

    const { items, delta, prepItems } = filterContextForIntent(context, safeIntent)
    const extra: FreeAnswerContext = safeIntent === 'next_visit' ? { visitPlanDetail } : {}

    const answer = await answerCopilotFreeQuestion(
      question, [], items, [], delta, prepItems,
      overview.identity.name || 'PETRO ATTITI', extra,
    )
    console.log(`\n--- Réponse (source=${answer.source}) ---`)
    console.log(answer.text)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
