/** P0-2b — baseline getSiteSubjectMatrix (Bella + corpus) : cellules par (sujet, run) + inventaire
 * occurrence-backed vs acteurs (sans occurrence). READ-ONLY. À exécuter AVANT la réécriture. */
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { getSiteSubjectMatrix } from '../lib/documents/pv-history'
import { buildSiteOccurrenceTimeline } from '../lib/documents/site-occurrence-timeline'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const rawEquiv = (s: string | null): string | null => (s === 'done' || s === 'cancelled' || s === 'informational' ? 'done' : s === null ? null : 'open')

async function main() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'historical_pdf').limit(100000)
  const ids = [...new Set((occ ?? []).map((o) => o.site_id))]
  const { data: sites } = await sb.from('sites').select('id, name').in('id', ids)
  const out: Record<string, unknown> = {}
  for (const s of sites ?? []) {
    const m = await getSiteSubjectMatrix(s.id)
    const tl = await buildSiteOccurrenceTimeline(s.id)
    const occCs = new Set(tl.subjects.map((x) => x.canonicalSubjectId))
    const rows = m.rows.map((r) => ({
      cs: r.canonicalSubjectId, label: r.canonicalLabel, family: r.family, occBacked: r.canonicalSubjectId ? occCs.has(r.canonicalSubjectId) : false,
      // status brut-équivalent + transition + gap par run (projection comparable)
      cells: r.cells.map((c) => c ? { s: rawEquiv(c.status), t: c.transition, g: c.isGap } : null),
    }))
    const occBackedRows = rows.filter((r) => r.occBacked).length
    const actorRows = rows.filter((r) => !r.occBacked).length
    out[s.id] = { name: s.name, runs: m.runs.length, rows }
    console.log(`${s.name.padEnd(22)} rows=${m.rows.length} (occ-backed=${occBackedRows}, sans-occ/acteurs=${actorRows}) runs=${m.runs.length}`)
  }
  writeFileSync('_p0_2b_matrix_baseline.json', JSON.stringify(out, null, 0))
  console.log('Baseline → _p0_2b_matrix_baseline.json')
}
main().catch((e) => { console.error(e); process.exit(1) })
