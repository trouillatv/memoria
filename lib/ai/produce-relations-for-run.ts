// Producteur incrémental de relations inter-sujets — déclenché après chaque import PV.
//
// Pipeline :
//   1. Charge les runs canoniques du site (historique complet)
//   2. Identifie les sujets opérationnels touchés par le nouveau run
//      (exclusion invariante : person/company → modèle acteur)
//   3. Calcule les cooccurrences avec l'historique
//   4. Filtre : minCooccurrences, minLift, exclusion kf↔kf, exclusion paires existantes
//   5. Classe par score combiné (lift × support) → top maxCandidatesPerRun
//   6. Guard same_subject (score ≥ 3 → sortie du pipeline, log uniquement)
//   7. Qualification Gemini → no_relation / relates_to / directionnel
//   8. Écriture : status='suggested', source='cooccurrence', jamais confirmed

import type { SupabaseClient } from '@supabase/supabase-js'
import { RELATION_CANDIDATE_CONFIG as CFG } from './relation-producer-config'
import { qualifyLinkCandidate } from './qualify-link-candidates'
import type { CandidatePair, PairEvidence } from './qualify-link-candidates'

// ── Utilitaires ───────────────────────────────────────────────────────────────

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

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

function sameSubjectScore(
  labelA: string, labelB: string,
  countA: number, countB: number, countAB: number,
  excerpts: Array<{ excerptA: string; excerptB: string }>,
): number {
  const nA  = normalizeText(labelA), nB = normalizeText(labelB)
  const lj  = jaccard(tokenSet(labelA), tokenSet(labelB))
  const excJ = excerpts.map(e => jaccard(tokenSet(e.excerptA, 3), tokenSet(e.excerptB, 3)))
  const cA  = extractCodes(labelA), cB = extractCodes(labelB)

  let score = 0
  if (lj >= 0.70)                                          score++
  if (nA.includes(nB) || nB.includes(nA))                 score++
  if (countAB / Math.max(countA, countB) >= 0.90)         score++
  if (excerpts.length > 0 && excJ.filter(j => j >= 0.80).length / excerpts.length >= 0.75) score++
  if (cA.size > 0 && cB.size > 0 && [...cA].some(c => cB.has(c))) score++
  return score
}

// ── Interface publique ────────────────────────────────────────────────────────

export interface ProduceRelationsResult {
  candidatesEvaluated: number
  sameSubjectDetected: number
  noRelation:          number
  relatesTo:           number
  directional:         number
  written:             number
  skippedLowConf:      number
  errors:              number
}

// ── Fonction principale ───────────────────────────────────────────────────────

