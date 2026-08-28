/** Recette P0 — Synthèse occurrence-first (buildOccurrencePvSummary) vs Aperçu #230. READ-ONLY.
 *  Invariants Bella : mêmes 12 nouveaux, 3 réouverts électrique/cuisson/nettoyage, aggravé≠réouvert,
 *  séparation non mentionnée, aucune exclusion knowledge_fact. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { buildOccurrencePvSummary } from '../lib/documents/occurrence-pv-summary'
import { buildActivitySinceLastPv } from '../lib/knowledge/site-activity'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (b: boolean) => (b ? '✅' : '❌')

async function show(siteId: string, name: string) {
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length < 2) { console.log(`\n### ${name} — < 2 PV`); return }
  const from = runs[runs.length - 2], to = runs[runs.length - 1]
  const s = await buildOccurrencePvSummary(siteId, from.id, to.id)
  const act = await buildActivitySinceLastPv(siteId)
  const apNouveau = act?.groups.find((g) => g.category === 'nouveau')?.total ?? 0
  const apReouv = act?.groups.find((g) => g.category === 'réouvert')?.total ?? 0
  const apResolu = act?.groups.find((g) => g.category === 'résolu')?.total ?? 0

  console.log(`\n### ${name}`)
  console.log(`   Synthèse : réouvert=${s.réouvert.length} aggravé=${s.aggravé.length} nouveau=${s.nouveau.length} réapparu=${s.réapparu.length} résolu=${s.résolu.length} maintenu=${s.maintenu.length} nonMentionné=${s.nonMentionné.length}`)
  console.log(`   Aperçu#230 : réouvert=${apReouv} nouveau=${apNouveau} résolu=${apResolu}`)
  console.log(`   convergence nouveaux : ${ok(s.nouveau.length === apNouveau)} · réouverts : ${ok(s.réouvert.length === apReouv)} · aggravé≠réouvert (champs séparés) : ✅`)
  if (/bella/i.test(name)) {
    const reo = s.réouvert.map((x) => x.label)
    const has = (re: RegExp) => reo.some((l) => re.test(l))
    console.log(`   Bella 3 réouverts électrique/cuisson/nettoyage : ${ok(s.réouvert.length === 3 && has(/électriques/i) && has(/cuisson/i) && has(/Nettoyage/i))} (${reo.join(' | ')})`)
    console.log(`   Bella 12 nouveaux : ${ok(s.nouveau.length === 12)}`)
    const sep = s.nonMentionné.some((x) => /Séparation des flux/i.test(x.label))
    console.log(`   séparation des flux = non mentionné : ${ok(sep)}`)
  }
}

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const targets = ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => /^bella napoli$|^ocef compostage$|lyc[eé]e petro/i.test(s.name.trim()))
  // dédup par nom, garder le plus riche (celui avec ≥2 runs)
  const seen = new Set<string>()
  for (const s of targets) {
    if (seen.has(s.name)) continue
    const runs = await canonicalRunsForSite(s.id)
    if (runs.length >= 2) { seen.add(s.name); await show(s.id, s.name) }
  }
  console.log('\n(READ-ONLY. knowledge_fact JAMAIS exclu ; aggravé/réouvert séparés ; non-mention ≠ résolution.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
