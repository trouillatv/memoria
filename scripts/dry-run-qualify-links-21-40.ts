/**
 * Dry-run qualification LLM — top 21–40 Pool B (second échantillon de calibration)
 *
 * Pipeline complet calibré :
 *   cooccurrence ≥ 3 PVs + lift ≥ 1.5 → exclusion kf↔kf → exclusion confirmed/rejected
 *   → guard same_subject (5 signaux, score ≥ 3 → possible_same_subject)
 *   → indicateur qualité extrait (semanticEvidence vs cooccurrenceEvidence)
 *   → qualification Gemini (doctrine V2 : anti-contingence + anti-cooccurrence)
 *   → no_relation / relates_to / directionnel
 *
 * Objectif : comparer avec les paires 1–20 pour décider si les seuils sont stables.
 *
 * Aucune écriture en base.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/dry-run-qualify-links-21-40.ts
 */

import { createClient } from '@supabase/supabase-js'
import { qualifyLinkCandidate } from '../lib/ai/qualify-link-candidates'
import type { CandidatePair, PairEvidence } from '../lib/ai/qualify-link-candidates'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) { console.error('[FATAL] env manquantes'); process.exit(1) }
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID  = '2c939e67-e986-4635-86a0-638cda870480'
const MIN_LIFT = 1.5
const MIN_RUNS = 3
const OFFSET   = 20   // skip top-20, start at rank 21
const BATCH    = 20   // analyse 21–40

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Guard same-subject ────────────────────────────────────────────────────────

