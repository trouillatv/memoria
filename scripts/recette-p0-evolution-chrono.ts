/** Recette P0 Phase 2B — Évolution (occurrence-first, reopened≠aggravated) + Chronologie (acteurs exclus). READ-ONLY. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { buildEvolutionReadModel } from '../lib/documents/pv-evolution'
import { getPvDelta } from '../lib/documents/pv-comparison'
import { getActorCanonicalIds } from '../lib/documents/occurrence-population'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (b: boolean) => (b ? '✅' : '❌')
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  // ── ÉVOLUTION ──
  const evo = await buildEvolutionReadModel(BELLA)
  console.log('════ ÉVOLUTION (Bella) ════')
  let totalReopened = 0, totalAppeared = 0, totalAggr = 0
  for (const p of evo.periods) {
    if (p.isSilence) { console.log(`   [silence ${p.silenceDays}j]`); continue }
    console.log(`   PV[${p.pvNumbers.join('-')}] : appeared=${p.appeared.length} reopened=${p.reopened.length} aggravated=${p.aggravated.length} resolved=${p.resolved.length} stillOpen=${p.stillOpen.length}`)
    totalReopened += p.reopened.length; totalAppeared += p.appeared.length; totalAggr += p.aggravated.length
  }
  console.log(`   → « Aucune transition » disparue (appeared+reopened+resolved > 0) : ${ok(totalAppeared + totalReopened > 0)}`)
  console.log(`   → réouvert ≠ aggravé (reopened=${totalReopened}, aggravated=${totalAggr}) : ${ok(totalReopened === 3 && totalAggr === 0)}`)
  const reopenedLabels = evo.periods.flatMap((p) => p.reopened.map((s) => s.label))
  const has = (re: RegExp) => reopenedLabels.some((l) => re.test(l))
  console.log(`   → 3 réouverts électrique/cuisson/nettoyage : ${ok(has(/électriques/i) && has(/cuisson/i) && has(/Nettoyage/i))} (${reopenedLabels.join(' | ')})`)

  // ── CHRONOLOGIE (réplique le filtre acteurs de la page) ──
  const runs = await canonicalRunsForSite(BELLA)
  const raw = await getPvDelta(runs[runs.length - 2].id, runs[runs.length - 1].id)
  const actorCs = await getActorCanonicalIds(BELLA)
  const items = raw.items.filter((i) => !actorCs.has(i.subjectThreadId))
  const c = (t: string) => items.filter((i) => i.transition === t).length
  const nouveau = c('nouveau'), nonMent = c('non_mentionné'), reouvert = c('réouvert'), resolu = c('levé') + c('réalisé'), maintenu = c('maintenu')
  console.log('\n════ CHRONOLOGIE (Bella, acteurs exclus) ════')
  console.log(`   nouveau=${nouveau} non_mentionné=${nonMent} réouvert=${reouvert} résolu=${resolu} maintenu=${maintenu}`)
  console.log(`   → 12 nouveaux (et non 19) : ${ok(nouveau === 12)}`)
  console.log(`   → 2 non mentionnés (et non 6) : ${ok(nonMent === 2)}`)
  console.log(`   → 3 réouverts : ${ok(reouvert === 3)}`)
  console.log(`   → converge avec Synthèse/Aperçu/Historique PV : ${ok(nouveau === 12 && reouvert === 3 && nonMent === 2)}`)
  console.log('\n(READ-ONLY. Contrat : même population produit — acteurs exclus #228, knowledge_fact gardé — partout.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
