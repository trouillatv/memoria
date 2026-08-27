/**
 * Backfill A — vérification de l'état ÉCRIT (lecture seule) : bilan P3 + anomalies réelles.
 * Lit canonical_subject_occurrence historical_pdf après backfill et compare au snapshot.
 * Usage : npx tsx --env-file=.env.local scripts/verify-backfillA-state.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: occ } = await sb.from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, state_key, effective_date, event_date')
    .eq('source_kind', 'historical_pdf').limit(100000)
  const rows = occ ?? []

  // multiplicité par couple (rapport, sujet)
  const byCouple = new Map<string, Set<string>>()
  for (const o of rows) {
    const k = `${o.source_ref_id}::${o.canonical_subject_id}`
    if (!byCouple.has(k)) byCouple.set(k, new Set())
    byCouple.get(k)!.add(o.state_key ?? 'null')
  }
  const multi = [...byCouple.values()].filter((s) => s.size > 1).length
  const nullStateKey = rows.filter((o) => !o.state_key).length
  const evFilled = rows.filter((o) => o.event_date).length

  // anomalies : event_date > effective_date (fait postérieur au doc), event < 2015
  const anomalies: string[] = []
  for (const o of rows) {
    if (o.event_date && o.effective_date && o.event_date > o.effective_date)
      anomalies.push(`EVENT>DOC sujet=${o.canonical_subject_id.slice(0, 8)} ${o.state_key} event=${o.event_date} doc=${o.effective_date}`)
    if (o.event_date && o.event_date < '2015-01-01')
      anomalies.push(`EVENT<2015 ${o.state_key} ${o.event_date}`)
  }

  // doublons state_key sur même (sujet, rapport) — violation d'idempotence D1
  const dupCheck = new Map<string, number>()
  for (const o of rows) {
    const k = `${o.source_ref_id}::${o.canonical_subject_id}::${o.state_key}`
    dupCheck.set(k, (dupCheck.get(k) ?? 0) + 1)
  }
  const dups = [...dupCheck.entries()].filter(([, n]) => n > 1)

  const snap = JSON.parse(readFileSync('_backfillA_snapshot.json', 'utf8'))

  console.log('=== BILAN P3 — état écrit (canonical_subject_occurrence historical_pdf) ===')
  console.log(`Occurrences AVANT (snapshot) : ${snap.occ.length}`)
  console.log(`Occurrences APRÈS            : ${rows.length}  (delta +${rows.length - snap.occ.length})`)
  console.log(`Couples (rapport,sujet) multi-état : ${multi}`)
  console.log(`state_key NULL (devrait être 0)    : ${nullStateKey}`)
  console.log(`event_date renseignées             : ${evFilled}`)
  console.log(`\nAnomalies temporelles : ${anomalies.length}`)
  for (const a of anomalies.slice(0, 30)) console.log('  ⚠️', a)
  console.log(`Doublons (sujet,rapport,state_key) [violation idempotence D1] : ${dups.length}`)
  for (const [k, n] of dups.slice(0, 20)) console.log(`  ⚠️ ${k} ×${n}`)
  console.log(`\nVERDICT : ${anomalies.length === 0 && dups.length === 0 && nullStateKey === 0 ? '✅ propre' : '❌ anomalies à examiner'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
