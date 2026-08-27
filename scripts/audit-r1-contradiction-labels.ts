/** R-1 — caractériser les sujets à contradiction de statut (READ-ONLY). */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const SHORTS = ['3355e3d4', 'd9bb24b2', 'fdac7034', '79e0509e', '2ae0bd9d', '44694719', '056505ae']
const SITE_SHORTS = ['2c939e67', '06c62e48']
async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const siteIds = (sites ?? []).filter((s) => SITE_SHORTS.some((p) => s.id.startsWith(p)))
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]))
  for (const site of siteIds) {
    const { data: cs } = await sb.from('canonical_subject').select('id, label, status').eq('site_id', site.id)
    for (const c of cs ?? []) {
      if (!SHORTS.some((p) => c.id.startsWith(p))) continue
      const { count } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('canonical_subject_id', c.id).eq('source_kind', 'historical_pdf')
      console.log(`${c.id.slice(0, 8)} | ${siteName.get(site.id)} | status=${c.status} | occ=${count} | "${c.label}"`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
