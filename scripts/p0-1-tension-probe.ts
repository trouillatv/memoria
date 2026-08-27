/** P0-1 — imprime la courbe de tension (activeCount par PV) pour comparer avant/après. READ-ONLY. */
import { getSiteHealthTimeline } from '../lib/documents/site-synthesis'
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
async function main() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'historical_pdf').limit(100000)
  const ids = [...new Set((occ ?? []).map((o) => o.site_id))]
  const { data: sites } = await sb.from('sites').select('id, name').in('id', ids)
  for (const s of sites ?? []) {
    const t = await getSiteHealthTimeline(s.id)
    const curve = t.points.map((p) => `${p.pvNumber}:${p.activeCount}`).join(' ')
    const monotonic = t.points.every((p, i) => i === 0 || p.activeCount >= t.points[i - 1].activeCount)
    console.log(`${s.name.padEnd(22)} pic=${t.peakActive} | ${curve} ${monotonic ? '' : '⬇baisse'}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
