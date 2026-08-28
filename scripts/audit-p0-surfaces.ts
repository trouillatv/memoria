/** P0 Phase 1 READ-ONLY — état interne des 3 surfaces legacy sur Bella. Aucune écriture. */
import { getActivityMap, getSiteHealthTimeline } from '../lib/documents/site-synthesis'
import { buildEvolutionReadModel } from '../lib/documents/pv-evolution'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  // Historique PV : getActivityMap (top-8, proposals+document_status, knowledge_fact exclu)
  const am = await getActivityMap(BELLA)
  console.log(`════ getActivityMap — ${am.rows.length} rows (top-8), ${am.runs.length} runs ════`)
  for (const row of am.rows) {
    console.log(`   « ${row.label.slice(0, 42)} » : [${row.cells.map((c) => c.state).join(' , ')}]`)
  }

  // Évolution : périodes + silence
  const evo = await buildEvolutionReadModel(BELLA)
  console.log(`\n════ buildEvolutionReadModel — ${evo.periods.length} périodes ════`)
  for (const p of evo.periods) {
    console.log(`   PV[${p.pvNumbers.join('-') || '—'}] silence=${p.isSilence}${p.isSilence ? ` (${p.silenceDays}j)` : ''} : appeared=${p.appeared.length} aggravated=${p.aggravated.length} resolved=${p.resolved.length} stillOpen=${p.stillOpen.length}`)
  }

  // Tension : occurrence-first MAIS exclusion par famille (knowledge_fact)
  const th = await getSiteHealthTimeline(BELLA)
  console.log(`\n════ getSiteHealthTimeline (Tension) — peakActive=${th.peakActive} ════`)
  for (const pt of th.points) console.log(`   PV${pt.pvNumber} ${pt.effectiveDate} : active=${pt.activeCount} new=${pt.newCount}`)
  console.log('\n(READ-ONLY.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
