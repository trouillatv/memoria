/** R-1 clôture — cohérence ligne de vie ↔ grille (même temporalité/état). READ-ONLY. */
import { getNavigableSubjectsForSite, getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
async function main() {
  const nav = await getNavigableSubjectsForSite(BELLA)
  let ok = 0, mismatch = 0
  const diffs: string[] = []
  // life.currentStatus est un statut brut-équivalent (done/open/null) ; on le mappe en tri-state pour
  // comparer au currentTriState de la grille.
  const toTri = (s: string | null): string => s === 'done' ? 'resolved' : (s === 'open' || s === 'in_progress' || s === 'non_compliant' || s === 'planned' || s === 'awaiting_validation' || s === 'still_open') ? 'open' : s === 'not_applicable' || s === 'cancelled' ? 'resolved' : 'unknown'
  for (const n of nav) {
    const life = await getCanonicalSubjectLife(n.canonicalSubjectId)
    if (!life) continue
    const lifeTri = toTri(life.currentStatus)
    if (life.lastSeenAt === n.lastSeenAt && life.firstSeenAt === n.firstSeenAt && lifeTri === n.currentTriState) ok++
    else { mismatch++; if (diffs.length < 15) diffs.push(`${n.title}: life(first=${life.firstSeenAt},last=${life.lastSeenAt},tri=${lifeTri}) nav(first=${n.firstSeenAt},last=${n.lastSeenAt},tri=${n.currentTriState})`) }
  }
  console.log(`Cohérence ligne de vie ↔ grille (Bella) : OK=${ok} MISMATCH=${mismatch}`)
  for (const d of diffs) console.log('  ⚠️', d)
}
main().catch((e) => { console.error(e); process.exit(1) })
