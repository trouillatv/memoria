// BACKFILL DATE-PROVENANCE-P0 — PETRO, 42 occurrences terrain.
// GO explicite de Vincent le 2026-08-24, sur la base du dry-run
// scripts/_audit-date-provenance-dryrun.ts.
//
// Périmètre STRICT — exactement le même calcul que le dry-run :
//   source_kind IN ('field_visit','meeting'), rattachées à un site_report,
//   effective_date corrigée vers (started_at ?? created_at).slice(0,10).
// Aucune occurrence historical_pdf touchée. Aucune autre table.
//
// Snapshot avant/après des 13 sujets impactés : lastSeenAt, lastMeaningfulChangeAt,
// stagnationDays, isStagnant, ordre des occurrences — via le read-model réel
// (getCanonicalSubjectLife), pas un recalcul ad hoc.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'
import { getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'

const db = createAdminClient()
function h(t: string) {
  console.log(`\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`)
}

type Fix = { id: string; from: string; to: string; subj: string }

async function computeFixes(): Promise<Fix[]> {
  const { data: reports } = await db
    .from('site_reports')
    .select('id, site_id, started_at, created_at')
  const repById = new Map((reports ?? []).map((r: any) => [r.id, r]))

  const { data: occs } = await db
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_kind, source_ref_id, effective_date')

  const TERRAIN = new Set(['field_visit', 'meeting'])
  const fixes: Fix[] = []
  for (const o of occs ?? []) {
    if (!TERRAIN.has(o.source_kind)) continue
    const r = repById.get(o.source_ref_id)
    if (!r) continue
    const expected = (r.started_at ?? r.created_at).slice(0, 10)
    if (o.effective_date === expected) continue
    fixes.push({ id: o.id, from: o.effective_date, to: expected, subj: o.canonical_subject_id })
  }
  return fixes
}

async function snapshot(label: string, subjectIds: string[]) {
  h(`SNAPSHOT ${label}`)
  for (const sid of subjectIds) {
    const life = await getCanonicalSubjectLife(sid)
    if (!life) {
      console.log(`  ${sid.slice(0, 8)} — introuvable (fusionné ?)`)
      continue
    }
    console.log(
      `  ${sid.slice(0, 8)} "${life.label.slice(0, 40).padEnd(40)}" ` +
        `lastSeenAt=${life.lastSeenAt ?? '(null)'}  LMCA=${life.lastMeaningfulChangeAt ?? '(null)'}  ` +
        `stagnationDays=${life.stagnationDays}  isStagnant=${life.isStagnant}  ` +
        `occCount=${life.occurrences.length}`,
    )
  }
}

async function main() {
  const fixes = await computeFixes()
  const subjectIds = [...new Set(fixes.map((f) => f.subj))]

  h('PÉRIMÈTRE')
  console.log(`  occurrences à corriger : ${fixes.length}`)
  console.log(`  sujets impactés        : ${subjectIds.length}`)
  if (fixes.length !== 42) {
    console.log(`  ⚠ ATTENDU 42, TROUVÉ ${fixes.length} — ARRÊT, ne pas écrire sans revalider.`)
    process.exit(1)
  }

  await snapshot('AVANT', subjectIds)

  h('ÉCRITURE')
  let ok = 0
  let failed = 0
  for (const f of fixes) {
    const { error } = await db
      .from('canonical_subject_occurrence')
      .update({ effective_date: f.to })
      .eq('id', f.id)
    if (error) {
      failed++
      console.log(`  ✗ ${f.id} : ${error.message}`)
    } else {
      ok++
    }
  }
  console.log(`  UPDATE réussis : ${ok} / ${fixes.length}`)
  if (failed > 0) console.log(`  ⚠ ÉCHECS : ${failed}`)

  h('VÉRIFICATION POST-ÉCRITURE — re-lecture brute')
  const { data: verify } = await db
    .from('canonical_subject_occurrence')
    .select('id, effective_date')
    .in('id', fixes.map((f) => f.id))
  const verifyMap = new Map((verify ?? []).map((v) => [v.id, v.effective_date]))
  const stillWrong = fixes.filter((f) => verifyMap.get(f.id) !== f.to)
  console.log(`  occurrences encore incorrectes après écriture : ${stillWrong.length}`)
  for (const f of stillWrong.slice(0, 10)) console.log(`    ${f.id} attendu=${f.to} lu=${verifyMap.get(f.id)}`)

  await snapshot('APRÈS', subjectIds)

  h('RAPPEL — dry-run avait annoncé')
  console.log('  7/13 sujets avec changement d’ORDRE des occurrences')
  console.log('  10/13 sujets avec changement de lastSeenAt')
  console.log('  49 paires (sujet, date) en doublon après correction (non bloquant)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
