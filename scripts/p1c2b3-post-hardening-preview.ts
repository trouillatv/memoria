// P1-C2B.3 — Preview COURT post-hardening (Gate 1 + Gate 2), avant le backfill réel des 187.
// PAS le dry-run exhaustif (pas d'appel LLM, pas de simulation par bucket). Lecture seule.
//
// Rejoue uniquement la baseline demandée par Vincent :
//   1. fetchCboMemberships() sur l'univers physique complet → doit renvoyer 23 memberships (pas 0).
//   2. Les 2 entités affectées par le bug Gate 1 retrouvent bien leur vrai CBO.
//   3. 0 canonical_business_object pointant vers un canonical_subject fusionné (stale) — Gate 2.
//
// Usage : npx tsx scripts/p1c2b3-post-hardening-preview.ts

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '../lib/supabase/admin'
import { fetchCboMemberships } from '../lib/knowledge/canonical-business-object-projection'

const GATE1_AFFECTED_IDS = [
  '00a57eca-8ac2-4f17-9eb4-984fed66b02f',
  '793b0ca1-2c4d-42b2-8e77-bd26cbe20342',
]

async function main() {
  const sb = createAdminClient()
  const out: string[] = []
  const log = (m: string) => out.push(m)

  log('=== P1-C2B.3 — preview court post-hardening (Gate 1 + Gate 2) ===\n')

  // ── 1. Univers physique complet (même requête que le dry-run) ─────────────
  const [{ data: actions }, { data: reserves }, { data: deadlines }] = await Promise.all([
    sb.from('site_actions').select('id'),
    sb.from('site_reserve').select('id'),
    sb.from('site_deadlines').select('id'),
  ])
  const allEntityIds = [
    ...((actions ?? []) as Array<{ id: string }>).map((r) => r.id),
    ...((reserves ?? []) as Array<{ id: string }>).map((r) => r.id),
    ...((deadlines ?? []) as Array<{ id: string }>).map((r) => r.id),
  ]
  log(`Univers physique (site_action+site_reserve+site_deadline) : ${allEntityIds.length}`)

  // ── 2. Gate 1 — fetchCboMemberships() chunké, doit renvoyer 23 (pas 0) ────
  const cboMembership = await fetchCboMemberships(allEntityIds)
  log(`\nGate 1 — fetchCboMemberships() memberships trouvées        : ${cboMembership.size} (attendu 23)`)
  log(`Gate 1 — verdict : ${cboMembership.size === 23 ? 'PASS' : 'ÉCART À EXPLIQUER'}`)

  // ── 3. Les 2 entités Gate 1 retrouvent-elles leur vrai CBO ? ──────────────
  log('\nGate 1 — entités précédemment mal classées (faux "0 déjà membre") :')
  let gate1EntitiesOk = true
  for (const id of GATE1_AFFECTED_IDS) {
    const cboId = cboMembership.get(id)
    log(`  - ${id} -> canonical_business_object_id=${cboId ?? 'ABSENT'}`)
    if (!cboId) gate1EntitiesOk = false
  }
  log(`Gate 1 — verdict entités affectées : ${gate1EntitiesOk ? 'PASS (les 2 retrouvent un CBO réel)' : 'FAIL'}`)

  // ── 4. Gate 2 — 0 CBO pointant vers un canonical_subject fusionné (stale) ─
  const { data: cbos } = await sb
    .from('canonical_business_object')
    .select('id, label, canonical_subject_id')
  const cboRows = (cbos ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>
  const subjectIds = [...new Set(cboRows.map((c) => c.canonical_subject_id).filter((id): id is string => Boolean(id)))]
  const { data: subjects } = subjectIds.length
    ? await sb.from('canonical_subject').select('id, status, merged_into').in('id', subjectIds)
    : { data: [] as Array<{ id: string; status: string; merged_into: string | null }> }
  const subjectById = new Map((subjects ?? []).map((s) => [s.id as string, s as { id: string; status: string; merged_into: string | null }]))

  const staleCbos = cboRows.filter((c) => c.canonical_subject_id && subjectById.get(c.canonical_subject_id)?.status === 'merged')
  log(`\nGate 2 — total canonical_business_object                   : ${cboRows.length}`)
  log(`Gate 2 — CBO pointant vers un canonical_subject fusionné (stale) : ${staleCbos.length} (attendu 0)`)
  for (const c of staleCbos) {
    const subj = subjectById.get(c.canonical_subject_id!)
    log(`  [FAIL] CBO ${c.id} "${c.label}" -> canonical_subject_id=${c.canonical_subject_id} (merged, winner réel=${subj?.merged_into})`)
  }
  log(`Gate 2 — verdict : ${staleCbos.length === 0 ? 'PASS' : 'FAIL'}`)

  // ── Verdict global ──────────────────────────────────────────────────────
  log('\n' + '─'.repeat(78))
  log('VERDICT GLOBAL')
  log('─'.repeat(78))
  const allPass = cboMembership.size === 23 && gate1EntitiesOk && staleCbos.length === 0
  log(allPass ? 'GO — preview conforme, prêt pour le backfill réel des 187 éligibles.' : 'NO-GO — écart(s) ci-dessus à investiguer avant le backfill.')

  writeFileSync('post-hardening-preview-out.txt', out.join('\n'), 'utf-8')
  console.log(out.join('\n'))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
