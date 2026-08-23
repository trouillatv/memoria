// TRANCHE 3 — SONDE CIBLÉE, LECTURE SEULE.
// L'échéance « Démarrage du nettoyages » (Lycée PETRO ATTITI) est l'exemple même
// cité par Vincent. Question : l'absence de contradiction est-elle un FAIT
// (aucune preuve terrain de démarrage) ou un DÉFAUT DE RAPPROCHEMENT (la preuve
// existe mais n'est reliée à rien) ? Aucune écriture.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'

const db = createAdminClient()
const SITE = '75bd3d23-d515-46bd-8de8-254495a5bade'

async function main() {
  const { data } = await db
    .from('canonical_subject_occurrence')
    .select('label, note, visit_status, effective_date, source_kind, canonical_subject_id')
    .eq('site_id', SITE)
    .order('effective_date', { ascending: true })
  const occs = (data ?? []) as Array<{
    label: string; note: string | null; visit_status: string | null
    effective_date: string; source_kind: string; canonical_subject_id: string
  }>
  const hits = occs.filter((o) => /nettoy|legumerie|légumerie/i.test(`${o.label} ${o.note ?? ''}`))
  console.log(`occurrences totales : ${occs.length} · mentionnant « nettoyage/légumerie » : ${hits.length}`)
  for (const o of hits) {
    console.log(`  ${o.effective_date} [${o.visit_status ?? '—'}] ${o.source_kind}  « ${o.label.slice(0, 70)} »`)
    if (o.note) console.log(`      note: ${o.note.slice(0, 140).replace(/\s+/g, ' ')}`)
  }
  const { data: dl } = await db
    .from('site_deadlines')
    .select('id, title, due_date, status, canonical_subject_id, report_id')
    .eq('site_id', SITE).is('deleted_at', null)
  console.log(`\néchéances du chantier : ${(dl ?? []).length}`)
  let linked = 0
  for (const d of (dl ?? []) as Array<{ title: string; due_date: string | null; status: string; canonical_subject_id: string | null }>) {
    if (d.canonical_subject_id) linked++
    console.log(`  [${d.status}] ${d.due_date ?? 'sans date'}  cs=${d.canonical_subject_id ? 'OUI' : 'null'}  « ${d.title.slice(0, 60)} »`)
  }
  console.log(`\n→ échéances portant un canonical_subject_id : ${linked}/${(dl ?? []).length}`)

  // Couverture du pont mig 346 à l'échelle de toute la base (lecture seule).
  const { data: allDl } = await db
    .from('site_deadlines').select('id, canonical_subject_id, status').is('deleted_at', null)
  const rows = (allDl ?? []) as Array<{ canonical_subject_id: string | null; status: string }>
  const withCs = rows.filter((r) => r.canonical_subject_id).length
  console.log(`\nTOUTE LA BASE — site_deadlines non supprimées : ${rows.length} · avec canonical_subject_id : ${withCs} (${rows.length ? Math.round((withCs / rows.length) * 100) : 0} %)`)
  const { data: allAct } = await db
    .from('site_actions').select('id, canonical_subject_id').eq('status', 'open')
  const arows = (allAct ?? []) as Array<{ canonical_subject_id: string | null }>
  console.log(`TOUTE LA BASE — site_actions ouvertes : ${arows.length} · avec canonical_subject_id : ${arows.filter((r) => r.canonical_subject_id).length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
