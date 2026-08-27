/**
 * R-1 parité — compare le read-model APRÈS refactor au baseline capturé AVANT.
 * Divergences ATTENDUES (multiplicité, transitions, position, currentStatus tri-state) tolérées et
 * comptées ; divergences INATTENDUES (invariants : firstSeen/lastSeen/set de sujets/matérialisations)
 * = 0 exigé. Aucun write.
 *
 * Usage : npx tsx --env-file=.env.local scripts/r1-parity-check.ts [bella|corpus]
 */
import { readFileSync } from 'node:fs'
import { getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'

const CS_ECLAIRAGE = 'cc12fce6-8780-4f93-88a1-21905a37325b'

function projectLife(life: Awaited<ReturnType<typeof getCanonicalSubjectLife>>) {
  if (!life) return null
  return {
    label: life.label, firstSeenAt: life.firstSeenAt, lastSeenAt: life.lastSeenAt,
    currentStatus: life.currentStatus, primaryFamily: life.primaryFamily,
    pvCount: life.pvCount, fieldVisitCount: life.fieldVisitCount,
    lastMeaningfulChangeAt: life.lastMeaningfulChangeAt, stagnationDays: life.stagnationDays,
    isStagnant: life.isStagnant, materializedEventsCount: life.materializedEvents.length,
    occCount: life.occurrences.filter((o) => !o.isGap).length,
  }
}

async function main() {
  const mode = process.argv[2] ?? 'bella'
  const file = mode === 'corpus' ? '_r1_baseline_corpus.json' : '_r1_baseline_bella.json'
  const baseline = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { name: string; lives: Record<string, ReturnType<typeof projectLife>> }>

  // ── Témoin éclairage ──
  const ecl = await getCanonicalSubjectLife(CS_ECLAIRAGE)
  console.log('=== TÉMOIN ÉCLAIRAGE — ligne de vie (ordre longitudinal) ===')
  for (const o of ecl?.occurrences ?? []) {
    if (o.isGap) { console.log(`  ○ ${o.effectiveDate} — non mentionné`); continue }
    const pos = o.eventDate ?? o.effectiveDate
    console.log(`  • pos=${pos} doc=${o.effectiveDate} [${o.proposalFamily}/${o.stateStatus}] ${(o.label ?? '').slice(0, 44)}${o.transition ? ` {${o.transition}}` : ''}`)
  }
  const hasRealise = (ecl?.occurrences ?? []).some((o) => o.proposalFamily === 'knowledge_fact' && o.eventDate === '2024-03-22' && o.stateStatus === 'resolved')
  const hasARefaire = (ecl?.occurrences ?? []).some((o) => o.proposalFamily === 'action' && !o.eventDate && o.stateStatus === 'open')
  console.log(`  Témoin (réalisé 2024-03-22 + à refaire 2025 séparés) : ${hasRealise && hasARefaire ? '✅' : '❌'}`)
  console.log(`  lastSeenAt=${ecl?.lastSeenAt} (attendu 2025-08-05)`)

  // ── Parité ──
  let unexpected = 0, expectedMultiplicity = 0, expectedStatus = 0, expectedLmca = 0, subjects = 0
  const flags: string[] = []
  for (const [siteId, site] of Object.entries(baseline)) {
    for (const [csId, base] of Object.entries(site.lives)) {
      if (!base) continue
      subjects++
      const now = projectLife(await getCanonicalSubjectLife(csId))
      if (!now) { unexpected++; flags.push(`DISPARU ${site.name} ${base.label}`); continue }
      // INVARIANTS (0 divergence attendue)
      if (now.firstSeenAt !== base.firstSeenAt) { unexpected++; flags.push(`firstSeen ${site.name} "${base.label}" ${base.firstSeenAt}→${now.firstSeenAt}`) }
      if (now.lastSeenAt !== base.lastSeenAt) { unexpected++; flags.push(`lastSeen ${site.name} "${base.label}" ${base.lastSeenAt}→${now.lastSeenAt}`) }
      if (now.materializedEventsCount !== base.materializedEventsCount) { unexpected++; flags.push(`matEvents ${site.name} "${base.label}" ${base.materializedEventsCount}→${now.materializedEventsCount}`) }
      if (now.pvCount !== base.pvCount) { unexpected++; flags.push(`pvCount ${site.name} "${base.label}" ${base.pvCount}→${now.pvCount}`) }
      // ATTENDUES
      if (now.occCount !== base.occCount) expectedMultiplicity++
      if (now.currentStatus !== base.currentStatus) expectedStatus++
      if (now.lastMeaningfulChangeAt !== base.lastMeaningfulChangeAt || now.isStagnant !== base.isStagnant) expectedLmca++
    }
  }

  console.log(`\n=== PARITÉ (${subjects} sujets) ===`)
  console.log(`Divergences ATTENDUES : multiplicité(occCount)=${expectedMultiplicity} | currentStatus tri-state=${expectedStatus} | LMCA/stagnation=${expectedLmca}`)
  console.log(`Divergences INATTENDUES (invariants firstSeen/lastSeen/pvCount/matEvents) : ${unexpected}`)
  for (const f of flags.slice(0, 40)) console.log('  ⚠️', f)
  if (flags.length > 40) console.log(`  … +${flags.length - 40}`)
  console.log(`\nVERDICT : ${unexpected === 0 && hasRealise && hasARefaire ? '✅ témoin OK + 0 divergence inattendue' : '❌ à examiner'}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
