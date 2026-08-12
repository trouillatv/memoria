// Audit ranking — OCEF Compostage rangs 31+
//
// Objectif : répondre à la question fondamentale post dry-run :
//   "Est-ce que nos vraies relations directionnelles sont absentes du corpus,
//    ou simplement classées derrière la clique thématique par le ranking ?"
//
// Méthode :
//   1. Reconstruit le pool complet des candidats (même logique que le moteur)
//   2. Saute le top-30 déjà évalué
//   3. Dans les rangs 31–250, calcule pour chaque paire un score de diversité temporelle :
//        dateRange   = nb de jours entre la 1re et la dernière co-occurrence
//        visitSpread = nb de paires de visites distinctes où ils co-occurrent
//        (une paire qui co-occur toujours dans les mêmes 2 PV a visitSpread=1 quelle que soit cooc)
//   4. Prend les 20 paires avec la plus grande diversité temporelle
//   5. Les soumet à Gemini avec le même contrat que le moteur (qualifyLinkCandidate)
//   6. Compare les verdicts aux 30 premiers

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { qualifyLinkCandidate } from '../lib/ai/qualify-link-candidates'
import type { CandidatePair } from '../lib/ai/qualify-link-candidates'
import { selectBestNote } from '../lib/ai/produce-relations-from-occurrences'
import type { OccurrenceData } from '../lib/ai/produce-relations-from-occurrences'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SITE_ID      = process.env.TARGET_SITE_ID ?? '2c939e67-e986-4635-86a0-638cda870480'

const MIN_COOC    = 2
const MIN_LIFT    = 1.5
const TOP_N_SKIP  = 30   // déjà évalués dans le dry-run initial
const AUDIT_POOL  = 220  // rangs 31–250 à analyser
const SAMPLE_SIZE = 20   // à soumettre à Gemini

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

function hr(c = '─', n = 80) { return c.repeat(n) }

