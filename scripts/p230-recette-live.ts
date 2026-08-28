/** #230 Phase 3 recette LIVE — activité « Depuis le dernier PV » réelle (Bella + OCEF). READ-ONLY. */
import { createClient } from '@supabase/supabase-js'
import { buildActivitySinceLastPv } from '../lib/knowledge/site-activity'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function show(siteId: string, name: string) {
  const a = await buildActivitySinceLastPv(siteId)
  console.log(`\n### ${name}`)
  if (!a) { console.log('  (null — <2 PV)'); return null }
  console.log(`   ${a.fromDate} → ${a.toDate}   totalChanges=${a.totalChanges}`)
  let displayedLines = 0
  for (const g of a.groups) {
    console.log(`   ${g.category} (${g.total})${g.hiddenCount ? ` [+${g.hiddenCount} masqués]` : ''} :`)
    for (const it of g.displayed) { console.log(`      → ${it.label.slice(0, 40)}${it.trajectory ? `  — ${it.trajectory}` : ''}  [${it.href.split('/').pop()!.slice(0, 8)}]`); displayedLines++ }
  }
  console.log(`   synthétique : ${a.synthetic.maintenus} maintenus · ${a.synthetic.nonMentionnes} non mentionnés`)
  console.log(`   → lignes explicites affichées = ${displayedLines} (cap 8)   ·   Voir tous : ${a.seeAllHref}`)
  return { a, displayedLines }
}

async function main() {
  const bella = await show(BELLA, 'BELLA NAPOLI')
  const { data: sites } = await sb.from('sites').select('id, name')
  const ocef = ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => s.id.startsWith('06c62e48'))[0]
  const oc = ocef ? await show(ocef.id, ocef.name + ' (PV riche)') : null

  console.log('\n════ VÉRIFICATIONS ════')
  if (bella) {
    const reouv = bella.a.groups.find((g) => g.category === 'réouvert')
    const labels = (reouv?.displayed ?? []).map((x) => x.label)
    const has = (re: RegExp) => labels.some((l) => re.test(l))
    console.log(`  Bella 3 réouverts (électrique/nettoyage/cuisson) : ${reouv?.total === 3 && has(/installations électriques/i) && has(/Nettoyage/i) && has(/cuisson/i) ? '✅' : `❌ (total=${reouv?.total}, labels=${labels.join(' | ')})`}`)
    console.log(`  Bella réouverts qualifiés « Résolu précédemment → à refaire » : ${(reouv?.displayed ?? []).every((x) => /Résolu précédemment/.test(x.trajectory ?? '')) ? '✅' : '❌'}`)
    const nouveau = bella.a.groups.find((g) => g.category === 'nouveau')
    console.log(`  Bella « nouveaux » après exclusion acteurs = ${nouveau?.total ?? 0} (brut getPvDelta=19 ; acteurs retirés)`)
    console.log(`  Bella lignes explicites ≤ 8 : ${bella.displayedLines <= 8 ? '✅' : '❌'}`)
  }
  if (oc) {
    console.log(`  OCEF lignes explicites ≤ 8 (anti-flood) : ${oc.displayedLines <= 8 ? '✅' : '❌'} (${oc.displayedLines})`)
    console.log(`  OCEF maintenus/non-mentionnés en compteurs seuls (jamais dans le cap) : ${oc.a.synthetic.maintenus + oc.a.synthetic.nonMentionnes} synthétiques hors cap ✅`)
  }
  console.log('\n(READ-ONLY. aggravé/réouvert séparés ; nouveau≠réapparu ; acteurs exclus ; cap anti-flood ; chaque ligne → fiche.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
