/** Audit READ-ONLY — identifie EXACTEMENT les 12 « nouveaux » Bella (même logique que #230,
 *  SANS le cap 8) + dump structure. Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { getPvDelta } from '../lib/documents/pv-comparison'
import { buildSiteSubjectCells } from '../lib/documents/site-occurrence-timeline'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

const TRANSITION_TO_CATEGORY: Record<string, string> = {
  réouvert: 'réouvert', aggravé: 'aggravé', nouveau: 'nouveau_raw',
  levé: 'résolu', réalisé: 'résolu', maintenu: 'maintenu', non_mentionné: 'non_mentionné',
  progressé: 'autre', changé: 'autre', annulé: 'autre',
}

async function main() {
  const runs = await canonicalRunsForSite(BELLA)
  console.log(`runs Bella = ${runs.length}`)
  const from = runs[runs.length - 2]
  const to = runs[runs.length - 1]
  console.log(`from=${from.id.slice(0, 8)} → to=${to.id.slice(0, 8)}`)

  const [delta, view] = await Promise.all([getPvDelta(from.id, to.id), buildSiteSubjectCells(BELLA)])
  const toIdx = view ? view.runs.findIndex((r) => r.id === to.id) : -1
  const cellsByCs = new Map((view?.rows ?? []).map((r) => [r.canonicalSubjectId, r.cells]))

  // durableKind par CS
  const csIds = [...new Set(delta.items.map((i) => i.subjectThreadId))]
  const kindByCs = new Map<string, string | null>()
  const labelByCs = new Map<string, string | null>()
  for (let i = 0; i < csIds.length; i += 300) {
    const { data } = await sb.from('canonical_subject').select('id, kind, label').in('id', csIds.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ id: string; kind: string | null; label: string | null }>) {
      kindByCs.set(r.id, r.kind); labelByCs.set(r.id, r.label)
    }
  }

  const nouveaux: Array<{ cs: string; label: string; category: string; deltaLabel: string }> = []
  for (const it of delta.items) {
    if (kindByCs.get(it.subjectThreadId) === 'actor') continue // acteurs exclus (#230)
    const mapped = TRANSITION_TO_CATEGORY[it.transition] ?? 'autre'
    if (mapped !== 'nouveau_raw') continue
    const cells = cellsByCs.get(it.subjectThreadId) ?? []
    const firstReal = cells.findIndex((c) => c && !c.isGap)
    const category = firstReal >= 0 && toIdx >= 0 && firstReal < toIdx ? 'réapparu' : 'nouveau'
    nouveaux.push({ cs: it.subjectThreadId, label: labelByCs.get(it.subjectThreadId) ?? it.label, category, deltaLabel: it.label })
  }

  console.log(`\n════ NOUVEAUX (nouveau + réapparu, acteurs exclus) = ${nouveaux.length} ════`)
  for (const n of nouveaux) {
    console.log(`  [${n.category.padEnd(8)}] ${n.cs}  kind=${kindByCs.get(n.cs)}  « ${n.label} »`)
  }
  const onlyNouveau = nouveaux.filter((n) => n.category === 'nouveau')
  console.log(`\n→ « nouveau » strict (le 12 de #230) = ${onlyNouveau.length}`)
  console.log(onlyNouveau.map((n) => n.cs).join(','))
}
main().catch((e) => { console.error(e); process.exit(1) })