function daysBetween(d1: string, d2: string): number {
  return Math.abs(new Date(d1).getTime() - new Date(d2).getTime()) / (1000 * 60 * 60 * 24)
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: sites } = await admin.from('sites').select('id, name').eq('id', SITE_ID)
  console.log(`\nAudit ranking OCEF — rangs ${TOP_N_SKIP + 1}–${TOP_N_SKIP + AUDIT_POOL}`)
  console.log(`Chantier : ${sites?.[0]?.name ?? SITE_ID}`)
  console.log(hr())

  // ── 1. Occurrences ─────────────────────────────────────────────────────────
  const { data: occurrences } = await admin
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, label, note, effective_date, source_proposal_id')
    .eq('site_id', SITE_ID)
    .in('source_kind', ['field_visit', 'meeting', 'historical_pdf'])

  if (!occurrences || occurrences.length === 0) { console.error('Aucune occurrence.'); process.exit(1) }

  const { data: canonicals } = await admin
    .from('canonical_subject').select('id, label').eq('site_id', SITE_ID).eq('status', 'active')
  const csLabel = new Map((canonicals ?? []).map(c => [c.id as string, c.label as string]))

  // ── 2. Indexes (même logique que le moteur) ────────────────────────────────
  const visitToCS  = new Map<string, Map<string, OccurrenceData[]>>()
  const csVisitSet = new Map<string, Set<string>>()

  for (const occ of occurrences) {
    const visitId = occ.source_ref_id as string
    const csId    = occ.canonical_subject_id as string
    if (!visitToCS.has(visitId)) visitToCS.set(visitId, new Map())
    const vm = visitToCS.get(visitId)!
    if (!vm.has(csId)) vm.set(csId, [])
    vm.get(csId)!.push({
      occurrenceId:  occ.id as string,
      label:         occ.label as string,
      note:          occ.note as string | null,
      effectiveDate: (occ.effective_date as string)?.slice(0, 10) ?? '?',
      proposalId:    occ.source_proposal_id as string | null,
    })
    if (!csVisitSet.has(csId)) csVisitSet.set(csId, new Set())
    csVisitSet.get(csId)!.add(visitId)
  }
  const N = visitToCS.size

  // ── 3. Co-occurrences ─────────────────────────────────────────────────────
  const pairVisits = new Map<string, Set<string>>()
  for (const [visitId, csMap] of visitToCS) {
    const arr = [...csMap.keys()]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j])
        if (!pairVisits.has(key)) pairVisits.set(key, new Set())
        pairVisits.get(key)!.add(visitId)
      }
    }
  }

  // ── 4. Liens existants ────────────────────────────────────────────────────
  const { data: existingLinks } = await admin
    .from('canonical_subject_links').select('source_subject_id, target_subject_id').eq('site_id', SITE_ID)
  const excludedPairs = new Set<string>()
  for (const lk of existingLinks ?? []) excludedPairs.add(pairKey(lk.source_subject_id, lk.target_subject_id))

  // ── 5. Pool complet — même formule que le moteur ──────────────────────────
  const candidates: {
    key: string; a: string; b: string
    countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number; combined: number
    visitDates: string[]   // dates des visites communes
  }[] = []

  for (const [key, visitSet] of pairVisits) {
    const [a, b] = key.split('|')
    const countAB = visitSet.size
    if (!csLabel.has(a) || !csLabel.has(b)) continue
    if (excludedPairs.has(key)) continue
    if (countAB < MIN_COOC) continue
    const countA = csVisitSet.get(a)?.size ?? 0
    const countB = csVisitSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue
    const lift = (countAB * N) / (countA * countB)
    if (lift < MIN_LIFT) continue

    // Dates des visites communes (pour le score de diversité temporelle)
    const visitDates: string[] = []
    for (const vid of visitSet) {
      const vm = visitToCS.get(vid)
      const dateA = vm?.get(a)?.[0]?.effectiveDate ?? vm?.get(b)?.[0]?.effectiveDate ?? ''
      if (dateA) visitDates.push(dateA)
    }

    candidates.push({
      key, a, b, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N),
      visitDates,
    })
  }

  const sorted = candidates.sort((x, y) => y.combined - x.combined || y.lift - x.lift)
  console.log(`Pool total : ${sorted.length} candidats (top-30 déjà évalués, ${Math.max(0, sorted.length - TOP_N_SKIP)} dans l'audit)`)

  // ── 6. Rangs 31–250 : diversité temporelle ────────────────────────────────
  const auditPool = sorted.slice(TOP_N_SKIP, TOP_N_SKIP + AUDIT_POOL)

  // Score de diversité temporelle pour chaque paire :
  //   dateRange  = nb de jours entre première et dernière co-occurrence
  //   visitUniquePairs = nb de couples de dates distincts dans les co-occurrences
  const withDiversity = auditPool.map(p => {
    const dates = p.visitDates.filter(Boolean).sort()
    const dateRange = dates.length >= 2 ? daysBetween(dates[0], dates[dates.length - 1]) : 0
    // Nombre de paires de dates distinctes parmi les co-occurrences
    const uniqueDates = new Set(dates)
    const visitUniquePairs = uniqueDates.size
    return { ...p, dateRange, visitUniquePairs, dates }
  })

  // Ranking secondaire : priorité à ceux qui co-occurrent sur le plus grand écart temporel
  // puis, à égalité, sur le plus grand nombre de dates distinctes
  withDiversity.sort((x, y) =>
    y.dateRange - x.dateRange || y.visitUniquePairs - x.visitUniquePairs || y.countAB - x.countAB
  )

  console.log(`\nTop-20 par diversité temporelle (parmi les rangs ${TOP_N_SKIP + 1}–${TOP_N_SKIP + AUDIT_POOL})`)
  console.log(hr())

  const sample = withDiversity.slice(0, SAMPLE_SIZE)

  for (let i = 0; i < sample.length; i++) {
    const p = sample[i]
    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b
    console.log(`  [${i + 1}] cooc=${p.countAB}/${N}  lift=${p.lift.toFixed(2)}  dateRange=${p.dateRange.toFixed(0)}j  dates=[${p.dates.join(', ')}]`)
    console.log(`       "${labelA}"`)
    console.log(`       "${labelB}"`)
  }

  // ── 7. Évaluation Gemini des 20 sélectionnés ─────────────────────────────
  console.log(`\n${hr('═')}`)
  console.log(`ÉVALUATION GEMINI — ${SAMPLE_SIZE} paires à diversité temporelle maximale`)
  console.log(hr('═'))

  const ALLOWED_RELATION_TYPES = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])
  let noRelation = 0, relatesTo = 0, directional = 0, written = 0

  const results: {
    rank: number; labelA: string; labelB: string
    cooc: number; lift: number; dateRange: number
    decision: string; linkType?: string; direction?: string; confidence?: number; justification?: string
  }[] = []

  for (let i = 0; i < sample.length; i++) {
    const p = sample[i]
    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b

    console.log(`\n${hr()}`)
    console.log(`[${i + 1}/${SAMPLE_SIZE}]  "${labelA}"  ↔  "${labelB}"`)
    console.log(`  Stats : cooc=${p.countAB}/${N}  lift=${p.lift.toFixed(2)}  dates=[${p.dates.join(', ')}]  range=${p.dateRange.toFixed(0)}j`)

    // Collecter les evidences pour les visites communes
    const pairEvidenceForLLM: Parameters<typeof qualifyLinkCandidate>[0]['evidence'] = []

    for (const visitId of [...pairVisits.get(p.key)!]) {
      const visitMap = visitToCS.get(visitId)
      if (!visitMap) continue
      const occsA = visitMap.get(p.a) ?? []
      const occsB = visitMap.get(p.b) ?? []
      if (occsA.length === 0 || occsB.length === 0) continue
      const effectiveDate = occsA[0].effectiveDate
      const { text: excerptA } = selectBestNote(occsA, labelA)
      const { text: excerptB } = selectBestNote(occsB, labelB)
      if (excerptA.trim() || excerptB.trim()) {
        pairEvidenceForLLM.push({
          runId: visitId, runDate: effectiveDate,
          excerptA, excerptB, proposalIdA: '', proposalIdB: '',
        })
      }
    }

    if (pairEvidenceForLLM.length === 0) {
      console.log('  → skipped (aucune evidence)')
      results.push({ rank: TOP_N_SKIP + i + 1, labelA, labelB, cooc: p.countAB, lift: p.lift, dateRange: p.dateRange, decision: 'skipped_no_evidence' })
      continue
    }

    // Afficher les evidences
    for (const ev of pairEvidenceForLLM.slice(0, 3)) {
      console.log(`  ── ${ev.runDate} ──`)
      console.log(`    A: "${ev.excerptA.slice(0, 200)}"`)
      console.log(`    B: "${ev.excerptB.slice(0, 200)}"`)
    }

    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: 'observation',
      csIdB: p.b, labelB, famB: 'observation',
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence: pairEvidenceForLLM.slice(0, 4),
    }

    let qualResult
    try {
      qualResult = await qualifyLinkCandidate(pair)
    } catch (e) {
      console.log(`  → error: ${e instanceof Error ? e.message : String(e)}`)
      results.push({ rank: TOP_N_SKIP + i + 1, labelA, labelB, cooc: p.countAB, lift: p.lift, dateRange: p.dateRange, decision: 'error' })
      continue
    }

    const { linkType, direction, confidence, justification } = qualResult ?? { linkType: 'no_relation', direction: 'none', confidence: 0, justification: '' }

    if (!qualResult || linkType === 'no_relation') {
      noRelation++
      console.log(`  → no_relation  conf=${confidence.toFixed(2)}`)
      results.push({ rank: TOP_N_SKIP + i + 1, labelA, labelB, cooc: p.countAB, lift: p.lift, dateRange: p.dateRange, decision: 'no_relation', linkType, confidence, justification })
    } else if (!ALLOWED_RELATION_TYPES.has(linkType)) {
      relatesTo++
      console.log(`  → relates_to (whitelist)  conf=${confidence.toFixed(2)}`)
      console.log(`  Justif : "${justification.slice(0, 200)}"`)
      results.push({ rank: TOP_N_SKIP + i + 1, labelA, labelB, cooc: p.countAB, lift: p.lift, dateRange: p.dateRange, decision: 'skipped_whitelist', linkType, confidence, justification })
    } else {
      directional++
      written++
      const dir = direction === 'A_to_B' ? '→' : direction === 'B_to_A' ? '←' : '↔'
      console.log(`  → DIRECTIONAL: ${linkType}  ${dir}  conf=${confidence.toFixed(2)}  *** POTENTIELLE BONNE RELATION ***`)
      console.log(`  Justif : "${justification.slice(0, 300)}"`)
      results.push({ rank: TOP_N_SKIP + i + 1, labelA, labelB, cooc: p.countAB, lift: p.lift, dateRange: p.dateRange, decision: 'written', linkType, direction, confidence, justification })
    }
  }

  // ── 8. Synthèse comparative ───────────────────────────────────────────────
  console.log(`\n${hr('═')}`)
  console.log('SYNTHÈSE COMPARATIVE')
  console.log(hr('═'))
  console.log(`Rangs 1–30   (clique thématique)  : 70% no_relation | 27% relates_to | 3% directional (1/30)`)
  console.log(`Rangs 31–${TOP_N_SKIP + SAMPLE_SIZE} (diversité temporelle) : ${Math.round(noRelation/SAMPLE_SIZE*100)}% no_relation | ${Math.round(relatesTo/SAMPLE_SIZE*100)}% relates_to | ${Math.round(directional/SAMPLE_SIZE*100)}% directional (${directional}/${SAMPLE_SIZE})`)

  console.log(`\n${hr()}`)
  console.log('RELATIONS DIRECTIONNELLES TROUVÉES dans les rangs 31+')
  console.log(hr())

  const directionalResults = results.filter(r => r.decision === 'written')
  if (directionalResults.length === 0) {
    console.log('  → Aucune relation directionnelle dans cet échantillon.')
    console.log('  CONCLUSION : le corpus est probablement la limite principale, pas le ranking.')
  } else {
    for (const r of directionalResults) {
      const dir = r.direction === 'A_to_B' ? '→' : r.direction === 'B_to_A' ? '←' : '↔'
      console.log(`  [rang ~${r.rank}] "${r.labelA}"`)
      console.log(`    ${dir} ${r.linkType} (conf=${r.confidence?.toFixed(2)})`)
      console.log(`    "${r.labelB}"`)
      console.log(`    cooc=${r.cooc}/${N}  lift=${r.lift.toFixed(2)}  dateRange=${r.dateRange.toFixed(0)}j`)
      console.log(`    Justif : "${r.justification?.slice(0, 200)}"`)
    }
    console.log(`\n  CONCLUSION : le ranking cache des relations valides → signal qu'un meilleur ranking améliorerait le recall.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
