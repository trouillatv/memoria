/** P0-2c — sonde Chronologie occurrence-first : counts par PV + delta des 2 derniers PV. READ-ONLY. */
import { getSiteHistoricalTimeline, canonicalRunsForSite } from '../lib/documents/pv-history'
import { getPvDelta } from '../lib/documents/pv-comparison'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const tl = await getSiteHistoricalTimeline(BELLA)
  console.log('=== getSiteHistoricalTimeline (Bella) — counts par PV ===')
  for (const s of tl.snapshots) console.log(`  PV${s.runId.slice(0, 8)} (${s.effectiveDate}) :`, JSON.stringify(s.transitionCounts))

  const runs = await canonicalRunsForSite(BELLA)
  if (runs.length >= 2) {
    const from = runs[runs.length - 2], to = runs[runs.length - 1]
    const delta = await getPvDelta(from.id, to.id)
    const byT = new Map<string, string[]>()
    for (const it of delta.items) { if (!byT.has(it.transition)) byT.set(it.transition, []); byT.get(it.transition)!.push(it.label.slice(0, 34)) }
    console.log(`\n=== getPvDelta ${from.id.slice(0, 8)} → ${to.id.slice(0, 8)} (${delta.items.length} sujets) ===`)
    for (const [t, labels] of byT) console.log(`  ${t} (${labels.length}) : ${labels.slice(0, 4).join(' | ')}${labels.length > 4 ? ' …' : ''}`)
    const temoins: Record<string, string> = { '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9': 'électrique', 'b78526f9-9dc6-43f7-8edb-e4278f207988': 'cuisson', 'cc12fce6-8780-4f93-88a1-21905a37325b': 'éclairage' }
    console.log('\n  Témoins (par canonical) :')
    for (const [cs, name] of Object.entries(temoins)) {
      const it = delta.items.filter((i) => i.subjectThreadId === cs)
      console.log(`    ${name} : ${it.map((x) => `${x.transition} (${x.label.slice(0, 30)})`).join(' ; ') || '(absent du delta)'}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
