/**
 * Simulation du read-model "Comprendre l'évolution" sur OCEF Compostage.
 *
 * Reproduit la logique de buildEvolutionReadModel / getActivityMap sans Next.js.
 * READ ONLY — aucune écriture en base.
 *
 * Usage : npx tsx scripts/simulate-evolution-readmodel.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const SITE_ID   = '2c939e67-e986-4635-86a0-638cda870480' // OCEF Compostage
const TODAY     = new Date('2026-08-03')
const ACTIVITY_MAX           = 8
const IMPORTANT_THRESHOLD    = 12
const GAP_THRESHOLD_DAYS     = 35
const SILENCE_THRESHOLD_DAYS = 45
const PROP_BATCH = 10
const NON_SUBJECT_FAMILIES   = new Set(['person', 'company'])

// Priorité de gravité (0 = plus sévère)
const STATUS_RANK: Record<string, number> = {
  non_compliant: 0, open: 1, awaiting_validation: 2, in_progress: 3,
  planned: 4, done: 5, cancelled: 5, informational: 6,
}

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivityCellState = 'absent' | 'first' | 'open' | 'non_compliant' | 'done' | 'reopened'

interface RunEntry { id: string; effectiveDate: string; pvNumber: number }

interface SubjectRow {
  canonicalSubjectId: string
  label: string
  score: number
  cells: ActivityCellState[]
}

interface EvolutionSubjectFact { canonicalSubjectId: string; label: string }

interface EvolutionPeriod {
  label: string
  startDate: string
  endDate: string
  pvNumbers: number[]
  isSilence: boolean
  appeared:  EvolutionSubjectFact[]
  aggravated: EvolutionSubjectFact[]
  resolved:  EvolutionSubjectFact[]
  persistent: EvolutionSubjectFact[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function runEffectiveDate(row: { created_at: string; documents: Array<{ effective_date: string | null }> | { effective_date: string | null } | null }): string {
  const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents
  return doc?.effective_date ?? row.created_at
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long' })
}

function buildPeriodLabel(startDate: string, endDate: string, isSilence = false): string {
  const sMonth = monthLabel(startDate)
  const eMonth = monthLabel(endDate)
  const sYear  = new Date(startDate).getFullYear()
  const eYear  = new Date(endDate).getFullYear()

  let range: string
  if (sYear === eYear) {
    range = sMonth === eMonth
      ? `${capitalize(sMonth)} ${sYear}`
      : `${capitalize(sMonth)}–${eMonth} ${sYear}`
  } else {
    range = `${capitalize(sMonth)} ${sYear}–${eMonth} ${eYear}`
  }
  return isSilence ? `Silence documentaire — ${range}` : range
}

function cellState(status: string | null, prevStatus: string | null): ActivityCellState {
  if (!status) return 'absent'
  if (prevStatus === null) return 'first'
  if (status === 'non_compliant') return 'non_compliant'
  if (status === 'done' || status === 'cancelled' || status === 'informational') return 'done'
  if (prevStatus === 'done' || prevStatus === 'cancelled' || prevStatus === 'informational') return 'reopened'
  return 'open'
}

// ── Détection des périodes ─────────────────────────────────────────────────────

interface RawGroup {
  runs: RunEntry[]
  isSilence: boolean
  silenceStart?: string
  silenceEnd?: string
}

function groupRunsIntoPeriods(runs: RunEntry[]): RawGroup[] {
  if (runs.length === 0) return []
  const groups: RawGroup[] = []
  let current: RunEntry[] = [runs[0]]
  let currentMonth = runs[0].effectiveDate.slice(0, 7)

  for (let i = 1; i < runs.length; i++) {
    const gap      = daysBetween(runs[i - 1].effectiveDate, runs[i].effectiveDate)
    const runMonth = runs[i].effectiveDate.slice(0, 7)

    if (gap > SILENCE_THRESHOLD_DAYS) {
      groups.push({ runs: current, isSilence: false })
      const after  = new Date(runs[i - 1].effectiveDate)
      const before = new Date(runs[i].effectiveDate)
      after.setDate(after.getDate() + 1)
      before.setDate(before.getDate() - 1)
      groups.push({
        runs: [], isSilence: true,
        silenceStart: after.toISOString().slice(0, 10),
        silenceEnd:   before.toISOString().slice(0, 10),
      })
      current      = [runs[i]]
      currentMonth = runMonth
    } else if (runMonth !== currentMonth) {
      groups.push({ runs: current, isSilence: false })
      current      = [runs[i]]
      currentMonth = runMonth
    } else {
      current.push(runs[i])
    }
  }
  groups.push({ runs: current, isSilence: false })
  return groups
}

function computePeriodFacts(group: RawGroup, runs: RunEntry[], rows: SubjectRow[]): EvolutionPeriod {
  if (group.isSilence) {
    return {
      label:      buildPeriodLabel(group.silenceStart!, group.silenceEnd!, true),
      startDate:  group.silenceStart!,
      endDate:    group.silenceEnd!,
      pvNumbers:  [],
      isSilence:  true,
      appeared:   [],
      aggravated: [],
      resolved:   [],
      persistent: [],
    }
  }

  const runToIdx   = new Map(runs.map((r, i) => [r.id, i]))
  const periodIdxs = group.runs.map((r) => runToIdx.get(r.id) ?? -1).filter((i) => i >= 0)

  const appeared:  EvolutionSubjectFact[] = []
  const aggravated: EvolutionSubjectFact[] = []
  const resolved:  EvolutionSubjectFact[] = []
  const persistent: EvolutionSubjectFact[] = []

  for (const row of rows) {
    const states = periodIdxs.map((i) => row.cells[i] ?? 'absent')
    if (states.every((s) => s === 'absent')) continue

    const isFirst   = states.includes('first')
    const isAggr    = states.some((s) => s === 'non_compliant' || s === 'reopened')
    const isDone    = !isFirst && !isAggr && states.includes('done')
    const openCount = states.filter((s) => s === 'open').length
    const fact      = { canonicalSubjectId: row.canonicalSubjectId, label: row.label }

    if (isFirst)    appeared.push(fact)
    if (isAggr)     aggravated.push(fact)
    if (isDone)     resolved.push(fact)
    if (!isFirst && !isAggr && !isDone && openCount >= 2) persistent.push(fact)
  }

  return {
    label:     buildPeriodLabel(group.runs[0].effectiveDate, group.runs[group.runs.length - 1].effectiveDate),
    startDate: group.runs[0].effectiveDate,
    endDate:   group.runs[group.runs.length - 1].effectiveDate,
    pvNumbers: group.runs.map((r) => r.pvNumber),
    isSilence: false,
    appeared,
    aggravated,
    resolved,
    persistent,
  }
}

// ── Affichage ──────────────────────────────────────────────────────────────────

function printPeriod(p: EvolutionPeriod, idx: number): void {
  const pvRange = p.pvNumbers.length === 0
    ? '(aucun PV)'
    : p.pvNumbers.length === 1
      ? `PV${p.pvNumbers[0]}`
      : `PV${p.pvNumbers[0]}–PV${p.pvNumbers[p.pvNumbers.length - 1]}`

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Période ${idx + 1} — ${p.label}  [${pvRange}]`)
  console.log('─'.repeat(60))

  if (p.isSilence) {
    console.log('  (aucun PV — silence documentaire)')
    return
  }

  if (p.appeared.length > 0) {
    console.log(`\n  ◉ Apparus (${p.appeared.length}) :`)
    for (const s of p.appeared) console.log(`      · ${s.label}`)
  }
  if (p.aggravated.length > 0) {
    console.log(`\n  ⚠ Aggravés/réouverts (${p.aggravated.length}) :`)
    for (const s of p.aggravated) console.log(`      · ${s.label}`)
  }
  if (p.resolved.length > 0) {
    console.log(`\n  ✓ Traités (${p.resolved.length}) :`)
    for (const s of p.resolved) console.log(`      · ${s.label}`)
  }
  if (p.persistent.length > 0) {
    console.log(`\n  → Persistants (${p.persistent.length}) :`)
    for (const s of p.persistent) console.log(`      · ${s.label}`)
  }

  if (p.appeared.length === 0 && p.aggravated.length === 0 && p.resolved.length === 0 && p.persistent.length === 0) {
    console.log('  (aucun signal structurant)')
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Simulation read-model Comprendre l\'évolution — OCEF Compostage ===\n')

  // 1. Runs canoniques
  const { data: rawRuns, error: runsErr } = await sb
    .from('document_extraction_run')
    .select('id, document_id, created_at, documents!document_id(effective_date)')
    .eq('target_site_id', SITE_ID)
    .eq('is_canonical', true)
    .order('created_at', { ascending: true })

  if (runsErr) { console.error(runsErr); process.exit(1) }

  type RawRun = { id: string; document_id: string; created_at: string; documents: Array<{ effective_date: string | null }> | { effective_date: string | null } | null }
  const sortedRuns = ((rawRuns ?? []) as unknown as RawRun[])
    .map((r) => ({ ...r, effectiveDate: runEffectiveDate(r) }))
    .sort((a, b) => a.effectiveDate !== b.effectiveDate ? a.effectiveDate.localeCompare(b.effectiveDate) : a.created_at.localeCompare(b.created_at))

  const runs: RunEntry[] = sortedRuns.map((r, i) => ({ id: r.id, effectiveDate: r.effectiveDate, pvNumber: i + 1 }))
  const runIds           = runs.map((r) => r.id)
  const runIndex         = new Map(runs.map((r, i) => [r.id, i]))
  const lastRunIds       = new Set(runs.slice(-2).map((r) => r.id))

  console.log(`${runs.length} PV canoniques trouvés :`)
  for (const r of runs) console.log(`  PV${r.pvNumber}  ${r.effectiveDate}  (run: ${r.id.slice(0, 8)}…)`)

  // 2. Canonical subjects + threads
  const [{ data: csRows }, { data: stiRows }] = await Promise.all([
    sb.from('canonical_subject').select('id, label').eq('site_id', SITE_ID).eq('status', 'active'),
    sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', SITE_ID),
  ])

  type CsRow  = { id: string; label: string }
  type StiRow = { subject_thread_id: string; canonical_subject_id: string }

  const subjects   = (csRows ?? []) as CsRow[]
  const threadToCs = new Map(((stiRows ?? []) as StiRow[]).map((r) => [r.subject_thread_id, r.canonical_subject_id]))
  const threadSet  = new Set(threadToCs.keys())

  console.log(`\n${subjects.length} canonical subjects actifs`)

  // 3. Propositions — batches de ${PROP_BATCH} runs
  type PropRow = { id: string; extraction_run_id: string; subject_thread_id: string; document_status: string | null; proposal_family: string }
  const propBatches = await Promise.all(
    Array.from({ length: Math.ceil(runIds.length / PROP_BATCH) }, (_, i) =>
      sb.from('document_extraction_proposal')
        .select('id, extraction_run_id, subject_thread_id, document_status, proposal_family')
        .in('extraction_run_id', runIds.slice(i * PROP_BATCH, (i + 1) * PROP_BATCH)),
    ),
  )
  const proposals: PropRow[] = []
  for (const { data } of propBatches) {
    for (const p of (data ?? []) as PropRow[]) {
      if (threadSet.has(p.subject_thread_id)) proposals.push(p)
    }
  }

  console.log(`${proposals.length} propositions chargées`)

  // 4. Agréger par (csId, runId) — statut le plus sévère
  const csFamilies  = new Map<string, Set<string>>()
  const csRunMap    = new Map<string, Set<string>>()
  const csRunStatus = new Map<string, Map<string, string>>()
  const csStatuses  = new Map<string, string[]>()
  const propToCs    = new Map<string, string>()
  const csPropIds   = new Map<string, string[]>()

  for (const p of proposals) {
    const csId = threadToCs.get(p.subject_thread_id)
    if (!csId) continue
    propToCs.set(p.id, csId)

    if (!csFamilies.has(csId))  csFamilies.set(csId, new Set())
    if (!csRunMap.has(csId))    csRunMap.set(csId, new Set())
    if (!csRunStatus.has(csId)) csRunStatus.set(csId, new Map())
    if (!csStatuses.has(csId))  csStatuses.set(csId, [])
    if (!csPropIds.has(csId))   csPropIds.set(csId, [])

    csFamilies.get(csId)!.add(p.proposal_family)
    csRunMap.get(csId)!.add(p.extraction_run_id)
    csPropIds.get(csId)!.push(p.id)
    if (p.document_status) csStatuses.get(csId)!.push(p.document_status)

    const incoming    = p.document_status ?? 'open'
    const runStatuses = csRunStatus.get(csId)!
    const current     = runStatuses.get(p.extraction_run_id)
    if (!current || (STATUS_RANK[incoming] ?? 99) < (STATUS_RANK[current] ?? 99)) {
      runStatuses.set(p.extraction_run_id, incoming)
    }
  }

  // 5. Matérialisations (batches de 80) pour scoring complet avec entités
  const allPropIds = proposals.map((p) => p.id)
  type MatRow = { proposal_id: string; target_entity_type: string; target_entity_id: string }
  const MAT_BATCH = 80
  const matBatches = await Promise.all(
    Array.from({ length: Math.ceil(allPropIds.length / MAT_BATCH) || 1 }, (_, i) =>
      allPropIds.length > 0
        ? sb.from('document_proposal_materialization')
            .select('proposal_id, target_entity_type, target_entity_id')
            .in('proposal_id', allPropIds.slice(i * MAT_BATCH, (i + 1) * MAT_BATCH))
            .in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])
        : Promise.resolve({ data: [] }),
    ),
  )
  const matRows: MatRow[] = []
  for (const { data } of matBatches) matRows.push(...((data ?? []) as MatRow[]))

  const csEntities = new Map<string, Map<string, string[]>>()
  for (const m of matRows) {
    const csId = propToCs.get(m.proposal_id)
    if (!csId) continue
    if (!csEntities.has(csId)) csEntities.set(csId, new Map())
    const byType = csEntities.get(csId)!
    if (!byType.has(m.target_entity_type)) byType.set(m.target_entity_type, [])
    byType.get(m.target_entity_type)!.push(m.target_entity_id)
  }

  const actionIds: string[]   = []
  const reserveIds: string[]  = []
  const deadlineIds: string[] = []
  for (const byType of csEntities.values()) {
    actionIds.push(...(byType.get('site_action') ?? []))
    reserveIds.push(...(byType.get('site_reserve') ?? []))
    deadlineIds.push(...(byType.get('site_deadline') ?? []))
  }

  const [{ data: actData }, { data: resData }, { data: dlData }] = await Promise.all([
    actionIds.length > 0   ? sb.from('site_actions').select('id, status').in('id', actionIds) : Promise.resolve({ data: [] }),
    reserveIds.length > 0  ? sb.from('site_reserve').select('id, status').in('id', reserveIds) : Promise.resolve({ data: [] }),
    deadlineIds.length > 0 ? sb.from('site_deadlines').select('id, status, due_date').in('id', deadlineIds) : Promise.resolve({ data: [] }),
  ])

  const actionStatusMap   = new Map<string, string>()
  const reserveStatusMap  = new Map<string, string>()
  const deadlineStatusMap = new Map<string, { status: string; dueDate: string | null }>()
  for (const r of (actData ?? []) as Array<{ id: string; status: string }>) actionStatusMap.set(r.id, r.status)
  for (const r of (resData ?? []) as Array<{ id: string; status: string }>) reserveStatusMap.set(r.id, r.status)
  for (const r of (dlData ?? []) as Array<{ id: string; status: string; due_date: string | null }>) {
    deadlineStatusMap.set(r.id, { status: r.status, dueDate: r.due_date })
  }

  console.log(`${matRows.length} matérialisations | ${actionIds.length} actions | ${reserveIds.length} réserves | ${deadlineIds.length} échéances`)

  // 6. Score complet (identique à getActivityMap)
  type Scored = { id: string; label: string; score: number; openActions: number; openReserves: number }
  const scored: Scored[] = []

  for (const cs of subjects) {
    const families = csFamilies.get(cs.id) ?? new Set()
    if (families.size > 0 && [...families].every((f) => NON_SUBJECT_FAMILIES.has(f))) continue
    if (families.size > 0 && [...families].every((f) => f === 'deadline')) continue

    const csRuns  = [...(csRunMap.get(cs.id) ?? [])]
    const pvCount = csRuns.length
    if (pvCount === 0) continue

    const positions = csRuns.map((r) => runIndex.get(r) ?? -1).filter((p) => p >= 0).sort((a, b) => a - b)
    let reappearance = false
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] >= 3) { reappearance = true; break }
    }

    const recentOccurrence = csRuns.some((r) => lastRunIds.has(r))
    const lastRunId   = csRuns.reduce((best, r) => ((runIndex.get(r) ?? -1) > (runIndex.get(best) ?? -1) ? r : best), csRuns[0])
    const lastDateStr = runs.find((r) => r.id === lastRunId)?.effectiveDate
    const daysSilent  = lastDateStr ? Math.round(Math.abs(TODAY.getTime() - new Date(lastDateStr).getTime()) / 86_400_000) : 999

    const byType = csEntities.get(cs.id) ?? new Map<string, string[]>()
    const openActions     = (byType.get('site_action') ?? []).filter((id) => { const s = actionStatusMap.get(id); return s !== 'done' && s !== 'cancelled' }).length
    const openReserves    = (byType.get('site_reserve') ?? []).filter((id) => reserveStatusMap.get(id) === 'open').length
    const activeDeadlines = (byType.get('site_deadline') ?? []).filter((id) => { const d = deadlineStatusMap.get(id); return d?.status === 'to_plan' || d?.status === 'planned' }).length
    const overdueDeadlines = (byType.get('site_deadline') ?? []).filter((id) => { const d = deadlineStatusMap.get(id); if (!d || (d.status !== 'to_plan' && d.status !== 'planned')) return false; if (!d.dueDate) return false; return new Date(d.dueDate) < TODAY }).length

    const statuses  = csStatuses.get(cs.id) ?? []
    const fullyDone = statuses.length > 0 && statuses.every((s) => s === 'done') && openActions === 0 && openReserves === 0 && activeDeadlines === 0
    if (fullyDone) continue

    const score = Math.round(
      pvCount * 2 + (reappearance ? 3 : 0) + openActions * 4 + openReserves * 5 +
      activeDeadlines * 4 + overdueDeadlines * 6 + (recentOccurrence ? 2 : 0) - daysSilent / 30,
    )
    if (score < IMPORTANT_THRESHOLD) continue

    scored.push({ id: cs.id, label: cs.label, score, openActions, openReserves })
  }

  scored.sort((a, b) => b.score - a.score)
  const topSubjects = scored.slice(0, ACTIVITY_MAX)

  console.log(`\nTop ${topSubjects.length} sujets sélectionnés (score complet avec entités) :`)
  for (const s of topSubjects) {
    const extra = [s.openActions > 0 ? `${s.openActions} act.` : null, s.openReserves > 0 ? `${s.openReserves} rés.` : null].filter(Boolean).join(', ')
    console.log(`  [${s.score.toString().padStart(3)}] ${s.label}${extra ? `  (${extra})` : ''}`)
  }

  // 6. Grille activité : cellules par run pour chaque sujet
  const subjectRows: SubjectRow[] = topSubjects.map((cs) => {
    const runStatuses = csRunStatus.get(cs.id)
    const cells: ActivityCellState[] = []
    let prevStatus: string | null = null

    for (const run of runs) {
      const status = runStatuses?.get(run.id)
      if (!status) {
        cells.push('absent')
        continue
      }
      const state = cellState(status, prevStatus)
      cells.push(state)
      prevStatus = status
    }

    return { canonicalSubjectId: cs.id, label: cs.label, score: cs.score, cells }
  })

  // 7. Afficher la grille
  console.log('\n--- Grille activité (sujets × PV) ---')
  const header = '                              ' + runs.map((r) => `PV${r.pvNumber}`.padEnd(6)).join('')
  console.log(header)
  for (const row of subjectRows) {
    const stateChar = { absent: '·', first: '○', open: '●', non_compliant: '⚠', done: '✓', reopened: '↩' }
    const cells = row.cells.map((s) => (stateChar[s] ?? '?').padEnd(6)).join('')
    const label = row.label.slice(0, 28).padEnd(30)
    console.log(`${label}${cells}`)
  }

  // 8. Détection des périodes
  const groups  = groupRunsIntoPeriods(runs)
  const periods = groups.map((g) => computePeriodFacts(g, runs, subjectRows))

  console.log(`\n\n=== READ-MODEL — ${periods.length} période(s) détectée(s) ===`)
  for (let i = 0; i < periods.length; i++) printPeriod(periods[i], i)

  // 9. Résumé des gaps
  console.log('\n\n--- Gaps entre PV consécutifs ---')
  for (let i = 1; i < runs.length; i++) {
    const gap = daysBetween(runs[i - 1].effectiveDate, runs[i].effectiveDate)
    const marker = gap > SILENCE_THRESHOLD_DAYS ? ' ← SILENCE' : gap > GAP_THRESHOLD_DAYS ? ' ← nouvelle période' : ''
    console.log(`  PV${runs[i-1].pvNumber} → PV${runs[i].pvNumber} : ${gap}j${marker}`)
  }

  console.log('\n=== Fin de simulation ===')
}

main().catch(console.error)
