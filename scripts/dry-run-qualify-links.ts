/**
 * Dry-run qualification LLM v2 — guard same_subject + top-20 Pool B
 *
 * Deux sections :
 *   1. AUDIT   — analyse détaillée des paires [3] et [7] (doublons potentiels)
 *   2. TOP-20  — Pool B qualifié avec guard déterministe anti-doublon
 *
 * Aucune écriture en base.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/dry-run-qualify-links.ts
 */

import { createClient } from '@supabase/supabase-js'
import { qualifyLinkCandidate } from '../lib/ai/qualify-link-candidates'
import type { CandidatePair, PairEvidence } from '../lib/ai/qualify-link-candidates'

// ── Config ────────────────────────────────────────────────────────────────────

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
const TOP_N    = 20

// ── Guard same-subject ────────────────────────────────────────────────────────

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function normalizeText(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')       // déaccent
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function tokenSet(s: string, minLen = 2): Set<string> {
  return new Set(normalizeText(s).split(' ').filter(t => t.length >= minLen))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const inter = [...a].filter(t => b.has(t)).length
  const union  = new Set([...a, ...b]).size
  return inter / union
}

function extractCodes(label: string): Set<string> {
  const matches = label.match(/[A-Z]{2,}[\s.]*\d[\d.]+|\d[\d.]+[\s.]*[A-Z]{2,}/g) ?? []
  return new Set(matches.map(m => m.replace(/\s+/g, '').toLowerCase()))
}

interface SameSubjectSignals {
  labelJaccard:         number
  labelContainment:     boolean
  runOverlapRatio:      number   // countAB / max(countA, countB)
  excerptMatchRatio:    number   // proportion de runs communs avec extrait quasi-identique
  technicalCodeMatch:   boolean
}

function computeSignals(
  labelA: string, labelB: string,
  countA: number, countB: number, countAB: number,
  commonRunExcerpts: Array<{ excerptA: string; excerptB: string }>,
): SameSubjectSignals {
  const tokA = tokenSet(labelA)
  const tokB = tokenSet(labelB)
  const lj   = jaccard(tokA, tokB)
  const nA   = normalizeText(labelA)
  const nB   = normalizeText(labelB)
  const cont = nA.includes(nB) || nB.includes(nA)

  const overlap = countAB / Math.max(countA, countB)

  let identicalExcerpts = 0
  for (const { excerptA, excerptB } of commonRunExcerpts) {
    const simScore = jaccard(tokenSet(excerptA.slice(0, 120)), tokenSet(excerptB.slice(0, 120)))
    if (simScore >= 0.80) identicalExcerpts++
  }
  const excerptMatch = commonRunExcerpts.length > 0
    ? identicalExcerpts / commonRunExcerpts.length
    : 0

  const codesA = extractCodes(labelA)
  const codesB = extractCodes(labelB)
  const codeMatch = codesA.size > 0 && [...codesA].some(c => codesB.has(c))

  return {
    labelJaccard:       lj,
    labelContainment:   cont,
    runOverlapRatio:    overlap,
    excerptMatchRatio:  excerptMatch,
    technicalCodeMatch: codeMatch,
  }
}

interface GuardResult {
  decision:   'possible_same_subject' | 'pass_to_llm'
  score:      number    // 0-5
  signals:    string[]  // descriptions des signaux forts
}

function applySameSubjectGuard(signals: SameSubjectSignals): GuardResult {
  const strong: string[] = []
  let score = 0
  if (signals.labelJaccard >= 0.70)       { score++; strong.push(`Jaccard=${signals.labelJaccard.toFixed(2)} ★`) }
  else                                    { strong.push(`Jaccard=${signals.labelJaccard.toFixed(2)}`) }
  if (signals.labelContainment)           { score++; strong.push('Containment ★') }
  if (signals.runOverlapRatio >= 0.90)    { score++; strong.push(`RunOverlap=${signals.runOverlapRatio.toFixed(2)} ★`) }
  else                                    { strong.push(`RunOverlap=${signals.runOverlapRatio.toFixed(2)}`) }
  if (signals.excerptMatchRatio >= 0.75)  { score++; strong.push(`ExcerptMatch=${(signals.excerptMatchRatio * 100).toFixed(0)}% ★`) }
  else                                    { strong.push(`ExcerptMatch=${(signals.excerptMatchRatio * 100).toFixed(0)}%`) }
  if (signals.technicalCodeMatch)         { score++; strong.push('CodeMatch ★') }

  return {
    decision: score >= 3 ? 'possible_same_subject' : 'pass_to_llm',
    score,
    signals: strong,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Dry-run qualification v2 — guard same_subject + top-20 ===')
  console.log(`Site : ${SITE_ID}\n`)

  // ── Chargement commun ─────────────────────────────────────────────────────

  const { data: canonicals } = await supabase
    .from('canonical_subject').select('id, label, aliases')
    .eq('site_id', SITE_ID).eq('status', 'active')
  const csLabel   = new Map((canonicals ?? []).map(c => [c.id as string, c.label as string]))
  const csAliases = new Map((canonicals ?? []).map(c => [c.id as string, (c.aliases ?? []) as string[]]))

  const { data: sti } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id, source, confidence')
    .eq('site_id', SITE_ID)
  const threadToCS  = new Map<string, string>()
  const csToThread  = new Map<string, string>()
  const csThreads   = new Map<string, Array<{ thread: string; source: string; confidence: number }>>()
  for (const r of sti ?? []) {
    threadToCS.set(r.subject_thread_id, r.canonical_subject_id)
    if (!csToThread.has(r.canonical_subject_id)) csToThread.set(r.canonical_subject_id, r.subject_thread_id)
    if (!csThreads.has(r.canonical_subject_id)) csThreads.set(r.canonical_subject_id, [])
    csThreads.get(r.canonical_subject_id)!.push({ thread: r.subject_thread_id, source: r.source, confidence: r.confidence })
  }

  const { data: runsRaw } = await supabase
    .from('document_extraction_run')
    .select('id, created_at, documents!document_id(effective_date)')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  type RunRaw = { id: string; created_at: string; documents: { effective_date: string | null } | null }
  const runDate = new Map<string, string>()
  for (const r of (runsRaw ?? []) as unknown as RunRaw[]) {
    runDate.set(r.id, r.documents?.effective_date ?? r.created_at.slice(0, 10))
  }
  const canonicalRunIds = [...runDate.keys()]
  const N = canonicalRunIds.length
  console.log(`Runs : ${N}  |  Canonical subjects actifs : ${csLabel.size}`)

  const allProps: Array<{
    id: string; subject_thread_id: string; extraction_run_id: string
    source_excerpt: string | null; proposal_family: string; review_status: string
  }> = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase
      .from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, source_excerpt, proposal_family, review_status')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
      .not('proposal_family', 'in', '(person,company)')
    allProps.push(...(data ?? []))
  }
  console.log(`Propositions : ${allProps.length}`)

  const csFamilyCount = new Map<string, Map<string, number>>()
  const csStatusCount = new Map<string, Map<string, number>>()  // review_status
  const csRunSet      = new Map<string, Set<string>>()
  const runToCS       = new Map<string, Set<string>>()
  const runCsExcerpt  = new Map<string, Map<string, { id: string; excerpt: string }>>()

  for (const p of allProps) {
    const csId = threadToCS.get(p.subject_thread_id)
    if (!csId) continue
    if (!csFamilyCount.has(csId)) csFamilyCount.set(csId, new Map())
    const fm = csFamilyCount.get(csId)!
    fm.set(p.proposal_family, (fm.get(p.proposal_family) ?? 0) + 1)
    if (!csStatusCount.has(csId)) csStatusCount.set(csId, new Map())
    const sm = csStatusCount.get(csId)!
    sm.set(p.review_status, (sm.get(p.review_status) ?? 0) + 1)
    if (!csRunSet.has(csId)) csRunSet.set(csId, new Set())
    csRunSet.get(csId)!.add(p.extraction_run_id)
    if (!runToCS.has(p.extraction_run_id)) runToCS.set(p.extraction_run_id, new Set())
    runToCS.get(p.extraction_run_id)!.add(csId)
    if (!runCsExcerpt.has(p.extraction_run_id)) runCsExcerpt.set(p.extraction_run_id, new Map())
    const byCs = runCsExcerpt.get(p.extraction_run_id)!
    if (p.source_excerpt && !byCs.has(csId)) byCs.set(csId, { id: p.id, excerpt: p.source_excerpt })
  }

  const csFamily = new Map<string, string>()
  for (const [csId, fm] of csFamilyCount) {
    let best = '?', bestN = 0
    for (const [f, n] of fm) { if (n > bestN) { best = f; bestN = n } }
    csFamily.set(csId, best)
  }

  // Liens existants
  const { data: existingLinks } = await supabase
    .from('subject_thread_links').select('from_thread_id, to_thread_id, status')
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

  // ══════════════════════════════════════════════════════════════════════════
  // PARTIE 1 — AUDIT DES PAIRES [3] ET [7]
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '█'.repeat(80))
  console.log('  PARTIE 1 — AUDIT PAIRES SUSPECTES')
  console.log('█'.repeat(80))

  const AUDIT_PAIRS = [
    {
      desc:    '[3] Reprise du nivellement — kf ↔ action',
      aPrefix: 'reprise du nivellement', aFam: 'knowledge_fact',
      bPrefix: 'reprise du nivellement', bFam: 'action',
    },
    {
      desc:    '[7] Essais bétons — observation ↔ knowledge_fact',
      aPrefix: 'essais sur les bétons',  aFam: 'observation',
      bPrefix: 'essais bétons regards',  bFam: undefined,
    },
  ]

  for (const ap of AUDIT_PAIRS) {
    console.log(`\n${'═'.repeat(80)}`)
    console.log(`  ${ap.desc}`)
    console.log('═'.repeat(80))

    const allCs = [...csLabel.entries()]
    const matchA = allCs.filter(([id, lbl]) =>
      normalizeText(lbl).includes(normalizeText(ap.aPrefix)) &&
      (!ap.aFam || csFamily.get(id) === ap.aFam)
    )
    const matchB = allCs.filter(([id, lbl]) =>
      normalizeText(lbl).includes(normalizeText(ap.bPrefix)) &&
      (!ap.bFam || csFamily.get(id) === ap.bFam)
    )

    // Trouver la meilleure paire par countAB
    let bestA = '', bestB = '', bestCountAB = 0
    for (const [idA] of matchA) {
      for (const [idB] of matchB) {
        if (idA === idB) continue
        const runsA = csRunSet.get(idA) ?? new Set()
        const runsB = csRunSet.get(idB) ?? new Set()
        const count = [...runsA].filter(r => runsB.has(r)).length
        if (count > bestCountAB) { bestCountAB = count; bestA = idA; bestB = idB }
      }
    }

    if (!bestA || !bestB) { console.log('  ⚠ Paire non trouvée'); continue }

    const labelA  = csLabel.get(bestA)!
    const labelB  = csLabel.get(bestB)!
    const famA    = csFamily.get(bestA) ?? '?'
    const famB    = csFamily.get(bestB) ?? '?'
    const aliasA  = csAliases.get(bestA) ?? []
    const aliasB  = csAliases.get(bestB) ?? []
    const threadsA = csThreads.get(bestA) ?? []
    const threadsB = csThreads.get(bestB) ?? []
    const countA  = csRunSet.get(bestA)?.size ?? 0
    const countB  = csRunSet.get(bestB)?.size ?? 0

    const statusA = csStatusCount.get(bestA) ?? new Map()
    const statusB = csStatusCount.get(bestB) ?? new Map()

    // Extraits communs
    const commonRuns = [...(csRunSet.get(bestA) ?? [])]
      .filter(r => csRunSet.get(bestB)?.has(r))
      .sort((a, b) => (runDate.get(a) ?? '').localeCompare(runDate.get(b) ?? ''))
    const commonExcerpts = commonRuns
      .map(r => {
        const eA = runCsExcerpt.get(r)?.get(bestA)
        const eB = runCsExcerpt.get(r)?.get(bestB)
        if (!eA || !eB) return null
        return { runDate: runDate.get(r) ?? r, excerptA: eA.excerpt, excerptB: eB.excerpt }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // Signals
    const signals = computeSignals(labelA, labelB, countA, countB, bestCountAB, commonExcerpts)
    const guard   = applySameSubjectGuard(signals)

    // Affichage
    console.log(`\n  ── Sujet A ──`)
    console.log(`  ID     : ${bestA}`)
    console.log(`  Label  : "${labelA}"`)
    console.log(`  Fam.   : ${famA}`)
    console.log(`  Alias  : ${aliasA.length > 0 ? aliasA.map(a => `"${a}"`).join(', ') : '(aucun)'}`)
    console.log(`  Threads: ${threadsA.length} — sources: ${[...new Set(threadsA.map(t => t.source))].join(', ')}`)
    console.log(`  Occurs : ${countA}/${N} PVs`)
    const statusLabelsA = [...statusA.entries()].map(([s, n]) => `${s}:${n}`).join(' | ')
    console.log(`  Statuts: ${statusLabelsA || '—'}`)

    console.log(`\n  ── Sujet B ──`)
    console.log(`  ID     : ${bestB}`)
    console.log(`  Label  : "${labelB}"`)
    console.log(`  Fam.   : ${famB}`)
    console.log(`  Alias  : ${aliasB.length > 0 ? aliasB.map(a => `"${a}"`).join(', ') : '(aucun)'}`)
    console.log(`  Threads: ${threadsB.length} — sources: ${[...new Set(threadsB.map(t => t.source))].join(', ')}`)
    console.log(`  Occurs : ${countB}/${N} PVs`)
    const statusLabelsB = [...statusB.entries()].map(([s, n]) => `${s}:${n}`).join(' | ')
    console.log(`  Statuts: ${statusLabelsB || '—'}`)

    console.log(`\n  ── Signaux same-subject ──`)
    console.log(`  ${guard.signals.join('  |  ')}`)
    console.log(`  Score  : ${guard.score}/5  →  décision : ${guard.decision.toUpperCase()}`)

    console.log(`\n  ── Extraits communs (${commonExcerpts.length}/${commonRuns.length} avec texte) ──`)
    for (const e of commonExcerpts.slice(0, 3)) {
      console.log(`  [${e.runDate}]`)
      console.log(`    A : "${e.excerptA.slice(0, 150)}"`)
      console.log(`    B : "${e.excerptB.slice(0, 150)}"`)
    }

    // Raison historique probable de la séparation
    const srcA = [...new Set(threadsA.map(t => t.source))]
    const srcB = [...new Set(threadsB.map(t => t.source))]
    console.log(`\n  ── Raison probable de la séparation ──`)
    if (famA !== famB) {
      console.log(`  Familles différentes : ${famA} ≠ ${famB}`)
      console.log(`  → La résolution canonique a créé deux sujets distincts pour le même texte`)
      console.log(`    car il était classifié comme ${famA} (état documenté) dans certains`)
      console.log(`    PVs et comme ${famB} (ordre à exécuter) dans d'autres.`)
    } else {
      console.log(`  Même famille (${famA}) — séparation probablement due à une variation de libellé`)
      console.log(`  entre PVs successifs (entité résolue séparément par l'extracteur).`)
    }
    if (srcA.join() !== srcB.join()) {
      console.log(`  Sources différentes : A=${srcA.join(',')} B=${srcB.join(',')}`)
    }
    console.log(`  → NE PAS fusionner automatiquement. Proposer à validation humaine.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PARTIE 2 — TOP-20 POOL B AVEC GUARD
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\n\n' + '█'.repeat(80))
  console.log('  PARTIE 2 — TOP-20 POOL B — GUARD + LLM')
  console.log('█'.repeat(80))

  // Pool B : cooccurrence ≥ 3, lift ≥ 1.5, hors kf↔kf, hors confirmed/rejected
  interface PoolPair {
    a: string; b: string; key: string
    countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number; combined: number
    famA: string; famB: string
  }
  const poolB: PoolPair[] = []

  // Cooccurrences
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
    const famA = csFamily.get(a) ?? '?'
    const famB = csFamily.get(b) ?? '?'
    if (famA === 'knowledge_fact' && famB === 'knowledge_fact') continue
    poolB.push({
      a, b, key, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N),
      famA, famB,
    })
  }

  poolB.sort((x, y) => y.combined - x.combined || y.lift - x.lift)
  const top20 = poolB.slice(0, TOP_N)
  console.log(`\nPool B total : ${poolB.length} paires  →  top ${top20.length} analysés\n`)

  // Compteurs finaux
  let nSameSubject = 0, nNoRelation = 0, nRelatesTo = 0, nDirectional = 0, nError = 0, nAboveThreshold = 0

  for (let pi = 0; pi < top20.length; pi++) {
    const p = top20[pi]
    const labelA = csLabel.get(p.a) ?? p.a.slice(0, 8)
    const labelB = csLabel.get(p.b) ?? p.b.slice(0, 8)

    console.log(`\n[${ String(pi + 1).padStart(2, '0')}] "${labelA.slice(0, 35)}"`)
    console.log(`     ↔  "${labelB.slice(0, 35)}"`)
    console.log(`     ${p.famA} ↔ ${p.famB}  |  cA=${p.countA} cB=${p.countB} cAB=${p.countAB}  lift=${p.lift.toFixed(2)}  conf=${p.confAB.toFixed(2)}/${p.confBA.toFixed(2)}`)
    if (suggestedPairs.has(p.key)) console.log('     ★ Déjà suggested en base')

    // Guard
    const commonRuns = [...(csRunSet.get(p.a) ?? [])]
      .filter(r => csRunSet.get(p.b)?.has(r))
    const commonExcerpts = commonRuns
      .map(r => {
        const eA = runCsExcerpt.get(r)?.get(p.a)
        const eB = runCsExcerpt.get(r)?.get(p.b)
        return eA && eB ? { excerptA: eA.excerpt, excerptB: eB.excerpt } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const signals = computeSignals(labelA, labelB, p.countA, p.countB, p.countAB, commonExcerpts)
    const guard   = applySameSubjectGuard(signals)

    console.log(`     Guard : ${guard.signals.join('  |  ')}  →  score ${guard.score}/5`)

    if (guard.decision === 'possible_same_subject') {
      nSameSubject++
      console.log('     → POSSIBLE_SAME_SUBJECT — envoi vers pipeline fusion, pas de lien créé')
      continue
    }

    // LLM
    const evidence: PairEvidence[] = commonRuns
      .sort((a, b) => (runDate.get(a) ?? '').localeCompare(runDate.get(b) ?? ''))
      .slice(0, 4)
      .map(r => {
        const eA = runCsExcerpt.get(r)?.get(p.a)
        const eB = runCsExcerpt.get(r)?.get(p.b)
        return eA && eB
          ? { runId: r, runDate: runDate.get(r) ?? r, excerptA: eA.excerpt, excerptB: eB.excerpt, proposalIdA: eA.id, proposalIdB: eB.id }
          : null
      })
      .filter((x): x is PairEvidence => x !== null)

    if (evidence.length === 0) {
      console.log('     → Aucun extrait — ignoré')
      nError++
      continue
    }

    console.log('     ↳ LLM...')
    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: p.famA,
      csIdB: p.b, labelB, famB: p.famB,
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence,
    }

    const result = await qualifyLinkCandidate(pair)
    if (!result) { nError++; console.log('     → Erreur LLM'); continue }

    const confPct = (result.confidence * 100).toFixed(0) + '%'
    if (result.linkType === 'no_relation') {
      nNoRelation++
      console.log(`     → no_relation (${confPct}) — ${result.justification.slice(0, 120)}`)
    } else if (result.linkType === 'relates_to') {
      nRelatesTo++
      console.log(`     → relates_to (${confPct}) — ${result.justification.slice(0, 120)}`)
      if (result.confidence >= 0.70) nAboveThreshold++
    } else {
      nDirectional++
      const dir = result.direction === 'A_to_B'
        ? `"${labelA.slice(0, 25)}" → "${labelB.slice(0, 25)}"`
        : `"${labelB.slice(0, 25)}" → "${labelA.slice(0, 25)}"`
      console.log(`     → ${result.linkType} ${dir} (${confPct}) — ${result.justification.slice(0, 120)}`)
      if (result.confidence >= 0.70) nAboveThreshold++
    }

    if (pi < top20.length - 1) await sleep(600)
  }

  // ── Récapitulatif ──────────────────────────────────────────────────────────

  console.log('\n\n' + '═'.repeat(80))
  console.log('  RÉCAPITULATIF TOP-20')
  console.log('═'.repeat(80))
  console.log(`  possible_same_subject : ${nSameSubject}`)
  console.log(`  no_relation           : ${nNoRelation}`)
  console.log(`  relates_to            : ${nRelatesTo}`)
  console.log(`  directionnels         : ${nDirectional}`)
  console.log(`  erreurs/sans extrait  : ${nError}`)
  console.log(`  ─────────────────────────────`)
  console.log(`  total analysés        : ${top20.length}`)
  console.log(`  au-dessus seuil écriture (conf ≥ 70%) : ${nAboveThreshold}`)

  console.log('\n[DRY-RUN] Aucune écriture dans subject_thread_links.')
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
