/**
 * P-UI-R2c — Dry-run de la voie sémantique (AUCUNE écriture).
 * Défaut : découvre le site Bella Napoli ; --site/--report pour un autre corpus.
 *
 * Prouve, avant tout branchement dans le trigger incrémental :
 *  - quelles paires non lexicales seraient soumises au juge (incrémental : sources = touchés) ;
 *  - combien d'appels LLM ;
 *  - combien de suggestions SERAIENT persistées (gate shouldPersistSemanticSuggestion) ;
 *  - qu'aucun acteur, aucune paire rejetée/pending/fusionnée, aucun doublon n'apparaît ;
 *  - que le coût est borné (cap).
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/dryrun-semantic-feed.ts [--site=<uuid>] [--report=<uuid>] [--cap=300]
 */

import { createClient } from '@supabase/supabase-js'
import { loadSimilarityContextSubjects } from '../lib/subjects/similarity-context'
import { runSemanticFeed } from '../lib/subjects/semantic-feed-run'
import { normalizePairKey } from '../lib/subjects/similarity-candidates'

const args = process.argv.slice(2)
const getArg = (n: string) => { const f = args.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=').slice(1).join('=') : null }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

function sep(l: string) { console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`) }

async function main() {
  // 1. Résoudre le site Bella Napoli
  let siteId = getArg('site')
  if (!siteId) {
    const { data } = await sb.from('sites').select('id, name').ilike('name', '%bella%napoli%')
    if (!data?.length) { console.error('Site Bella Napoli introuvable — passer --site=<uuid>'); process.exit(1) }
    siteId = data[0].id
    console.log(`Site : ${data[0].name} (${siteId})`)
  }

  // 2. Rapport d'import le plus récent (= "document qui vient d'être intégré")
  let reportId = getArg('report')
  if (!reportId) {
    const { data } = await sb.from('site_reports').select('id, report_date, created_at').eq('site_id', siteId).order('report_date', { ascending: false }).limit(1)
    if (!data?.length) { console.error('Aucun site_report — passer --report=<uuid>'); process.exit(1) }
    reportId = data[0].id
    console.log(`Rapport le plus récent : ${data[0].report_date ?? data[0].created_at} (${reportId})`)
  }

  // 3. Sujets touchés par cet import = occurrences dont source_ref_id = reportId
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id').eq('source_ref_id', reportId)
  const touchedSubjectIds = [...new Set((occ ?? []).map((o) => o.canonical_subject_id as string))]
  console.log(`Sujets touchés par l'import : ${touchedSubjectIds.length}`)

  // 4. Contexte (business-only, acteurs déjà exclus)
  const subjects = await loadSimilarityContextSubjects(siteId!)
  console.log(`Sujets métier actifs (cibles) : ${subjects.length}`)
  const businessIds = new Set(subjects.map((s) => s.forCandidates.id))
  const touchedBusiness = touchedSubjectIds.filter((id) => businessIds.has(id))
  console.log(`Sujets touchés retenus comme sources (business/actifs) : ${touchedBusiness.length}`)

  // 5. Paires rejetées
  const { data: rejected } = await sb.from('canonical_subject_similarity_suggestion').select('subject_a_id, subject_b_id').eq('site_id', siteId).eq('status', 'rejected')
  const rejectedPairs = new Set((rejected ?? []).map((r) => normalizePairKey(r.subject_a_id, r.subject_b_id)))

  const cap = getArg('cap') ? Number(getArg('cap')) : undefined

  // 6. Dry-run
  sep('DRY-RUN voie sémantique (aucune écriture)')
  const summary = await runSemanticFeed(subjects, {
    siteId: siteId!,
    touchedSubjectIds: touchedBusiness,
    rejectedPairs,
    cap,
    dryRun: true,
    onPairAnalyzed: ({ aLabel, bLabel, result, persistable }) => {
      const tag = persistable ? '✅ PERSISTABLE' : '·'
      console.log(`  ${tag} [${result.verdict}/${result.recommendation} SOH=${result.same_object_hypothesis} ${result.score}%] "${aLabel}" ↔ "${bLabel}" — ${result.reason}`)
    },
  })

  sep('TABLEAU par sujet touché')
  console.log('Sujet touché | Candidats évalués | Appels LLM | Suggestions persistables')
  for (const r of summary.perSource) {
    console.log(`  ${r.label} | ${r.evaluated} | ${r.llmCalls} | ${r.persistable}`)
  }

  sep('RÉSUMÉ')
  console.log(`Sources : ${summary.sourceCount} | Cibles : ${summary.targetCount}`)
  console.log(`Paires candidates (après exclusions) : ${summary.evaluatedPairCount} | cap=${summary.cap} | capped=${summary.capped}`)
  console.log(`Appels LLM : ${summary.llmCallCount}`)
  console.log(`Suggestions PERSISTABLES (gate) : ${summary.persistableCount}`)
  console.log(`Erreurs : ${summary.errorCount}`)
  if (summary.persistable.length) {
    sep('Suggestions qui SERAIENT créées')
    for (const p of summary.persistable) {
      console.log(`  "${p.aLabel}" ↔ "${p.bLabel}" — ${p.verdict}/${p.recommendation} SOH=${p.sameObjectHypothesis} ${p.score}% — ${p.reason}`)
    }
  } else {
    console.log('\n→ 0 suggestion persistable (attendu si Mall/food court déjà fusionné humainement).')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
