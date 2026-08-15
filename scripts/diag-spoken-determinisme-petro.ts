// Diagnostic — la hiérarchie orale vient-elle du moteur ou du LLM ?
//
// Mandat Vincent (2026-08-15) : « Si deux contrôles sont retenus parce qu'ils ont
// objectivement le signal le plus fort, parfait. S'ils changent d'un appel Gemini
// à l'autre alors que les mêmes cinq contrôles et leurs signaux sont fournis, ce
// n'est pas bon. » Ce script tranche la question par l'expérience, pas par
// lecture de prompt : MÊME question, MÊME contexte, N appels.
//
// Il mesure trois choses et rien d'autre :
//   1. l'ordre déterministe produit par `buildVisitPlan` (la vérité métier) ;
//   2. quels contrôles chaque `spokenText` retient réellement ;
//   3. si la voix annonce l'étendue de la réponse (« cinq points »).
//
// Lecture seule : aucune écriture DB, aucune télémétrie, aucun prompt modifié.
//
// Usage : npx tsx scripts/diag-spoken-determinisme-petro.ts [--site <uuid>] [--runs 5]
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
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const SITE_ID = argOf('--site') ?? '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATTITI
const RUNS = Number(argOf('--runs') ?? 5)

// La question EXACTE posée au chantier — pas une reformulation « propre ».
const QUESTION = 'Que dois-je préparer pour ma réunion de demain ?'

const INTENT_FILTER_MAP: Record<string, 'attention' | 'changes' | 'stale' | 'next_visit'> = {
  timeline: 'changes', plan_visite: 'next_visit', action_status: 'attention',
  subject_detail: 'attention', actor: 'attention', stagnation: 'stale', global: 'attention',
}

/** Comparaison insensible aux accents, à la casse et à la ponctuation. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Un contrôle est « retenu » si la voix en nomme l'essentiel.
 *
 * Une proportion de mots communs ne marche pas ici : le LLM abrège (« la dépose
 * du SSI » pour un label de neuf mots), ce qui produit des faux négatifs, et
 * plusieurs labels partagent « gestion » ou « matériel », ce qui produit des faux
 * positifs. On identifie donc pour chaque label ses mots DISCRIMINANTS — ceux
 * qu'aucun autre contrôle ne porte — et on considère le contrôle nommé dès qu'un
 * de ces mots est prononcé.
 */
function discriminantsOf(labels: string[]): string[][] {
  const wordsPer = labels.map((l) => new Set(norm(l).split(' ').filter((w) => w.length > 3)))
  const count = new Map<string, number>()
  for (const set of wordsPer) for (const w of set) count.set(w, (count.get(w) ?? 0) + 1)
  return wordsPer.map((set) => [...set].filter((w) => count.get(w) === 1))
}

function mentions(spoken: string, discriminants: string[]): boolean {
  const s = norm(spoken)
  return discriminants.some((w) => s.includes(w))
}

const NUM_WORDS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix']

/** La voix dit-elle COMBIEN de points existent, avant d'en détailler deux ? */
function announcesTotal(spoken: string, total: number): boolean {
  const s = norm(spoken)
  const word = NUM_WORDS[total]
  return s.includes(String(total)) || (!!word && new RegExp(`\\b${word}\\b`).test(s))
}

