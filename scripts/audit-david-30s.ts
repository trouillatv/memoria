/** Audit produit READ-ONLY — « David comprend-il Bella en 30 s ? » Prouve la SOURCE de chaque
 *  nombre visible et les contradictions inter-surfaces. Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
import { buildActivitySinceLastPv } from '../lib/knowledge/site-activity'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { getCanonicalDelta } from '../lib/documents/canonical-transitions'
import { computeDeltaSummary } from '../lib/documents/site-synthesis'
import { buildEvolutionReadModel } from '../lib/documents/pv-evolution'
import { deriveCanonicalAttentionItems } from '../lib/knowledge/canonical-attention'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const runs = await canonicalRunsForSite(BELLA)
  const from = runs[runs.length - 2], to = runs[runs.length - 1]

  // ── APERÇU (occurrence-first, #228/#230 : seuls acteurs exclus) ──
  const act = await buildActivitySinceLastPv(BELLA)
  console.log('════ APERÇU « Depuis le dernier PV » (occurrence-first) ════')
  for (const g of act?.groups ?? []) console.log(`   ${g.category} = ${g.total}`)
  console.log(`   synthétique : ${act?.synthetic.maintenus} maintenus · ${act?.synthetic.nonMentionnes} non mentionnés`)

  // ── HISTOIRE > SYNTHÈSE (legacy : getCanonicalDelta + computeDeltaSummary, knowledge_fact EXCLU) ──
  const delta = await getCanonicalDelta(from.id, to.id)
  const sum = computeDeltaSummary(delta)
  console.log('\n════ HISTOIRE > SYNTHÈSE (legacy proposal-based, familles person/company/knowledge_fact EXCLUES) ════')
  console.log(`   nouveaux (appeared) = ${sum.nouveaux.length}`)
  console.log(`   aggravésRéouverts (FUSION) = ${sum.aggravésRéouverts.length}`)
  console.log(`   réalisésLevés = ${sum.réalisésLevés.length}`)
  console.log(`   nonMentionnés = ${sum.nonMentionnés.length} · toujoursOuverts = ${sum.toujoursOuverts.length}`)
  console.log('   → « nouveaux » retenus :')
  for (const n of sum.nouveaux) console.log(`      family=${n.family}  « ${n.label} »`)
  console.log('   → « aggravésRéouverts » retenus :')
  for (const n of sum.aggravésRéouverts) console.log(`      ${n.transition} family=${n.family}  « ${n.label} »`)

  // Distribution des familles de TOUS les items du delta (montre le poids knowledge_fact)
  const famAll = new Map<string, number>()
  for (const i of delta.items) famAll.set(i.family, (famAll.get(i.family) ?? 0) + 1)
  console.log(`   familles présentes dans le delta (avant exclusion d'affichage) : ${JSON.stringify(Object.fromEntries(famAll))}`)

  // ── ÉVOLUTION (structural/tension) ──
  const evo = await buildEvolutionReadModel(BELLA)
  console.log('\n════ ÉVOLUTION (modèle structurel/tension) ════')
  for (const p of evo.periods) {
    console.log(`   période PV${p.pvNumbers.join('-')} silence=${p.isSilence} : appeared=${p.appeared.length} aggravated=${p.aggravated.length} resolved=${p.resolved.length} stillOpen=${p.stillOpen.length}`)
  }

  // ── ATTENTION (occurrence-first #229) ──
  const attn = await deriveCanonicalAttentionItems(BELLA)
  console.log('\n════ ATTENTION (occurrence-first #229) ════')
  for (const a of attn) console.log(`   [${a.urgency}] « ${a.title} » — ${a.reasons.join(' | ')}`)

  console.log('\n════ CONTRADICTIONS ════')
  const apNouveau = act?.groups.find((g) => g.category === 'nouveau')?.total ?? 0
  const apReouv = act?.groups.find((g) => g.category === 'réouvert')?.total ?? 0
  console.log(`   nouveaux : Aperçu=${apNouveau}  vs  Synthèse=${sum.nouveaux.length}  → même population ? ${apNouveau === sum.nouveaux.length ? 'oui' : 'NON (knowledge_fact exclu en Synthèse)'}`)
  console.log(`   réouverts : Aperçu=${apReouv} (réouvert seul)  vs  Synthèse=${sum.aggravésRéouverts.length} (aggravé+réouvert fusionnés)`)
  const evoTransitions = evo.periods.reduce((a, p) => a + p.appeared.length + p.aggravated.length + p.resolved.length, 0)
  console.log(`   Évolution transitions totales = ${evoTransitions} (vs Aperçu ${apNouveau} nouveaux + ${apReouv} réouverts + résolus)`)
  console.log('\n(READ-ONLY — sources tracées, aucune écriture.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
