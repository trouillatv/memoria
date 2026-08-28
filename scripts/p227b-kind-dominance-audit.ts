/**
 * #227-b — AUDIT READ-ONLY de la dominance `kind`. Aucun correctif, aucun UPDATE, aucune migration.
 *
 * Contexte : deux concepts nommés `kind` coexistent.
 *   (A) canonical_subject.kind STOCKÉ (mig 355) : nature durable ∈ {actor, business_subject}, fixée à la
 *       création depuis la provenance (person/company ⇒ actor), jamais depuis l'état.
 *   (B) NavigableSubjectSummary.kind CALCULÉ (canonical-subject-life.ts:1495) :
 *          const kind = occs.find((o) => o.family)?.family ?? null
 *       = famille de la PREMIÈRE occurrence chronologique portant une famille (state_key). C'est CE kind-là
 *       qui alimente isOperationalSubject() ({person,company,knowledge_fact} exclus) → l'Aperçu et la grille.
 *   Le kind (B) IGNORE le kind stocké (A). Un business_subject dont la plus ancienne occurrence est un
 *   knowledge_fact est donc classé non-opérationnel à vie, même s'il porte ensuite action/observation/open.
 *
 * Ce script MESURE l'ampleur : distributions, sujets business avec kind calculé=knowledge_fact portant des
 * états open/reopened ou des familles action/observation/deadline, et compare earliest vs majority vs last.
 * READ-ONLY. HARD STOP. Exécuter : npx tsx --env-file=.env.local scripts/p227b-kind-dominance-audit.ts
 */
