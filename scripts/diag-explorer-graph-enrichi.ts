// getSiteGraph est fail-closed (membership) — on vérifie ici les REQUÊTES
// d'enrichissement une à une, sur les mêmes bornes que le read model.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createAdminClient } from '@/lib/supabase/admin'

const PETRO = '75bd3d23-d515-46bd-8de8-254495a5bade'

async function main() {
  const db = createAdminClient()

  // 1. Actions avec colonnes d'assignation (mêmes bornes que le graphe : 12)
  const { data: actions, error: aErr } = await db
    .from('site_actions')
    .select('id, title, report_id, assigned_company_id, assigned_contact_id, subject_thread_id')
    .eq('site_id', PETRO)
    .order('created_at', { ascending: false }).limit(12)
  if (aErr) { console.error('actions:', aErr.message); process.exit(1) }
  const assigned = (actions ?? []).filter((a) => a.assigned_company_id || a.assigned_contact_id)
  console.log(`Actions chargées : ${actions?.length ?? 0} — assignées : ${assigned.length}`)
  for (const a of assigned) {
    console.log(`  "${(a.title as string).slice(0, 60)}" company=${a.assigned_company_id?.slice(0, 8) ?? '-'} contact=${a.assigned_contact_id?.slice(0, 8) ?? '-'} thread=${a.subject_thread_id?.slice(0, 8) ?? '-'}`)
  }

  // 2. Casting actif — pour le matching assignation → intervenant
  const { data: ints } = await db
    .from('site_intervenants')
    .select('id, role, company_id, main_contact_id')
    .eq('site_id', PETRO).is('effective_to', null)
  console.log(`\nIntervenants actifs : ${ints?.length ?? 0}`)
  for (const it of ints ?? []) {
    console.log(`  role=${it.role} company=${(it.company_id as string)?.slice(0, 8)} contact=${(it.main_contact_id as string | null)?.slice(0, 8) ?? '-'}`)
  }

  // Matching réel
  const companyIds = new Set((ints ?? []).map((i) => i.company_id as string))
  const contactIds = new Set((ints ?? []).map((i) => i.main_contact_id as string | null).filter(Boolean))
  const matched = assigned.filter((a) =>
    (a.assigned_company_id && companyIds.has(a.assigned_company_id as string)) ||
    (a.assigned_contact_id && contactIds.has(a.assigned_contact_id as string)))
  console.log(`Arêtes acteur→action attendues : ${matched.length}`)

  // 3. STI → canonical pour les threads des actions assignées matchées
  const threads = [...new Set(matched.map((a) => a.subject_thread_id as string | null).filter(Boolean))] as string[]
  if (threads.length > 0) {
    const { data: sti } = await db
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', threads)
    const csIds = [...new Set((sti ?? []).map((r) => r.canonical_subject_id as string))]
    const { data: cs } = csIds.length > 0
      ? await db.from('canonical_subject').select('id, label').in('id', csIds)
      : { data: [] }
    console.log(`Sujets concernés (via STI) : ${(cs ?? []).map((c) => c.label).join(' · ') || '(aucun)'}`)
  } else {
    console.log('Sujets concernés : aucun thread sur les actions assignées matchées')
  }

  // 4. Occurrences par visite (evolved) — mêmes bornes que le graphe : 6 reports
  const { data: reports } = await db
    .from('site_reports').select('id, started_at').eq('site_id', PETRO)
    .order('started_at', { ascending: true }).limit(6)
  const reportIds = (reports ?? []).map((r) => r.id as string)
  const { data: siteCS } = await db
    .from('canonical_subject').select('id, label').eq('site_id', PETRO).eq('status', 'active')
  const csLabel = new Map((siteCS ?? []).map((r) => [r.id as string, r.label as string]))
  const { data: occ, error: oErr } = await db
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_ref_id')
    .in('canonical_subject_id', [...csLabel.keys()])
    .in('source_ref_id', reportIds)
  if (oErr) { console.error('occurrences:', oErr.message); process.exit(1) }
  const byReport = new Map<string, Set<string>>()
  for (const o of occ ?? []) {
    const l = csLabel.get(o.canonical_subject_id as string)
    if (!l) continue
    ;(byReport.get(o.source_ref_id as string) ?? byReport.set(o.source_ref_id as string, new Set()).get(o.source_ref_id as string)!).add(l)
  }
  console.log(`\nSujets évolués par visite (${byReport.size} visites avec occurrences) :`)
  for (const r of reports ?? []) {
    const s = byReport.get(r.id as string)
    if (s) console.log(`  ${(r.started_at as string)?.slice(0, 10)} : ${[...s].length} sujet(s) — ${[...s].slice(0, 4).join(' · ')}${s.size > 4 ? '…' : ''}`)
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
