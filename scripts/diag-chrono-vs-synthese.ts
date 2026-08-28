/** Diag READ-ONLY — pourquoi Chronologie affiche 19 nouveaux / 6 non-mentionnés vs Synthèse 12 / 2.
 *  Hypothèse : Chronologie = getPvDelta BRUT (sans exclusion acteurs #228). Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { getPvDelta } from '../lib/documents/pv-comparison'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const runs = await canonicalRunsForSite(BELLA)
  const from = runs[runs.length - 2], to = runs[runs.length - 1]
  const delta = await getPvDelta(from.id, to.id)

  // kind par canonical
  const ids = [...new Set(delta.items.map((i) => i.subjectThreadId))]
  const kind = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from('canonical_subject').select('id, kind').in('id', ids.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ id: string; kind: string | null }>) kind.set(r.id, r.kind)
  }
  const isActor = (id: string) => kind.get(id) === 'actor'

  const cat = (pred: (t: string) => boolean, filterActor: boolean) =>
    delta.items.filter((i) => pred(i.transition) && (!filterActor || !isActor(i.subjectThreadId))).length

  const rows = [
    ['nouveau', (t: string) => t === 'nouveau'],
    ['non_mentionné', (t: string) => t === 'non_mentionné'],
    ['réouvert', (t: string) => t === 'réouvert'],
    ['levé+réalisé (résolu)', (t: string) => t === 'levé' || t === 'réalisé'],
    ['maintenu', (t: string) => t === 'maintenu'],
  ] as const

  console.log(`getPvDelta Bella (${delta.items.length} items)\n`)
  console.log('catégorie            | BRUT (Chrono ?) | acteurs exclus (Synthèse/Aperçu)')
  for (const [name, pred] of rows) {
    console.log(`  ${name.padEnd(20)} | ${String(cat(pred, false)).padStart(6)}          | ${cat(pred, true)}`)
  }
  const actors = delta.items.filter((i) => isActor(i.subjectThreadId))
  console.log(`\nacteurs dans le delta = ${actors.length} :`)
  for (const a of actors) console.log(`   [${a.transition}] ${a.label}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
