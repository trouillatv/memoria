/** READ-ONLY — tous les sites OCEF : kind split, personnes/site-name en business_subject, dates. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const ocefs = ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => /ocef/i.test(s.name))
  for (const s of ocefs) {
    const { data: cs } = await sb.from('canonical_subject').select('id, label, kind, created_at').eq('site_id', s.id)
    const rows = (cs ?? []) as Array<{ id: string; label: string; kind: string | null; created_at: string }>
    const bs = rows.filter((r) => r.kind === 'business_subject')
    const actor = rows.filter((r) => r.kind === 'actor')
    const persons = bs.filter((r) => /\b(M\.|Mme|Monsieur|Madame)\b/i.test(r.label) || /DOUYERE|ROUSSEL/i.test(r.label))
    const siteNameAsBs = bs.filter((r) => /^ocef\b/i.test(r.label.trim()))
    const dates = bs.map((r) => r.created_at).sort()
    console.log(`\n${s.id.slice(0, 8)}  « ${s.name} »  → CS=${rows.length} (actor=${actor.length}, business=${bs.length})`)
    console.log(`   business créés ${dates[0]?.slice(0, 10)} → ${dates[dates.length - 1]?.slice(0, 10)}`)
    console.log(`   PERSONNES en business_subject = ${persons.length}${persons.length ? ' ⚠️' : ''}`)
    for (const p of persons.slice(0, 12)) console.log(`      ${p.created_at.slice(0, 10)}  « ${p.label} »`)
    console.log(`   « OCEF » (nom du site) en business_subject = ${siteNameAsBs.length}${siteNameAsBs.length ? ' ⚠️' : ''}`)
    for (const p of siteNameAsBs.slice(0, 6)) console.log(`      ${p.created_at.slice(0, 10)}  ${p.id.slice(0, 8)}  « ${p.label} »`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
