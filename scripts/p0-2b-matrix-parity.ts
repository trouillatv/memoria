/** P0-2b — parité matrice APRÈS vs baseline. Invariants : set de lignes identique ; lignes SANS occurrence
 * inchangées ; aucune cellule présente (réelle) ne devient un gap. Diffs occ-backed = attendus (tri-state).
 * Usage : npx tsx --env-file=.env.local scripts/p0-2b-matrix-parity.ts */
import { readFileSync } from 'node:fs'
import { getSiteSubjectMatrix } from '../lib/documents/pv-history'
import { buildSiteOccurrenceTimeline } from '../lib/documents/site-occurrence-timeline'

const rawEquiv = (s: string | null): string | null => (s === 'done' || s === 'cancelled' || s === 'informational' ? 'done' : s === null ? null : 'open')
type BCell = { s: string | null; t: string | null; g: boolean } | null
type BRow = { cs: string | null; label: string; occBacked: boolean; cells: BCell[] }

async function main() {
  const baseline = JSON.parse(readFileSync('_p0_2b_matrix_baseline.json', 'utf8')) as Record<string, { name: string; rows: BRow[] }>
  let unexpected = 0, occDiffRows = 0, presentToGap = 0, rows = 0
  const flags: string[] = []
  for (const [siteId, site] of Object.entries(baseline)) {
    const m = await getSiteSubjectMatrix(siteId)
    const tl = await buildSiteOccurrenceTimeline(siteId)
    const occCs = new Set(tl.subjects.map((x) => x.canonicalSubjectId))
    const nowByCs = new Map(m.rows.filter((r) => r.canonicalSubjectId).map((r) => [r.canonicalSubjectId!, r]))
    // set de lignes canonical identique
    const baseCs = new Set(site.rows.filter((r) => r.cs).map((r) => r.cs!))
    for (const cs of baseCs) if (!nowByCs.has(cs)) { unexpected++; flags.push(`LIGNE DISPARUE ${site.name} ${cs.slice(0, 8)}`) }
    for (const cs of nowByCs.keys()) if (!baseCs.has(cs)) { unexpected++; flags.push(`LIGNE APPARUE ${site.name} ${cs.slice(0, 8)}`) }

    for (const brow of site.rows) {
      if (!brow.cs) continue
      rows++
      const nrow = nowByCs.get(brow.cs); if (!nrow) continue
      const ncells: BCell[] = nrow.cells.map((c) => c ? { s: rawEquiv(c.status), t: c.transition, g: c.isGap } : null)
      const occBacked = occCs.has(brow.cs)
      // invariant : cellule présente (réelle) ne devient JAMAIS un gap
      for (let i = 0; i < brow.cells.length; i++) {
        const b = brow.cells[i], n = ncells[i]
        if (b && !b.g && n && n.g) { presentToGap++; flags.push(`PRÉSENT→GAP ${site.name} "${brow.label.slice(0, 24)}" run#${i}`) }
      }
      if (!occBacked) {
        // lignes sans occurrence : cellules identiques (invariant)
        if (JSON.stringify(ncells) !== JSON.stringify(brow.cells)) { unexpected++; if (flags.length < 40) flags.push(`NON-OCC MODIFIÉE ${site.name} "${brow.label.slice(0, 24)}"`) }
      } else {
        if (JSON.stringify(ncells) !== JSON.stringify(brow.cells)) occDiffRows++
      }
    }
  }
  console.log(`=== P0-2b parité matrice (${rows} lignes canonical) ===`)
  console.log(`Lignes occ-backed modifiées (ATTENDU, tri-state/présence) : ${occDiffRows}`)
  console.log(`INATTENDU — set de lignes / non-occ modifiées : ${unexpected}`)
  console.log(`INVARIANT — cellules présentes devenues gap (doit être 0) : ${presentToGap}`)
  for (const f of flags.slice(0, 40)) console.log('  ⚠️', f)
  console.log(`\nVERDICT : ${unexpected === 0 && presentToGap === 0 ? '✅ invariants tenus' : '❌ à examiner'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
