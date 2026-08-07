/**
 * Dry-run cooccurrence v4 — filtrage par familles
 *
 * Pool de départ : cooccurrence ≥ 3 PV ET lift ≥ 1.5
 *
 * Trois populations produites :
 *   A — pool complet (362 paires)
 *   B — pool métier : exclut knowledge_fact ↔ knowledge_fact
 *   C — kf↔kf forts : lift ≥ 2 OU max(conf) = 1.0
 *
 * Aucune écriture en base.
 *
 * Usage :
 *   npx tsx --env-file=.env.local scripts/dry-run-cooccurrence.ts
 */

import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!supabaseUrl || !serviceKey) {
  console.error('[FATAL] NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

const SITE_ID  = '2c939e67-e986-4635-86a0-638cda870480'
const MIN_RUNS = 3
const MIN_LIFT = 1.5
const TOP_N    = 30

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

function familyPair(fA: string, fB: string): string {
  return [fA, fB].sort().join(' ↔ ')
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PairStats {
  key: string; a: string; b: string
  countA: number; countB: number; countAB: number
  support: number; confAB: number; confBA: number
  lift: number; combined: number
  famA: string; famB: string
  alreadySuggested: boolean
}

// ── Affichage ─────────────────────────────────────────────────────────────────

const W = 24

function printRow(i: number, s: PairStats, csLabel: Map<string, string>): void {
  const la  = (csLabel.get(s.a) ?? s.a).slice(0, W - 1).padEnd(W)
  const lb  = (csLabel.get(s.b) ?? s.b).slice(0, W - 1).padEnd(W)
  const cA  = String(s.countA).padStart(3)
  const cB  = String(s.countB).padStart(3)
  const cAB = String(s.countAB).padStart(3)
  const sup = s.support.toFixed(2)
  const cAB1 = s.confAB.toFixed(2)
  const cBA1 = s.confBA.toFixed(2)
  const lft  = s.lift.toFixed(2).padStart(5)
  const cmb  = s.combined.toFixed(3)
  const fA   = s.famA.slice(0, 14).padEnd(15)
  const fB   = s.famB.slice(0, 14)
  const sug  = s.alreadySuggested ? ' ★' : ''
  console.log(
    `${String(i + 1).padStart(2)}  ${la}${lb}` +
    `${cA}${cB}${cAB}  ${sup}  ${cAB1}  ${cBA1}${lft}  ${cmb}  ${fA}${fB}${sug}`
  )
}

function printHeader(): void {
  console.log(
    '##  ' + 'A'.padEnd(W) + 'B'.padEnd(W) +
    ' cA cB cAB  supp  cA→B  cB→A  lift  comb  famA           famB'
  )
  console.log('─'.repeat(130))
}

function printPool(
  title: string,
  pool: PairStats[],
  sortFn: (a: PairStats, b: PairStats) => number,
  csLabel: Map<string, string>,
) {
  const sorted = [...pool].sort(sortFn).slice(0, TOP_N)
  console.log(`\n${'═'.repeat(130)}`)
  console.log(`  ${title} — ${pool.length} paires → top ${sorted.length}`)
  console.log('═'.repeat(130))
  printHeader()
  sorted.forEach((s, i) => printRow(i, s, csLabel))
}

function familyDist(pool: PairStats[]): void {
  const dist = new Map<string, number>()
  for (const s of pool) {
    const k = familyPair(s.famA, s.famB)
    dist.set(k, (dist.get(k) ?? 0) + 1)
  }
  const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1])
  for (const [k, n] of sorted) {
    const bar = '█'.repeat(Math.min(30, Math.round(n / pool.length * 60)))
    console.log(`  ${String(n).padStart(3)}  ${k.padEnd(50)}${bar}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Dry-run cooccurrence v4 — filtre familles ===')
  console.log(`Site : ${SITE_ID}\n`)

  // 1. Canonical subjects actifs
  const { data: canonicals, error: eCS } = await supabase
    .from('canonical_subject').select('id, label, status')
    .eq('site_id', SITE_ID).eq('status', 'active')
  if (eCS) { console.error('[FATAL]', eCS.message); process.exit(1) }
  const csSet    = new Set((canonicals ?? []).map(c => c.id))
  const csLabel  = new Map((canonicals ?? []).map(c => [c.id, c.label as string]))

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
    .from('document_extraction_run').select('id')
    .eq('target_site_id', SITE_ID).eq('is_canonical', true)
    .neq('status', 'failed').neq('status', 'pending')
  const canonicalRunIds = (runs ?? []).map(r => r.id)
  const N = canonicalRunIds.length
  console.log(`N (PVs) : ${N}`)

  // 4. Propositions
  const allProps: { subject_thread_id: string; extraction_run_id: string; proposal_family: string }[] = []
  for (let i = 0; i < canonicalRunIds.length; i += 100) {
    const { data } = await supabase
      .from('document_extraction_proposal')
      .select('subject_thread_id, extraction_run_id, proposal_family')
      .in('extraction_run_id', canonicalRunIds.slice(i, i + 100))
      .not('subject_thread_id', 'is', null)
      .not('proposal_family', 'in', '(person,company)')
    allProps.push(...(data ?? []))
  }
  console.log(`Propositions : ${allProps.length}`)

  // 5. Structures
  const runToCS       = new Map<string, Set<string>>()
  const csRunSet      = new Map<string, Set<string>>()
  const csFamilyCount = new Map<string, Map<string, number>>()

  for (const p of allProps) {
    const csId = threadToCS.get(p.subject_thread_id)
    if (!csId) continue
    if (!runToCS.has(p.extraction_run_id)) runToCS.set(p.extraction_run_id, new Set())
    runToCS.get(p.extraction_run_id)!.add(csId)
    if (!csRunSet.has(csId)) csRunSet.set(csId, new Set())
    csRunSet.get(csId)!.add(p.extraction_run_id)
    if (!csFamilyCount.has(csId)) csFamilyCount.set(csId, new Map())
    const fm = csFamilyCount.get(csId)!
    fm.set(p.proposal_family, (fm.get(p.proposal_family) ?? 0) + 1)
  }

  const csFamily = new Map<string, string>()
  for (const [id, fm] of csFamilyCount) {
    let best = '?', bestN = 0
    for (const [f, n] of fm) { if (n > bestN) { best = f; bestN = n } }
    csFamily.set(id, best)
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

  // 7. Liens existants (confirmed, rejected, suggested)
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

  // 8. Calcul métriques
  const poolA: PairStats[] = []

  for (const [key, runSet] of pairRuns) {
    const countAB = runSet.size
    if (countAB < MIN_RUNS) continue
    if (excludedPairs.has(key)) continue
    const [a, b] = key.split('|')
    const countA = csRunSet.get(a)?.size ?? 0
    const countB = csRunSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue
    const support  = countAB / N
    const confAB   = countAB / countA
    const confBA   = countAB / countB
    const lift     = (countAB * N) / (countA * countB)
    if (lift < MIN_LIFT) continue
    poolA.push({
      key, a, b, countA, countB, countAB,
      support, confAB, confBA, lift,
      combined: lift * support,
      famA: csFamily.get(a) ?? '?',
      famB: csFamily.get(b) ?? '?',
      alreadySuggested: suggestedPairs.has(key),
    })
  }

  const sortCombined = (x: PairStats, y: PairStats) =>
    y.combined - x.combined || y.lift - x.lift

  // ── A : pool complet ──────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(130)}`)
  console.log(`  POOL A — complet (lift ≥ ${MIN_LIFT}, cooccurrence ≥ ${MIN_RUNS})`)
  console.log('═'.repeat(130))
  console.log(`  ${poolA.length} paires`)
  console.log(`  Déjà suggested : ${poolA.filter(s => s.alreadySuggested).length}`)
  console.log('\n  Distribution par familles :')
  familyDist(poolA)

  // ── B : pool métier (hors kf↔kf) ─────────────────────────────────────────

  const poolB = poolA.filter(s => !(s.famA === 'knowledge_fact' && s.famB === 'knowledge_fact'))

  console.log(`\n${'═'.repeat(130)}`)
  console.log('  POOL B — métier (exclut knowledge_fact ↔ knowledge_fact)')
  console.log('═'.repeat(130))
  console.log(`  ${poolB.length} paires  (retiré : ${poolA.length - poolB.length} paires kf↔kf)`)
  console.log(`  Déjà suggested : ${poolB.filter(s => s.alreadySuggested).length}`)
  console.log('\n  Distribution par familles :')
  familyDist(poolB)

  printPool('Pool B — tri combiné (lift × support)', poolB, sortCombined, csLabel)

  // ── C : kf↔kf forts ───────────────────────────────────────────────────────

  const poolKFKF = poolA.filter(s => s.famA === 'knowledge_fact' && s.famB === 'knowledge_fact')
  const poolC    = poolKFKF.filter(s => s.lift >= 2 || Math.max(s.confAB, s.confBA) === 1.0)

  console.log(`\n${'═'.repeat(130)}`)
  console.log('  POOL C — knowledge_fact ↔ knowledge_fact forts (lift ≥ 2 OU max(conf) = 1.0)')
  console.log('═'.repeat(130))
  console.log(`  kf↔kf total : ${poolKFKF.length}  →  retenus : ${poolC.length}`)
  if (poolC.length > 0) {
    console.log()
    printHeader()
    poolC
      .sort((a, b) => b.lift - a.lift || b.combined - a.combined)
      .slice(0, 40)
      .forEach((s, i) => printRow(i, s, csLabel))
  }

  console.log('\n[DRY-RUN] Aucune écriture en base.')
  console.log(`\nRécapitulatif :`)
  console.log(`  Pool A (complet)     : ${poolA.length}`)
  console.log(`  Pool B (métier)      : ${poolB.length}`)
  console.log(`  Pool C (kf↔kf forts) : ${poolC.length}`)
  console.log(`  Union B ∪ C          : ${poolB.length + poolC.length}`)
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1) })
