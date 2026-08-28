/** #228 Lot B recette LIVE — compte nav.isStagnant réel (post-code S3) vs prédiction sim (6→3). READ-ONLY. */
import { createClient } from '@supabase/supabase-js'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TARGET = /bella|ocef|petro/i
async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const matched: Array<{ id: string; name: string }> = []
  for (const s of ((sites ?? []) as Array<{ id: string; name: string }>).filter((x) => TARGET.test(x.name))) {
    const { count } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id)
    if ((count ?? 0) > 0) matched.push(s)
  }
  matched.sort((a, b) => a.name.localeCompare(b.name))
  console.log('#228 Lot B RECETTE LIVE — nav.isStagnant réel (règle S3) — attendu total 3\n')
  let total = 0, actors = 0, resolved = 0, knowledge = 0
  for (const site of matched) {
    const nav = await getNavigableSubjectsForSite(site.id)
    const stag = nav.filter((s) => s.isStagnant)
    total += stag.length
    for (const s of stag) {
      if (s.durableKind === 'actor') actors++
      if (s.currentTriState === 'resolved') resolved++
      if (s.dominantFamily === 'knowledge_fact' && s.activeObjects.total === 0) knowledge++
    }
    console.log(`  ${site.name.padEnd(24)} stagnants=${stag.length}  [${stag.map((s) => `${s.title.slice(0, 24)}(${s.dominantFamily},obj${s.activeObjects.total})`).join(' | ') || '—'}]`)
  }
  console.log(`\nTOTAL stagnants LIVE = ${total}  (attendu 3)`)
  console.log(`acteurs=${actors} (attendu 0) · resolved=${resolved} (attendu 0) · knowledge purs=${knowledge} (attendu 0)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