import { createClient } from '@supabase/supabase-js'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const EXCLUDED_FAMILIES = new Set(['person', 'company', 'knowledge_fact']) // isOperationalSubject
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const TEMOINS: Record<string, string> = {
  '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9': 'A électrique',
  'b78526f9-9dc6-43f7-8edb-e4278f207988': 'B cuisson',
  '22bef24e-3a1a-4566-beca-c5a5c845dd1d': 'C nettoyage',
  '75da7744-287d-47fd-80d8-e62ea1660ca1': 'D flux',
  'cc12fce6-8780-4f93-88a1-21905a37325b': 'E éclairage',
}
function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }
function tallyLine(m: Map<string, number>): string { return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  ') }

type Occ = { canonical_subject_id: string; state_key: string; state_status: string | null; effective_date: string; event_date: string | null }

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  #227-b — AUDIT READ-ONLY dominance kind (calculé vs stocké)                     ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')

  // ── Corpus : toutes les occurrences PV historiques + kind stocké par cs ──────
  const { data: occRows } = await sb.from('canonical_subject_occurrence')
    .select('canonical_subject_id, state_key, state_status, effective_date, event_date')
    .eq('source_kind', 'historical_pdf').not('validation_status', 'in', '("rejected","source_superseded")').limit(100000)
  const occs = (occRows ?? []) as Occ[]
  const byCs = new Map<string, Occ[]>()
  for (const o of occs) { const l = byCs.get(o.canonical_subject_id) ?? []; l.push(o); byCs.set(o.canonical_subject_id, l) }
  const csIds = [...byCs.keys()]
  const storedKind = new Map<string, string>()
  for (let i = 0; i < csIds.length; i += 300) {
    const { data } = await sb.from('canonical_subject').select('id, kind').in('id', csIds.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ id: string; kind: string }>) storedKind.set(r.id, r.kind)
  }

  const pos = (o: Occ) => (o.event_date ?? o.effective_date)
  const earliestFam = new Map<string, string>()
  const lastFam = new Map<string, string>()
  const majorityFam = new Map<string, string>()
  const famSetByCs = new Map<string, Set<string>>()
  const hasOpen = new Set<string>()
  for (const [cs, list] of byCs) {
    const sorted = [...list].sort((a, b) => pos(a).localeCompare(pos(b)) || a.effective_date.localeCompare(b.effective_date))
    earliestFam.set(cs, sorted[0].state_key)
    lastFam.set(cs, sorted[sorted.length - 1].state_key)
    const fc = new Map<string, number>(); const set = new Set<string>()
    for (const o of list) { fc.set(o.state_key, (fc.get(o.state_key) ?? 0) + 1); set.add(o.state_key); if (o.state_status === 'open') hasOpen.add(cs) }
    majorityFam.set(cs, [...fc].sort((a, b) => b[1] - a[1])[0][0])
    famSetByCs.set(cs, set)
  }

  // ── Distributions ────────────────────────────────────────────────────────────
  const distStored = new Map<string, number>(); const distEarliest = new Map<string, number>()
  const distMajority = new Map<string, number>(); const distLast = new Map<string, number>()
  for (const cs of csIds) {
    distStored.set(storedKind.get(cs) ?? 'null', (distStored.get(storedKind.get(cs) ?? 'null') ?? 0) + 1)
    distEarliest.set(earliestFam.get(cs)!, (distEarliest.get(earliestFam.get(cs)!) ?? 0) + 1)
    distMajority.set(majorityFam.get(cs)!, (distMajority.get(majorityFam.get(cs)!) ?? 0) + 1)
    distLast.set(lastFam.get(cs)!, (distLast.get(lastFam.get(cs)!) ?? 0) + 1)
  }
  console.log(`\nCorpus : ${csIds.length} canonical_subject avec ≥1 occurrence PV historique.`)
  console.log(`  kind STOCKÉ (mig 355)      : ${tallyLine(distStored)}`)
  console.log(`  kind CALCULÉ = earliest    : ${tallyLine(distEarliest)}   ← alimente isOperationalSubject`)
  console.log(`  si on prenait la MAJORITÉ  : ${tallyLine(distMajority)}`)
  console.log(`  si on prenait le DERNIER   : ${tallyLine(distLast)}`)

  // ── Instabilité earliest vs majority vs last ────────────────────────────────
  let neqMaj = 0, neqLast = 0, mixed = 0
  for (const cs of csIds) {
    if (earliestFam.get(cs) !== majorityFam.get(cs)) neqMaj++
    if (earliestFam.get(cs) !== lastFam.get(cs)) neqLast++
    if ((famSetByCs.get(cs)?.size ?? 0) > 1) mixed++
  }
  console.log(`\nInstabilité du kind calculé (earliest) :`)
  console.log(`  earliest ≠ majorité : ${neqMaj}/${csIds.length}   earliest ≠ dernier : ${neqLast}/${csIds.length}   familles multiples : ${mixed}/${csIds.length}`)

  // ── Le défaut central : business_subject avalés par earliest=knowledge_fact ──
  const bizKf = csIds.filter((cs) => storedKind.get(cs) === 'business_subject' && earliestFam.get(cs) === 'knowledge_fact')
  const bizKfOpen = bizKf.filter((cs) => hasOpen.has(cs))
  const OP_FAMS = new Set(['action', 'observation', 'deadline', 'reservation', 'non_conformity'])
  const bizKfMixedOp = bizKf.filter((cs) => [...(famSetByCs.get(cs) ?? [])].some((f) => OP_FAMS.has(f)))
  const excludedByFamily = csIds.filter((cs) => EXCLUDED_FAMILIES.has(earliestFam.get(cs)!))
  const excludedButBusiness = excludedByFamily.filter((cs) => storedKind.get(cs) === 'business_subject')
  const excludedAndActor = excludedByFamily.filter((cs) => storedKind.get(cs) === 'actor')
  console.log(`\n★ DÉFAUT CENTRAL — exclusion opérationnelle par famille calculée :`)
  console.log(`  sujets exclus (earliest ∈ {person,company,knowledge_fact}) : ${excludedByFamily.length}`)
  console.log(`     · dont kind stocké = actor (exclusion LÉGITIME)          : ${excludedAndActor.length}`)
  console.log(`     · dont kind stocké = business_subject (exclusion À TORT) : ${excludedButBusiness.length}`)
  console.log(`  business_subject avec earliest=knowledge_fact               : ${bizKf.length}`)
  console.log(`     · dont portant un état OPEN                              : ${bizKfOpen.length}`)
  console.log(`     · dont historique MIXTE (≥1 famille action/observation/deadline/réservation) : ${bizKfMixedOp.length}`)

  // ── Détail Bella (5 open + 3 reopened) ───────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════════════════')
  console.log('BELLA — 5 témoins : kind stocké vs calculé, familles d\'occurrences, état, objets')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  const nav = await getNavigableSubjectsForSite(BELLA)
  const navByCs = new Map(nav.map((s) => [s.canonicalSubjectId, s]))
  console.log(`${pad('Témoin', 14)}${pad('kindStocké', 16)}${pad('kindCalculé', 14)}${pad('triState', 10)}${pad('objets', 10)}familles occ`)
  for (const [cs, name] of Object.entries(TEMOINS)) {
    const s = navByCs.get(cs)
    const fams = [...(famSetByCs.get(cs) ?? [])].join(',')
    const obj = s ? `A${s.activeObjects.actionsOpen}/R${s.activeObjects.reservesOpen}/D${s.activeObjects.deadlinesActive}` : '—'
    console.log(`${pad(name, 14)}${pad(storedKind.get(cs) ?? '?', 16)}${pad(s?.kind ?? 'null', 14)}${pad(s?.currentTriState ?? '—', 10)}${pad(obj, 10)}${fams}`)
  }
  console.log('\nLecture : kind stocké = nature durable (mig 355). kind calculé = famille de la 1re occurrence,')
  console.log('          seul utilisé par isOperationalSubject → cause de l\'exclusion. HARD STOP, aucun correctif.')
}
main().catch((e) => { console.error(e); process.exit(1) })
