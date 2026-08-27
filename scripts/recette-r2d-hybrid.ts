/**
 * P-UI-R2d — Recette de la stratégie hybride sur Bella Napoli (AUCUNE écriture, aucune fusion).
 *
 * Deux chemins :
 *  A. Corpus dépassant le budget (import 2025 complet, 16 sujets touchés) → mode DEFER
 *     (aucun appel automatique, la recherche approfondie est proposée).
 *  B. Corpus sous le budget (1 sujet source : « Dégagement extérieur du Mall ») → mode AUTO,
 *     exécuté en dry-run pour prouver qu'une carte SERAIT produite (le témoin Largeur/Mall)
 *     sans rien fusionner ni persister.
 *
 * Usage : npx tsx --env-file=.env.local scripts/recette-r2d-hybrid.ts
 */

import { createClient } from '@supabase/supabase-js'
import { loadSimilarityContextSubjects } from '../lib/subjects/similarity-context'
import { buildSemanticFeedPlan, executeSemanticFeedPlan } from '../lib/subjects/semantic-feed-run'
import { decideSemanticFeedMode, SEMANTIC_FEED_AUTO_BUDGET } from '../lib/subjects/semantic-feed-candidates'

const SITE = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const REPORT_2025 = '68c3487e-a0f0-4932-945e-876997c364e6'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function main() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id').eq('source_ref_id', REPORT_2025)
  const touched = [...new Set((occ ?? []).map((o) => o.canonical_subject_id as string))]

  const subjects = await loadSimilarityContextSubjects(SITE)
  const business = new Set(subjects.map((s) => s.forCandidates.id))
  const touchedBusiness = touched.filter((id) => business.has(id))
  console.log(`Budget automatique = ${SEMANTIC_FEED_AUTO_BUDGET} paires. Sujets touchés (business) = ${touchedBusiness.length}. Cibles actives = ${subjects.length}.`)

  // ── Chemin A — corpus complet → DEFER ────────────────────────────────────────
  sep('CHEMIN A — import 2025 complet (attendu : DEFER, aucun appel automatique)')
  const planA = await buildSemanticFeedPlan(subjects, { siteId: SITE, touchedSubjectIds: touchedBusiness })
  const modeA = decideSemanticFeedMode(planA.plan.evaluatedPairCount, planA.plan.capped)
  console.log(`Paires candidates = ${planA.plan.evaluatedPairCount} · capped=${planA.plan.capped} · mode = ${modeA.toUpperCase()}`)
  console.log(modeA === 'defer'
    ? '✅ DEFER : rien lancé automatiquement, CTA « recherche approfondie » proposé.'
    : `❌ attendu defer, obtenu ${modeA}`)

  // ── Chemin B — 1 sujet source → AUTO (dry-run) ───────────────────────────────
  sep('CHEMIN B — 1 sujet source « Dégagement extérieur du Mall » (attendu : AUTO → 1 carte)')
  const mall = subjects.find((s) => /d[ée]gagement ext[ée]rieur du mall/i.test(s.forCandidates.label))
  if (!mall) { console.log('⚠️ sujet « Dégagement extérieur du Mall » introuvable — recette B ignorée'); return }
  const source = [mall.forCandidates.id]
  const planB = await buildSemanticFeedPlan(subjects, { siteId: SITE, touchedSubjectIds: source })
  const modeB = decideSemanticFeedMode(planB.plan.evaluatedPairCount, planB.plan.capped)
  console.log(`Source = "${mall.forCandidates.label}" · paires = ${planB.plan.evaluatedPairCount} · mode = ${modeB.toUpperCase()}`)
  if (modeB !== 'auto') { console.log(`❌ attendu auto, obtenu ${modeB}`); return }

  const summary = await executeSemanticFeedPlan(subjects, planB, { siteId: SITE, touchedSubjectIds: source, dryRun: true })
  console.log(`Appels LLM = ${summary.llmCallCount} · persistables (dry-run, RIEN écrit) = ${summary.persistableCount}`)
  for (const p of summary.persistable) {
    console.log(`  ✅ "${p.aLabel}" ↔ "${p.bLabel}" — ${p.verdict}/${p.recommendation} SOH=${p.sameObjectHypothesis} ${p.score}% — ${p.reason}`)
  }
  console.log(summary.persistableCount > 0
    ? '✅ AUTO produirait une carte « Même sujet ? » — sans aucune fusion automatique.'
    : 'ℹ️ 0 carte (le juge n’a pas retenu d’hypothèse de même objet cette fois).')
}

main().catch((e) => { console.error(e); process.exit(1) })