export async function produceRelationsForRun(opts: {
  runId:   string
  siteId:  string
  admin:   SupabaseClient
  dryRun?: boolean   // si true : aucune écriture, log uniquement
}): Promise<ProduceRelationsResult> {
  const { runId, siteId, admin, dryRun = false } = opts

  const result: ProduceRelationsResult = {
    candidatesEvaluated: 0, sameSubjectDetected: 0,
    noRelation: 0, relatesTo: 0, directional: 0,
    written: 0, skippedLowConf: 0, errors: 0,
  }

  // 1. Canonical subjects actifs
  const { data: canonicals } = await admin
    .from('canonical_subject').select('id, label, aliases, status')
    .eq('site_id', siteId).eq('status', 'active')
  const csSet   = new Set((canonicals ?? []).map(c => c.id as string))
  const csLabel = new Map((canonicals ?? []).map(c => [c.id as string, c.label as string]))

  // 2. Thread → canonical
  const { data: sti } = await admin
    .from('subject_thread_identity').select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
  const threadToCS = new Map<string, string>()
  for (const r of sti ?? []) {
    if (csSet.has(r.canonical_subject_id)) threadToCS.set(r.subject_thread_id, r.canonical_subject_id)
  }

  // cs → first thread (pour insertion)
  const csToThread = new Map<string, string>()
  for (const [tid, csId] of threadToCS) {
    if (!csToThread.has(csId)) csToThread.set(csId, tid)
  }

  // 3. Runs canoniques du site (inclut le run courant s'il est déjà canonical)
  const { data: runs } = await admin
    .from('document_extraction_run').select('id, created_at')
    .eq('target_site_id', siteId).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  const canonicalRunIds = (runs ?? []).map(r => r.id as string)
  const runDate = new Map((runs ?? []).map(r => [r.id as string, (r.created_at as string)?.slice(0, 10) ?? '?']))
  const N = canonicalRunIds.length
  if (N < CFG.minCooccurrences) return result  // pas assez de PVs

  // 4. Propositions (toutes familles sauf acteurs)
  const allProps: {
    id: string; subject_thread_id: string; extraction_run_id: string
    proposal_family: string; source_excerpt: string | null
  }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await admin.from('document_extraction_proposal')
      .select('id, subject_thread_id, extraction_run_id, proposal_family, source_excerpt')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
      .not('proposal_family', 'in', `(${CFG.excludedFamilies.join(',')})`)
    allProps.push(...(data ?? []))
  }

  // 5. Structures cooccurrence
  const runToCS    = new Map<string, Set<string>>()
  const csRunSet   = new Map<string, Set<string>>()
  const csFamily   = new Map<string, Map<string, number>>()
  const runCsData  = new Map<string, Map<string, { excerpt: string; propId: string }>>()

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

  // Sujets présents dans le run courant (filtre incrémental)
  const subjectsInCurrentRun = runToCS.get(runId) ?? new Set<string>()
  if (subjectsInCurrentRun.size === 0) return result

  // 6. Cooccurrences
  const pairRuns = new Map<string, Set<string>>()
  for (const [rid, csIds] of runToCS) {
    const arr = [...csIds]
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j])
        if (!pairRuns.has(key)) pairRuns.set(key, new Set())
        pairRuns.get(key)!.add(rid)
      }
  }

  // 7. Liens existants (confirmed/rejected → exclus ; suggested → skip aussi pour éviter doublons)
  const { data: existingLinks } = await admin
    .from('subject_thread_links').select('from_thread_id, to_thread_id, status')
    .eq('site_id', siteId)
  const excludedPairs = new Set<string>()
  for (const lk of existingLinks ?? []) {
    const fc = threadToCS.get(lk.from_thread_id)
    const tc = threadToCS.get(lk.to_thread_id)
    if (!fc || !tc) continue
    excludedPairs.add(pairKey(fc, tc))  // confirme + rejected + suggested tous exclus
  }

  // 8. Pool B filtré — uniquement les paires impliquant le run courant
  const candidates: {
    key: string; a: string; b: string; countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number; combined: number; famA: string; famB: string
  }[] = []

  for (const [key, runSet] of pairRuns) {
    const countAB = runSet.size
    if (countAB < CFG.minCooccurrences) continue
    if (excludedPairs.has(key)) continue
    const [a, b] = key.split('|')

    // Filtre incrémental : au moins un sujet doit être dans le run courant
    if (!subjectsInCurrentRun.has(a) && !subjectsInCurrentRun.has(b)) continue

    const countA = csRunSet.get(a)?.size ?? 0
    const countB = csRunSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue

    const lift = (countAB * N) / (countA * countB)
    if (lift < CFG.minLift) continue

    const famA = csFamilyBest.get(a) ?? '?'
    const famB = csFamilyBest.get(b) ?? '?'

    // Invariant acteur (double garde — les families ont déjà été exclues au fetch)
    if (CFG.excludedFamilies.includes(famA) || CFG.excludedFamilies.includes(famB)) continue

    // Exclusion kf↔kf V1
    if (CFG.excludeKfKfPairs && famA === 'knowledge_fact' && famB === 'knowledge_fact') continue

    candidates.push({
      key, a, b, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N), famA, famB,
    })
  }

  // Top N par score combiné
  const top = candidates
    .sort((x, y) => y.combined - x.combined || y.lift - x.lift)
    .slice(0, CFG.maxCandidatesPerRun)

  // 9. Guard + Gemini + écriture
  for (const p of top) {
    result.candidatesEvaluated++

    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b

    const commonRuns = [...(pairRuns.get(p.key) ?? [])]
    const evidence: PairEvidence[] = commonRuns
      .map(rid => ({
        runId: rid,
        runDate: runDate.get(rid) ?? '?',
        excerptA: runCsData.get(rid)?.get(p.a)?.excerpt ?? '',
        excerptB: runCsData.get(rid)?.get(p.b)?.excerpt ?? '',
        proposalIdA: runCsData.get(rid)?.get(p.a)?.propId ?? '',
        proposalIdB: runCsData.get(rid)?.get(p.b)?.propId ?? '',
      }))
      .filter(e => e.excerptA || e.excerptB)
      .slice(0, 4)

    // Guard same_subject
    const excerptPairs = evidence.map(e => ({ excerptA: e.excerptA, excerptB: e.excerptB }))
    const guardScore = sameSubjectScore(labelA, labelB, p.countA, p.countB, p.countAB, excerptPairs)
    if (guardScore >= 3) {
      result.sameSubjectDetected++
      console.log(`[relations] possible_same_subject: "${labelA}" / "${labelB}" (score ${guardScore}/5)`)
      continue
    }

    if (evidence.length === 0) {
      result.errors++
      continue
    }

    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: p.famA,
      csIdB: p.b, labelB, famB: p.famB,
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence,
    }

    let qualResult
    try {
      qualResult = await qualifyLinkCandidate(pair)
    } catch {
      result.errors++
      continue
    }

    if (!qualResult || qualResult.linkType === 'no_relation') {
      result.noRelation++
      continue
    }

    const { linkType, direction, confidence, justification, evidenceRunIds } = qualResult

    if (linkType === 'relates_to') result.relatesTo++
    else result.directional++

    if (confidence < CFG.minLlmConfidence) {
      result.skippedLowConf++
      continue
    }

    const threadA = csToThread.get(p.a)
    const threadB = csToThread.get(p.b)
    if (!threadA || !threadB) { result.errors++; continue }

    // from/to selon direction ; pour relates_to → ordre canonique (lesser UUID)
    let fromThreadId: string, toThreadId: string
    if (direction === 'A_to_B') { fromThreadId = threadA; toThreadId = threadB }
    else if (direction === 'B_to_A') { fromThreadId = threadB; toThreadId = threadA }
    else { // undirected ou none
      fromThreadId = threadA < threadB ? threadA : threadB
      toThreadId   = threadA < threadB ? threadB : threadA
    }

    const evidenceRunId = evidenceRunIds[0] ?? runId

    if (dryRun) {
      console.log(`[relations/dry] ${linkType} conf=${confidence.toFixed(2)} "${labelA}" → "${labelB}"`)
      result.written++
      continue
    }

    const { error } = await admin.from('subject_thread_links').insert({
      site_id:         siteId,
      from_thread_id:  fromThreadId,
      to_thread_id:    toThreadId,
      link_type:       linkType,
      status:          'suggested',
      source:          'cooccurrence',
      confidence,
      justification,
      evidence_run_id: evidenceRunId,
    })

    if (error) {
      if (error.code === '23505') {
        // Doublon — idempotent, on ignore
      } else {
        console.error(`[relations] insert error: ${error.message}`)
        result.errors++
      }
    } else {
      result.written++
      console.log(`[relations] suggested: ${linkType} conf=${confidence.toFixed(2)} "${labelA}" ↔ "${labelB}"`)
    }
  }

  return result
}
