/** P0-2a — la primitive occurrence-timeline raconte-t-elle la MÊME histoire que la fiche ? READ-ONLY. */
import { buildSiteOccurrenceTimeline } from '../lib/documents/site-occurrence-timeline'
import { getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const tl = await buildSiteOccurrenceTimeline(BELLA)
  let ok = 0, mismatch = 0
  const diffs: string[] = []
  for (const subj of tl.subjects) {
    const life = await getCanonicalSubjectLife(subj.canonicalSubjectId)
    if (!life) continue
    // Fiche : transition par run (historique), depuis l'occurrence primaire non-gap du run + gaps.
    const ficheByRun = new Map<string, { transition: string | null; isGap: boolean }>()
    for (const o of life.occurrences) {
      if (o.sourceKind !== 'historical_pdf' || !o.runId) continue
      const cur = ficheByRun.get(o.runId)
      if (o.isGap) { if (!cur) ficheByRun.set(o.runId, { transition: 'non_mentionné', isGap: true }); continue }
      // primaire = celui qui porte une transition (les autres l'ont à null)
      if (!cur || (o.transition !== null)) ficheByRun.set(o.runId, { transition: o.transition, isGap: false })
    }
    // Primitive : cellules par run.
    for (const cell of subj.cells) {
      if (!cell) continue
      const f = ficheByRun.get(cell.runId)
      if (!f) continue // run où la fiche n'a rien (avant 1re apparition côté fiche)
      const primT = cell.transition
      if (f.isGap === cell.isGap && (f.transition ?? null) === (primT ?? null)) ok++
      else { mismatch++; if (diffs.length < 20) diffs.push(`${subj.label.slice(0, 30)} run=${cell.runId.slice(0, 8)} fiche(gap=${f.isGap},t=${f.transition}) prim(gap=${cell.isGap},t=${primT})`) }
    }
  }
  console.log(`Primitive ↔ fiche (Bella) : OK=${ok} MISMATCH=${mismatch}`)
  for (const d of diffs) console.log('  ⚠️', d)
}
main().catch((e) => { console.error(e); process.exit(1) })
