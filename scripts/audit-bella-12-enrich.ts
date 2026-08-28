/** READ-ONLY — enrichit les 12 nouveaux Bella + trace BELLA NAPOLI (actor). Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const TWELVE = ['8815498b-3100-43b9-9038-bf479c658a29','0bcc588c-37a5-4eaf-8ac9-960b5e16994b','1de36dcb-fea7-4179-a57e-a7df3c6c8513','e76e4cf9-2747-4afa-86bd-b4b5bdea8459','e8929f5e-4c20-4c1c-bdd8-2b65a7433389','4fd7b99f-4fd6-4fb9-8124-7338bb3b78f5','c7b3a0c4-9d62-402d-9106-afb8fdcc4592','c33683c7-a2a1-4bf1-bfe6-1c30b0cd8322','ffa39d5a-4d02-448f-84d4-a09e8c2bedbd','aaec7f76-9084-4679-b030-7962160f376f','f27e3439-4523-497a-b68b-ae68c4b8f180','cc12fce6-8780-4f93-88a1-21905a37325b']

async function reportName(id: string | null): Promise<string> {
  if (!id) return 'null'
  const { data } = await sb.from('site_reports').select('text_input, origin, started_at').eq('id', id).maybeSingle()
  const r = data as { text_input: string | null; origin: string | null; started_at: string | null } | null
  return r ? `${r.origin}/${r.text_input ?? r.started_at?.slice(0, 10) ?? '?'}` : id.slice(0, 8)
}

async function main() {
  // Threads par CS
  const { data: threads } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', BELLA).in('canonical_subject_id', TWELVE)
  const threadsByCs = new Map<string, string[]>()
  for (const t of (threads ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
    const a = threadsByCs.get(t.canonical_subject_id) ?? []; a.push(t.subject_thread_id); threadsByCs.set(t.canonical_subject_id, a)
  }
  const allThreads = [...(threads ?? [])].map((t) => (t as { subject_thread_id: string }).subject_thread_id)

  // Objets matérialisés par thread
  const { data: acts } = await sb.from('site_actions').select('id, title, status, subject_thread_id').eq('site_id', BELLA).in('subject_thread_id', allThreads.length ? allThreads : ['-'])
  const actsByThread = new Map<string, Array<{ status: string; title: string }>>()
  for (const a of (acts ?? []) as Array<{ subject_thread_id: string; status: string; title: string }>) {
    const l = actsByThread.get(a.subject_thread_id) ?? []; l.push({ status: a.status, title: a.title }); actsByThread.set(a.subject_thread_id, l)
  }

  for (const cs of TWELVE) {
    const { data: sub } = await sb.from('canonical_subject').select('label, kind, creation_source, aliases, operational_subject_id, company_id, contact_id').eq('id', cs).maybeSingle()
    const s = sub as { label: string; kind: string; creation_source: string | null; aliases: string[] | null; operational_subject_id: string | null; company_id: string | null; contact_id: string | null } | null
    const { data: occs } = await sb.from('canonical_subject_occurrence')
      .select('label, note, state_key, state_status, source_kind, source_ref_id, source_page, effective_date, source_proposal_id, validation_status')
      .eq('canonical_subject_id', cs).order('effective_date')
    const occList = (occs ?? []) as Array<{ label: string; note: string | null; state_key: string; state_status: string; source_kind: string; source_ref_id: string | null; source_page: number | null; effective_date: string | null; source_proposal_id: string | null; validation_status: string }>

    console.log(`\n════════ ${cs.slice(0, 8)} — « ${s?.label} »`)
    console.log(`  kind=${s?.kind} · creation_source=${s?.creation_source} · op_subject=${s?.operational_subject_id ? 'oui' : 'non'} · company=${s?.company_id ? 'OUI⚠️' : '-'} · contact=${s?.contact_id ? 'OUI⚠️' : '-'} · aliases=${JSON.stringify(s?.aliases ?? [])}`)
    console.log(`  occurrences = ${occList.length}`)
    const pvSet = new Set<string>()
    for (const o of occList) {
      pvSet.add(o.source_ref_id ?? '?')
      console.log(`    · state_key=${o.state_key}/${o.state_status} p.${o.source_page} ${o.effective_date} src=${o.source_kind} prop=${o.source_proposal_id ? o.source_proposal_id.slice(0, 8) : 'null'} val=${o.validation_status}`)
      console.log(`      label="${o.label}"  note="${(o.note ?? '').slice(0, 90)}"`)
    }
    const pvNames = await Promise.all([...pvSet].map(reportName))
    console.log(`  PV distincts = ${pvSet.size} → ${pvNames.join(' | ')}`)
    const threads = threadsByCs.get(cs) ?? []
    const objs = threads.flatMap((t) => actsByThread.get(t) ?? [])
    console.log(`  threads=${threads.length} · objets matérialisés (actions)=${objs.length}${objs.length ? ' → ' + objs.map((o) => `${o.status}:${o.title.slice(0, 30)}`).join(' ; ') : ''}`)
  }

  // Témoin BELLA NAPOLI (actor)
  console.log(`\n\n════════ TÉMOIN — BELLA NAPOLI (d911ab4e) ════════`)
  const { data: bn2 } = await sb.from('canonical_subject').select('id, label, kind, creation_source, company_id, contact_id, actor_link_source, actor_link_confidence, operational_subject_id').eq('site_id', BELLA).ilike('label', 'bella napoli')
  console.log(JSON.stringify(bn2, null, 1))
  const bnId = ((bn2 ?? [])[0] as { id: string } | undefined)?.id
  if (bnId) {
    const { data: bnOcc } = await sb.from('canonical_subject_occurrence').select('label, note, state_key, source_kind, source_ref_id, source_page, source_proposal_id').eq('canonical_subject_id', bnId)
    console.log(`  occurrences BELLA NAPOLI = ${(bnOcc ?? []).length}`)
    for (const o of (bnOcc ?? []) as Array<Record<string, unknown>>) console.log('   ', JSON.stringify(o))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
