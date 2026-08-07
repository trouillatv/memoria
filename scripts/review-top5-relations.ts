/**
 * Revue humaine — 5 paires relates_to (confidence ≥ 70 %) issues du top-20 Pool B
 *
 * Affiche pour chaque paire :
 *   - Labels complets + canonical IDs
 *   - Familles + occurrences
 *   - Extraits communs (jusqu'à 4)
 *   - Justification LLM + confidence (issues du dry-run précédent)
 *   - Statut existant dans subject_thread_links
 *
 * Aucune écriture en base.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/review-top5-relations.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] Variables d\'environnement manquantes')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID  = '2c939e67-e986-4635-86a0-638cda870480'
const MIN_LIFT = 1.5
const MIN_RUNS = 3

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

// Résultats LLM du dry-run précédent (hardcodés pour la revue)
const LLM_RESULTS: Record<number, { confidence: number; justification: string }> = {
  2:  { confidence: 0.80, justification: "Les deux sujets sont mentionnés ensemble dans les PVs, le rapport de mairie étant 'transmis par l'entreprise' en lien avec l'interdiction d'étaler les déblais." },
  7:  { confidence: 0.90, justification: "Les deux sujets sont quasiment identiques et sont mentionnés ensemble dans tous les PVs, indiquant une forte association documentée." },
  8:  { confidence: 0.80, justification: "Les deux sujets sont mentionnés dans les mêmes PVs et semblent faire partie des activités d'assainissement, mais les extraits ne prouvent pas de lien directionnel." },
  14: { confidence: 0.80, justification: "Les sujets co-occurrent dans les PVs, mais les extraits ne fournissent pas de preuve explicite d'une relation directionnelle entre l'avis G3 et le plan de VRD." },
  18: { confidence: 0.75, justification: "Les extraits montrent une co-présence des deux sujets dans les PVs, mais sans lien explicite de cause à effet, de dépendance ou de condition." },
}

async function main() {
  console.log('=== Revue top-5 relates_to — labels complets ===\n')

  // 1. Canonical subjects actifs
  const { data: canonicals, error: eCS } = await supabase
    .from('canonical_subject').select('id, label, aliases, status')
    .eq('site_id', SITE_ID).eq('status', 'active')
  if (eCS) { console.error('[FATAL]', eCS.message); process.exit(1) }
  const csSet   = new Set((canonicals ?? []).map(c => c.id))
  const csLabel = new Map((canonicals ?? []).map(c => [c.id, c.label as string]))
  const csAlias = new Map((canonicals ?? []).map(c => [c.id, (c.aliases ?? []) as string[]]))

  // 2. Thread → canonical
  const { data: sti } = await supabase
    .from('subject_thread_identity').select('subject_thread_id, canonical_subject_id, source, confidence')
    .eq('site_id', SITE_ID)
  const threadToCS = new Map<string, string>()
  for (const r of sti ?? []) {
    if (csSet.has(r.canonical_subject_id)) threadToCS.set(r.subject_thread_id, r.canonical_subject_id)
  }

  // 3. Runs canoniques
  const { data: runs } = await supabase
    .from('document_extraction_run').select('id, created_at')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  const runDate = new Map((runs ?? []).map(r => [r.id, r.created_at?.slice(0, 10) ?? '?']))
  const canonicalRunIds = (runs ?? []).map(r => r.id)
  const N = canonicalRunIds.length

  // 4. Propositions
  const allProps: {
    subject_thread_id: string; extraction_run_id: string
    proposal_family: string; source_excerpt: string | null
    id: string
  }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, proposal_family, source_excerpt')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
      .not('proposal_family', 'in', '(person,company)')
    allProps.push(...(data ?? []))
  }

  // 5. Structures
  const runToCS   = new Map<string, Set<string>>()
  const csRunSet  = new Map<string, Set<string>>()
  const csFamily  = new Map<string, Map<string, number>>()
  const runCsExcerpt = new Map<string, Map<string, string>>()  // runId → csId → excerpt

  for (const p of allProps) {
    const csId = threadToCS.get(p.subject_thread_id)
    if (!csId) continue
    if (!runToCS.has(p.extraction_run_id)) runToCS.set(p.extraction_run_id, new Set())
    runToCS.get(p.extraction_run_id)!.add(csId)
    if (!csRunSet.has(csId)) csRunSet.set(csId, new Set())
    csRunSet.get(csId)!.add(p.extraction_run_id)
    if (!csFamily.has(csId)) csFamily.set(csId, new Map())
    const fm = csFamily.get(csId)!
    fm.set(p.proposal_family, (fm.get(p.proposal_family) ?? 0) + 1)
    if (!runCsExcerpt.has(p.extraction_run_id)) runCsExcerpt.set(p.extraction_run_id, new Map())
    const existing = runCsExcerpt.get(p.extraction_run_id)!.get(csId)
    if (!existing && p.source_excerpt) runCsExcerpt.get(p.extraction_run_id)!.set(csId, p.source_excerpt)
  }

  const csFamilyBest = new Map<string, string>()
  for (const [id, fm] of csFamily) {
    let best = '?', bestN = 0
    for (const [f, n] of fm) { if (n > bestN) { best = f; bestN = n } }
    csFamilyBest.set(id, best)
  }

  // 6. Cooccurrences
  const pairRuns = new Map<string, Set<string>>()
  for (const [runId, csIds] of runToCS) {
    const arr = [...csIds]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j])
        if (!pairRuns.has(key)) pairRuns.set(key, new Set())
        pairRuns.get(key)!.add(runId)
      }
    }
  }

  // 7. Pool B + sort
  interface PairEntry {
    key: string; a: string; b: string
    countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number
    combined: number; famA: string; famB: string
  }
  const poolB: PairEntry[] = []
  const { data: existingLinks } = await supabase
    .from('subject_thread_links').select('from_thread_id, to_thread_id, status, link_type')
    .eq('site_id', SITE_ID)

  // canonical_subject → thread ids
  const csToThreads = new Map<string, string[]>()
  for (const [tid, csId] of threadToCS) {
    if (!csToThreads.has(csId)) csToThreads.set(csId, [])
    csToThreads.get(csId)!.push(tid)
  }

  const excludedPairs  = new Set<string>()
  const suggestedPairs = new Set<string>()
  for (const lk of existingLinks ?? []) {
    const fc = threadToCS.get(lk.from_thread_id)
    const tc = threadToCS.get(lk.to_thread_id)
    if (!fc || !tc) continue
    const key = pairKey(fc, tc)
    if (lk.status === 'confirmed' || lk.status === 'rejected') excludedPairs.add(key)
    if (lk.status === 'suggested') suggestedPairs.add(key)
  }

  for (const [key, runSet] of pairRuns) {
    const countAB = runSet.size
    if (countAB < MIN_RUNS) continue
    if (excludedPairs.has(key)) continue
    const [a, b] = key.split('|')
    const countA = csRunSet.get(a)?.size ?? 0
    const countB = csRunSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue
    const lift = (countAB * N) / (countA * countB)
    if (lift < MIN_LIFT) continue
    const famA = csFamilyBest.get(a) ?? '?'
    const famB = csFamilyBest.get(b) ?? '?'
    if (famA === 'knowledge_fact' && famB === 'knowledge_fact') continue
    poolB.push({
      key, a, b, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N), famA, famB,
    })
  }

  const top20 = poolB.sort((x, y) => y.combined - x.combined || y.lift - x.lift).slice(0, 20)

  // Positions (1-based) des relates_to au-dessus du seuil
  const TARGET_POSITIONS = [2, 7, 8, 14, 18]

  console.log('╔══════════════════════════════════════════════════════════════════════════╗')
  console.log('║  5 paires candidates — relates_to — conf ≥ 70 %                         ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')
  console.log()

  for (const pos of TARGET_POSITIONS) {
    const p = top20[pos - 1]
    if (!p) { console.log(`[${pos}] NON TROUVÉ`); continue }

    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b
    const aliasA = csAlias.get(p.a) ?? []
    const aliasB = csAlias.get(p.b) ?? []
    const llm    = LLM_RESULTS[pos]
    const alreadySuggested = suggestedPairs.has(p.key)

    // Extraits communs
    const commonRuns = [...(pairRuns.get(p.key) ?? [])]
    const excerpts = commonRuns
      .map(runId => ({
        date: runDate.get(runId) ?? '?',
        excerptA: runCsExcerpt.get(runId)?.get(p.a) ?? null,
        excerptB: runCsExcerpt.get(runId)?.get(p.b) ?? null,
      }))
      .filter(e => e.excerptA || e.excerptB)
      .slice(0, 4)

    // Lien existant détaillé
    const existingForPair = (existingLinks ?? []).filter(lk => {
      const fc = threadToCS.get(lk.from_thread_id)
      const tc = threadToCS.get(lk.to_thread_id)
      return fc && tc && pairKey(fc, tc) === p.key
    })

    console.log(`${'═'.repeat(78)}`)
    console.log(`  [${String(pos).padStart(2)}]  ${alreadySuggested ? '★ DÉJÀ SUGGESTED  ' : ''}conf = ${(llm.confidence * 100).toFixed(0)} %  |  link_type = relates_to`)
    console.log(`${'═'.repeat(78)}`)
    console.log()
    console.log(`  SUJET A`)
    console.log(`    ID      : ${p.a}`)
    console.log(`    Label   : "${labelA}"`)
    console.log(`    Aliases : ${aliasA.length ? aliasA.map(a => `"${a}"`).join(', ') : '(aucun)'}`)
    console.log(`    Famille : ${p.famA}  |  occurrences : ${p.countA}/${N} PVs`)
    console.log()
    console.log(`  SUJET B`)
    console.log(`    ID      : ${p.b}`)
    console.log(`    Label   : "${labelB}"`)
    console.log(`    Aliases : ${aliasB.length ? aliasB.map(a => `"${a}"`).join(', ') : '(aucun)'}`)
    console.log(`    Famille : ${p.famB}  |  occurrences : ${p.countB}/${N} PVs`)
    console.log()
    console.log(`  SIGNAL STATISTIQUE`)
    console.log(`    Co-présents : ${p.countAB}/${N} PVs  |  lift : ${p.lift.toFixed(2)}  |  conf A→B : ${p.confAB.toFixed(2)}  /  B→A : ${p.confBA.toFixed(2)}`)
    console.log()
    console.log(`  EXTRAITS COMMUNS (${excerpts.length}/${commonRuns.length} runs avec texte)`)
    for (const e of excerpts) {
      console.log(`    [${e.date}]`)
      if (e.excerptA) console.log(`      A : "${e.excerptA.slice(0, 180)}"`)
      if (e.excerptB) console.log(`      B : "${e.excerptB.slice(0, 180)}"`)
    }
    console.log()
    console.log(`  JUSTIFICATION LLM (conf = ${(llm.confidence * 100).toFixed(0)} %)`)
    console.log(`    "${llm.justification}"`)
    console.log()
    if (existingForPair.length > 0) {
      console.log(`  LIENS EXISTANTS EN BASE`)
      for (const lk of existingForPair) {
        const fc = threadToCS.get(lk.from_thread_id) ?? '?'
        const tc = threadToCS.get(lk.to_thread_id) ?? '?'
        console.log(`    ${lk.status.toUpperCase()}  type=${lk.link_type}  from=${fc.slice(0,8)}… → to=${tc.slice(0,8)}…`)
      }
    } else {
      console.log(`  LIENS EXISTANTS EN BASE : aucun`)
    }
    console.log()

    // Action recommandée
    if (alreadySuggested) {
      console.log(`  → ACTION : SKIP — lien already suggested en base (idempotence)`)
    } else {
      console.log(`  → ACTION : INSÉRER  relates_to  undirected  status=suggested  source=cooccurrence`)
    }
    console.log()
  }

  console.log('═'.repeat(78))
  console.log('  SYNTHÈSE')
  console.log('═'.repeat(78))
  console.log(`  Paires à insérer  : ${TARGET_POSITIONS.filter(pos => !suggestedPairs.has(top20[pos-1]?.key)).length}`)
  console.log(`  Déjà suggested    : ${TARGET_POSITIONS.filter(pos => suggestedPairs.has(top20[pos-1]?.key)).length}`)
  console.log(`  Total candidates  : 5`)
  console.log()
  console.log('[DRY-RUN] Aucune écriture.')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
