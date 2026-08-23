// AUDIT LECTURE SEULE — RECONCILIATION-RELIABILITY P0.
// Trois questions, aucune écriture :
//   1. PRÉVALENCE  — combien de visites projetées mais jamais réconciliées ?
//   2. COÛT TEMPOREL — combien de temps prend réellement la réconciliation ?
//                      Mesure : canonical_reconciled_at − debrief_projected_at.
//   3. VERROUS      — combien de verrous jamais relâchés (started_at non nul) ?
// AUCUNE ÉCRITURE.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'

type Row = {
  id: string
  site_id: string | null
  title: string | null
  status: string | null
  origin: string | null
  started_at: string | null
  created_at: string | null
  debrief_projected_at: string | null
  debrief_projection_error: string | null
  canonical_reconciled_at: string | null
  canonical_reconcile_started_at: string | null
  canonical_reconcile_error: string | null
}

function ms(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime()
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}

async function main() {
  const db = createAdminClient()

  const { data, error } = await db
    .from('site_reports')
    .select(
      'id, site_id, title, status, origin, started_at, created_at, ' +
        'debrief_projected_at, debrief_projection_error, ' +
        'canonical_reconciled_at, canonical_reconcile_started_at, canonical_reconcile_error',
    )
    .not('debrief_projected_at', 'is', null)
  if (error) return console.error('ERREUR site_reports:', error)

  const rows = (data ?? []) as Row[]
  const done = rows.filter((r) => r.canonical_reconciled_at)
  const missing = rows.filter((r) => !r.canonical_reconciled_at)

  console.log('=== 1. PRÉVALENCE (toutes organisations, tous chantiers) ===\n')
  console.log(`visites projetées         : ${rows.length}`)
  console.log(`  réconciliées            : ${done.length}`)
  console.log(`  NON réconciliées        : ${missing.length}  (${((missing.length / (rows.length || 1)) * 100).toFixed(1)} %)`)

  const withError = missing.filter((r) => r.canonical_reconcile_error)
  const silent = missing.filter((r) => !r.canonical_reconcile_error)
  console.log(`    dont erreur tracée    : ${withError.length}`)
  console.log(`    dont SILENCIEUSES     : ${silent.length}  ← perte invisible`)

  if (missing.length > 0) {
    const ages = missing
      .map((r) => (r.debrief_projected_at ? Date.now() - new Date(r.debrief_projected_at).getTime() : 0))
      .sort((a, b) => b - a)
    console.log(`  plus ancienne          : ${(ages[0] / 86_400_000).toFixed(1)} jours depuis la projection`)
  }

  console.log('\n  Détail des non réconciliées :')
  for (const r of missing.sort((a, b) => (a.debrief_projected_at ?? '').localeCompare(b.debrief_projected_at ?? ''))) {
    const lock = r.canonical_reconcile_started_at
      ? `LOCK ${r.canonical_reconcile_started_at.slice(0, 16)}`
      : 'lock=null'
    console.log(
      `   ${(r.started_at ?? r.created_at ?? '').slice(0, 10)}  ${String(r.status).padEnd(9)} ` +
        `origin=${String(r.origin ?? 'null').padEnd(18)} ${lock.padEnd(22)} ` +
        `err=${r.canonical_reconcile_error ? r.canonical_reconcile_error.slice(0, 40) : 'NULL'}  ${r.id.slice(0, 8)}`,
    )
  }

  console.log('\n=== 2. COÛT TEMPOREL RÉEL (réconciliations abouties) ===\n')
  const durations = done
    .filter((r) => r.debrief_projected_at && r.canonical_reconciled_at)
    .map((r) => ms(r.canonical_reconciled_at!, r.debrief_projected_at!))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b)

  if (durations.length === 0) {
    console.log('  aucune mesure exploitable')
  } else {
    const s = (v: number) => `${(v / 1000).toFixed(1)} s`
    console.log(`  échantillon : ${durations.length} visites`)
    console.log(`  min         : ${s(durations[0])}`)
    console.log(`  médiane     : ${s(pct(durations, 0.5))}`)
    console.log(`  p75         : ${s(pct(durations, 0.75))}`)
    console.log(`  p90         : ${s(pct(durations, 0.9))}`)
    console.log(`  max         : ${s(durations[durations.length - 1])}`)
    const over10 = durations.filter((d) => d > 10_000).length
    const over30 = durations.filter((d) => d > 30_000).length
    console.log(`  > 10 s      : ${over10} (${((over10 / durations.length) * 100).toFixed(0)} %)`)
    console.log(`  > 30 s      : ${over30} (${((over30 / durations.length) * 100).toFixed(0)} %)`)
    console.log('\n  NOTE : borne HAUTE. L\'écart mesuré inclut l\'écriture de debrief_projected_at')
    console.log('  et le démarrage du bloc détaché ; la réconciliation seule est plus courte.')
  }

  console.log('\n=== 3. VERROUS JAMAIS RELÂCHÉS ===\n')
  const stuck = rows.filter((r) => r.canonical_reconcile_started_at)
  console.log(`  reports avec canonical_reconcile_started_at non nul : ${stuck.length}`)
  for (const r of stuck) {
    const ageMin = (Date.now() - new Date(r.canonical_reconcile_started_at!).getTime()) / 60_000
    console.log(
      `   ${r.id.slice(0, 8)}  lock posé il y a ${(ageMin / 1440).toFixed(1)} jours  ` +
        `réconcilié=${r.canonical_reconciled_at ? 'oui' : 'NON'}`,
    )
  }
  console.log('\n  (TTL du verrou = 5 min → au-delà, decideReconcileLock renvoie "acquire" :')
  console.log('   le verrou ne bloque PAS une reprise, il ne la déclenche simplement jamais.)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