function normalizeText(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokenSet(s: string, minLen = 2) {
  return new Set(normalizeText(s).split(' ').filter(t => t.length >= minLen))
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 1
  const inter = [...a].filter(t => b.has(t)).length
  return inter / new Set([...a, ...b]).size
}
function extractCodes(label: string) {
  const m = label.match(/[A-Z]{2,}[\s.]*\d[\d.]+|\d[\d.]+[\s.]*[A-Z]{2,}/g) ?? []
  return new Set(m.map(s => s.replace(/\s+/g, '').toLowerCase()))
}

function computeSignals(
  labelA: string, labelB: string, countA: number, countB: number, countAB: number,
  excerpts: Array<{ excerptA: string; excerptB: string }>,
) {
  const tokA = tokenSet(labelA); const tokB = tokenSet(labelB)
  const nA = normalizeText(labelA); const nB = normalizeText(labelB)
  const excerptJaccards = excerpts.map(e =>
    jaccard(tokenSet(e.excerptA, 3), tokenSet(e.excerptB, 3))
  )
  return {
    labelJaccard:       jaccard(tokA, tokB),
    labelContainment:   nA.includes(nB) || nB.includes(nA),
    runOverlapRatio:    countAB / Math.max(countA, countB),
    excerptMatchRatio:  excerpts.length > 0
      ? excerptJaccards.filter(j => j >= 0.80).length / excerpts.length : 0,
    technicalCodeMatch: (() => {
      const cA = extractCodes(labelA); const cB = extractCodes(labelB)
      return cA.size > 0 && cB.size > 0 && [...cA].some(c => cB.has(c))
    })(),
  }
}

function applyGuard(signals: ReturnType<typeof computeSignals>) {
  let score = 0
  if (signals.labelJaccard       >= 0.70) score++
  if (signals.labelContainment)             score++
  if (signals.runOverlapRatio    >= 0.90) score++
  if (signals.excerptMatchRatio  >= 0.75) score++
  if (signals.technicalCodeMatch)           score++
  return { score, decision: score >= 3 ? 'possible_same_subject' as const : 'pass_to_llm' as const }
}

// ── Qualité extrait (semanticEvidence signal) ─────────────────────────────────

function excerptRichness(excerpt: string | null, label: string): 'rich' | 'thin' {
  if (!excerpt) return 'thin'
  const norm = normalizeText(excerpt)
  const normLabel = normalizeText(label)
  // Thin si le texte de l'extrait est quasi identique au label (pas de contexte supplémentaire)
  const extra = norm.replace(normLabel, '').trim()
  if (extra.length < 25) return 'thin'
  return 'rich'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Dry-run qualification — top 21–40 Pool B ===')
  console.log(`Site : ${SITE_ID}\n`)

  // 1. Canonical subjects actifs
  const { data: canonicals, error: eCS } = await supabase
    .from('canonical_subject').select('id, label, aliases, status')
    .eq('site_id', SITE_ID).eq('status', 'active')
  if (eCS) { console.error('[FATAL]', eCS.message); process.exit(1) }
  const csSet   = new Set((canonicals ?? []).map(c => c.id))
  const csLabel = new Map((canonicals ?? []).map(c => [c.id, c.label as string]))

  // 2. Thread → canonical
  const { data: sti } = await supabase
    .from('subject_thread_identity').select('subject_thread_id, canonical_subject_id')
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
  const runDate      = new Map((runs ?? []).map(r => [r.id, r.created_at?.slice(0, 10) ?? '?']))
  const canonicalRunIds = (runs ?? []).map(r => r.id)
  const N = canonicalRunIds.length
  console.log(`N (PVs) : ${N}`)

  // 4. Propositions
  const allProps: { subject_thread_id: string; extraction_run_id: string; proposal_family: string; source_excerpt: string | null; id: string }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase.from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, proposal_family, source_excerpt')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
      .not('proposal_family', 'in', '(person,company)')
    allProps.push(...(data ?? []))
  }
  console.log(`Propositions : ${allProps.length}`)

  // 5. Structures
  const runToCS      = new Map<string, Set<string>>()
  const csRunSet     = new Map<string, Set<string>>()
  const csFamily     = new Map<string, Map<string, number>>()
  const runCsData    = new Map<string, Map<string, { excerpt: string | null; propId: string }>>()

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
    if (!runCsData.has(p.extraction_run_id)) runCsData.set(p.extraction_run_id, new Map())
    if (!runCsData.get(p.extraction_run_id)!.has(csId) && p.source_excerpt) {
      runCsData.get(p.extraction_run_id)!.set(csId, { excerpt: p.source_excerpt, propId: p.id })
    }
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
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j])
        if (!pairRuns.has(key)) pairRuns.set(key, new Set())
        pairRuns.get(key)!.add(runId)
      }
  }

  // 7. Liens existants
  const { data: existingLinks } = await supabase
    .from('subject_thread_links').select('from_thread_id, to_thread_id, status, link_type')
    .eq('site_id', SITE_ID)
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

  // 8. Pool B trié
  const poolB: { key: string; a: string; b: string; countA: number; countB: number; countAB: number; lift: number; confAB: number; confBA: number; combined: number; famA: string; famB: string }[] = []
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
    poolB.push({ key, a, b, countA, countB, countAB, lift, confAB: countAB / countA, confBA: countAB / countB, combined: lift * (countAB / N), famA, famB })
  }
  const sortedPoolB = poolB.sort((x, y) => y.combined - x.combined || y.lift - x.lift)
  const batch = sortedPoolB.slice(OFFSET, OFFSET + BATCH)
  console.log(`Pool B total : ${poolB.length} paires  →  positions ${OFFSET + 1}–${OFFSET + batch.length} analysées\n`)

  // ── Compteurs ──────────────────────────────────────────────────────────────
  let nSameSubject = 0, nNoRelation = 0, nRelatesTo = 0, nDirectional = 0, nError = 0, nAboveThreshold = 0

  for (let idx = 0; idx < batch.length; idx++) {
    const p = batch[idx]
    const rank   = OFFSET + idx + 1
    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b
    const alreadySuggested = suggestedPairs.has(p.key)

    // Extraits communs (max 4, les plus récents)
    const commonRuns = [...(pairRuns.get(p.key) ?? [])]
    const excerptMap: PairEvidence[] = commonRuns
      .map(runId => ({
        runId,
        runDate: runDate.get(runId) ?? '?',
        excerptA: runCsData.get(runId)?.get(p.a)?.excerpt ?? '',
        excerptB: runCsData.get(runId)?.get(p.b)?.excerpt ?? '',
        proposalIdA: runCsData.get(runId)?.get(p.a)?.propId ?? '',
        proposalIdB: runCsData.get(runId)?.get(p.b)?.propId ?? '',
      }))
      .filter(e => e.excerptA || e.excerptB)
      .slice(0, 4)

    // Guard same-subject
    const commonExcerpts = excerptMap.map(e => ({ excerptA: e.excerptA, excerptB: e.excerptB }))
    const signals = computeSignals(labelA, labelB, p.countA, p.countB, p.countAB, commonExcerpts)
    const guard   = applyGuard(signals)

    // Qualité evidence
    const richA = excerptMap.some(e => excerptRichness(e.excerptA, labelA) === 'rich')
    const richB = excerptMap.some(e => excerptRichness(e.excerptB, labelB) === 'rich')
    const evidenceQuality = richA && richB ? 'semantic' : richA || richB ? 'partial' : 'cooccurrence'

    // Affichage en-tête
    console.log(`[${String(rank).padStart(2)}] "${labelA.slice(0, 45)}"`)
    console.log(`     ↔  "${labelB.slice(0, 45)}"`)
    console.log(`     ${p.famA} ↔ ${p.famB}  |  cA=${p.countA} cB=${p.countB} cAB=${p.countAB}  lift=${p.lift.toFixed(2)}  conf=${p.confAB.toFixed(2)}/${p.confBA.toFixed(2)}`)
    if (alreadySuggested) process.stdout.write('     ★ Déjà suggested\n')

    // Signaux guard
    const guardParts = []
    if (signals.labelJaccard >= 0.40) guardParts.push(`Jaccard=${signals.labelJaccard.toFixed(2)}${signals.labelJaccard >= 0.70 ? ' ★' : ''}`)
    if (signals.labelContainment) guardParts.push('Containment ★')
    if (signals.runOverlapRatio >= 0.80) guardParts.push(`RunOverlap=${signals.runOverlapRatio.toFixed(2)}${signals.runOverlapRatio >= 0.90 ? ' ★' : ''}`)
    if (signals.excerptMatchRatio > 0) guardParts.push(`ExcerptMatch=${(signals.excerptMatchRatio * 100).toFixed(0)}%${signals.excerptMatchRatio >= 0.75 ? ' ★' : ''}`)
    if (signals.technicalCodeMatch) guardParts.push('CodeMatch ★')
    console.log(`     Guard : ${guardParts.join('  |  ') || '(aucun signal)'}  →  score ${guard.score}/5  |  Evidence: ${evidenceQuality}`)

    if (guard.decision === 'possible_same_subject') {
      console.log(`     → POSSIBLE_SAME_SUBJECT — pipeline fusion, aucun lien créé`)
      nSameSubject++
      console.log()
      await sleep(300)
      continue
    }

    if (excerptMap.length === 0) {
      console.log(`     → SKIP — aucun extrait disponible`)
      nError++
      console.log()
      continue
    }

    // Qualification LLM
    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: p.famA,
      csIdB: p.b, labelB, famB: p.famB,
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence: excerptMap,
    }

    process.stdout.write(`     ↳ LLM...\n`)
    const result = await qualifyLinkCandidate(pair)

    if (!result) {
      console.log(`     → ERREUR Gemini`)
      nError++
    } else {
      const { linkType, direction, confidence, justification } = result
      const confStr = `${(confidence * 100).toFixed(0)} %`
      const dirStr  = direction === 'A_to_B' ? `A→B` : direction === 'B_to_A' ? `B→A` : direction
      const justShort = justification.slice(0, 110)

      if (linkType === 'no_relation') {
        nNoRelation++
        console.log(`     → no_relation (${confStr}) — ${justShort}`)
      } else if (linkType === 'relates_to') {
        nRelatesTo++
        if (confidence >= 0.70) nAboveThreshold++
        console.log(`     → relates_to (${confStr}) — ${justShort}`)
      } else {
        nDirectional++
        if (confidence >= 0.70) nAboveThreshold++
        console.log(`     → ${linkType} [${dirStr}] (${confStr}) — ${justShort}`)
      }
    }

    console.log()
    await sleep(600)
  }

  // ── Récapitulatif ─────────────────────────────────────────────────────────────
  console.log('═'.repeat(80))
  console.log(`  RÉCAPITULATIF TOP ${OFFSET + 1}–${OFFSET + batch.length}`)
  console.log('═'.repeat(80))
  console.log(`  possible_same_subject : ${nSameSubject}`)
  console.log(`  no_relation           : ${nNoRelation}`)
  console.log(`  relates_to            : ${nRelatesTo}`)
  console.log(`  directionnels         : ${nDirectional}`)
  console.log(`  erreurs/sans extrait  : ${nError}`)
  console.log(`  ─────────────────────────────`)
  console.log(`  total analysés        : ${batch.length}`)
  console.log(`  au-dessus seuil (≥ 70%) : ${nAboveThreshold}`)
  console.log()
  console.log('[DRY-RUN] Aucune écriture dans subject_thread_links.')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
