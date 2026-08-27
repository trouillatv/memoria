/**
 * R-1 Phase B parité — getNavigableSubjectsForSite APRÈS vs baseline AVANT (navigable).
 * Invariants (0 inattendue) : set de sujets, firstSeenAt, lastSeenAt, pvCount.
 * Attendues (comptées) : currentStatus, currentTriState, lastMeaningfulChangeAt, isStagnant, kind.
 * Usage : npx tsx --env-file=.env.local scripts/r1-parity-nav.ts
 */
import { readFileSync } from 'node:fs'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'

type NavBase = { id: string; title: string; kind: string | null; currentStatus: string | null; currentTriState: string; firstSeenAt: string | null; lastSeenAt: string | null; lastMeaningfulChangeAt: string | null; pvCount: number; isStagnant: boolean; stagnationDays: number; activeObjectsTotal: number }

async function main() {
  const baseline = JSON.parse(readFileSync('_r1_baseline_corpus.json', 'utf8')) as Record<string, { name: string; navigable: NavBase[] }>
  let unexpected = 0, expStatus = 0, expTri = 0, expLmca = 0, expKind = 0, subjects = 0
  const flags: string[] = []

  for (const [siteId, site] of Object.entries(baseline)) {
    const now = await getNavigableSubjectsForSite(siteId)
    const nowById = new Map(now.map((n) => [n.canonicalSubjectId, n]))
    const baseIds = new Set(site.navigable.map((b) => b.id))
    // set de sujets identique
    for (const b of site.navigable) if (!nowById.has(b.id)) { unexpected++; flags.push(`DISPARU ${site.name} "${b.title}"`) }
    for (const n of now) if (!baseIds.has(n.canonicalSubjectId)) { unexpected++; flags.push(`APPARU ${site.name} "${n.title}"`) }

    for (const b of site.navigable) {
      const n = nowById.get(b.id); if (!n) continue
      subjects++
      if (n.firstSeenAt !== b.firstSeenAt) { unexpected++; flags.push(`firstSeen ${site.name} "${b.title}" ${b.firstSeenAt}→${n.firstSeenAt}`) }
      if (n.lastSeenAt !== b.lastSeenAt) { unexpected++; flags.push(`lastSeen ${site.name} "${b.title}" ${b.lastSeenAt}→${n.lastSeenAt}`) }
      if (n.pvCount !== b.pvCount) { unexpected++; flags.push(`pvCount ${site.name} "${b.title}" ${b.pvCount}→${n.pvCount}`) }
      if (n.currentStatus !== b.currentStatus) expStatus++
      if (n.currentTriState !== b.currentTriState) expTri++
      if (n.lastMeaningfulChangeAt !== b.lastMeaningfulChangeAt || n.isStagnant !== b.isStagnant) expLmca++
      if (n.kind !== b.kind) expKind++
    }
  }

  console.log(`=== R-1 Phase B parité navigable (${subjects} sujets) ===`)
  console.log(`ATTENDUES : currentStatus=${expStatus} | currentTriState=${expTri} | LMCA/stagnation=${expLmca} | kind=${expKind}`)
  console.log(`INATTENDUES (set/firstSeen/lastSeen/pvCount) : ${unexpected}`)
  for (const f of flags.slice(0, 50)) console.log('  ⚠️', f)
  if (flags.length > 50) console.log(`  … +${flags.length - 50}`)
  console.log(`\nVERDICT : ${unexpected === 0 ? '✅ 0 divergence inattendue' : '❌ à examiner'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