async function main() {
  const tLoad = Date.now()
  const [overview, briefing] = await Promise.all([
    getSiteOverview(SITE_ID),
    buildVisitBriefing(SITE_ID),
  ])
  const msLoad = Date.now() - tLoad

  const context = buildSiteCopilotContext(
    SITE_ID, overview.identity.name || 'PETRO ATTITI', overview,
    [], briefing.allAttention,
  )

  const visitPlanDetail = buildVisitPlan(
    briefing.allAttention.filter((s) => isVisitPlanSignal(s.signal)),
    overview.pvToVerify,
    COPILOT_MAX_VISIT_PLAN,
  )

  // ── A. La vérité métier : ce que le moteur a hiérarchisé ────────────────────
  console.log('═'.repeat(78))
  console.log(`A. ORDRE DÉTERMINISTE DU MOTEUR — ${visitPlanDetail.length} contrôle(s)`)
  console.log('═'.repeat(78))
  visitPlanDetail.forEach((p, n) => {
    console.log(`  #${n + 1}  [${p.tier} · ${p.priority}] ${p.label}`)
    console.log(`      signaux : ${p.signals.join(', ')}`)
    console.log(`      why     : ${p.why}`)
    console.log(`      état    : ${p.lastKnown ?? '—'}`)
    console.log(`      depuis  : ${p.changeSinceLastVisit ?? '—'}`)
  })

  // ── B. Routage : le harnais rejoue-t-il bien le chemin de production ? ──────
  const tComp = Date.now()
  const comprehension = await understandQuestion(QUESTION)
  const msComp = Date.now() - tComp
  const merged = mergeComprehension(QUESTION, classifyIntent(QUESTION), detectIntent(QUESTION), comprehension)
  const classification = merged.classification
  const safeIntent = INTENT_FILTER_MAP[classification.primary] ?? 'attention'
  console.log('\n' + '═'.repeat(78))
  console.log(`B. ROUTAGE — « ${QUESTION} »`)
  console.log('═'.repeat(78))
  console.log(`  intent=${merged.intentResult.intent} | primaire=${classification.primary} → filtre=${safeIntent}`)
  if (merged.intentResult.intent !== 'READ') {
    console.log('  ⚠️  routé en ÉCRITURE : en production, brouillon et non plan de visite.')
  }
  if (safeIntent !== 'next_visit') {
    console.log('  ⚠️  ne route PAS vers next_visit — recommandations_memoria non injecté.')
  }

  const { items, delta, prepItems } = filterContextForIntent(context, safeIntent)
  const extra: FreeAnswerContext = safeIntent === 'next_visit' ? { visitPlanDetail } : {}

  // ── C. N appels, contexte strictement identique ─────────────────────────────
  console.log('\n' + '═'.repeat(78))
  console.log(`C. ${RUNS} APPELS — même question, même contexte`)
  console.log('═'.repeat(78))

  const retained: number[][] = []   // indices (0-based) des contrôles cités, par run
  const latencies: number[] = []
  const discriminants = discriminantsOf(visitPlanDetail.map((p) => p.label))
  console.log(`  (mots discriminants retenus pour la détection : `
    + `${discriminants.map((d, n) => `#${n + 1}=${d.slice(0, 3).join('/')}`).join(' · ')})`)

  for (let r = 1; r <= RUNS; r++) {
    const t0 = Date.now()
    const answer = await answerCopilotFreeQuestion(
      QUESTION, [], items, [], delta, prepItems,
      overview.identity.name || 'PETRO ATTITI', extra,
    )
    const ms = Date.now() - t0
    latencies.push(ms)

    const spoken = answer.spokenText
    const idx = spoken ? discriminants.map((d, n) => (mentions(spoken, d) ? n : -1)).filter((n) => n >= 0) : []
    retained.push(idx)

    console.log(`\n── run ${r}  (source=${answer.source} · ${ms} ms · ${spoken?.length ?? 0} car.)`)
    console.log(`   voix    : ${spoken ?? '(silencieuse)'}`)
    console.log(`   retenus : ${idx.length > 0 ? idx.map((n) => `#${n + 1}`).join(', ') : '(aucun label reconnu)'}`)
    console.log(`   annonce l'étendue (${visitPlanDetail.length}) : ${spoken && announcesTotal(spoken, visitPlanDetail.length) ? 'OUI' : 'non'}`)
  }

  // ── D. Verdict ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(78))
  console.log('D. VERDICT')
  console.log('═'.repeat(78))
  visitPlanDetail.forEach((p, n) => {
    const hits = retained.filter((idx) => idx.includes(n)).length
    console.log(`  #${n + 1} ${hits}/${RUNS}  ${p.label}`)
  })
  const signatures = new Set(retained.map((idx) => idx.join('|')))
  console.log(`\n  Sélections distinctes sur ${RUNS} appels : ${signatures.size}`)
  console.log(signatures.size === 1
    ? '  → STABLE : la voix retient toujours les mêmes contrôles.'
    : '  → VARIABLE : la hiérarchie orale est réinventée à chaque appel.')

  // Le moteur classe #1 en tête : une voix fidèle devrait commencer par lui.
  const topKept = retained.filter((idx) => idx.includes(0)).length
  console.log(`  Le contrôle #1 du moteur est cité dans ${topKept}/${RUNS} appels.`)

  // ── E. Décomposition de la latence serveur ─────────────────────────────────
  // Le badge `?voicedebug=1` mesure « texte → réponse » d'un seul bloc. Ici on
  // sait ce qu'il y a DANS ce bloc : trois étapes strictement sérielles, dont
  // deux appels LLM. Sans cette décomposition, optimiser reviendrait à deviner.
  if (latencies.length === 0) return
  const sorted = [...latencies].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log('\n' + '═'.repeat(78))
  console.log('E. LATENCE SERVEUR — décomposition (machine locale, hors réseau mobile)')
  console.log('═'.repeat(78))
  console.log(`  1. compréhension (LLM)          : ${msComp} ms`)
  console.log(`  2. contexte chantier (DB)       : ${msLoad} ms`)
  console.log(`  3. réponse + voix (LLM)         : médiane ${median} ms `
    + `(min ${sorted[0]} · max ${sorted[sorted.length - 1]})`)
  console.log(`  ─────────────────────────────────────────────`)
  console.log(`  Total « texte → réponse »       : ~${msComp + msLoad + median} ms`)
}

main().catch((e) => { console.error(e); process.exit(1) })
