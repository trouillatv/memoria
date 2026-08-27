/**
 * R-1 parité — capture du BASELINE (read-model ACTUEL, reconstruit depuis les propositions).
 * À exécuter AVANT le refactor. Aucun write. Dump JSON pour comparaison après réécriture.
 *
 * Usage : npx tsx --env-file=.env.local scripts/r1-parity-baseline.ts [siteId]
 *         (défaut = Bella ; passer 'corpus' pour tous les chantiers historiques)
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { getCanonicalSubjectLife, getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'

const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

// Projection stable et comparable d'une vie de sujet (les champs que R-1 doit préserver/diverger).
function projectLife(life: Awaited<ReturnType<typeof getCanonicalSubjectLife>>) {
  if (!life) return null
  return {
    label: life.label,
    firstSeenAt: life.firstSeenAt,
    lastSeenAt: life.lastSeenAt,
    currentStatus: life.currentStatus,
    primaryFamily: life.primaryFamily,
    pvCount: life.pvCount,
    fieldVisitCount: life.fieldVisitCount,
    lastMeaningfulChangeAt: life.lastMeaningfulChangeAt,
    stagnationDays: life.stagnationDays,
    isStagnant: life.isStagnant,
    materializedEventsCount: life.materializedEvents.length,
    occurrences: life.occurrences.map((o) => ({
      sourceKind: o.sourceKind, effectiveDate: o.effectiveDate, isGap: o.isGap,
      label: o.label, documentStatus: o.documentStatus, visitStatus: o.visitStatus,
      proposalFamily: o.proposalFamily, thematicCategory: o.thematicCategory, sourcePage: o.sourcePage,
      transition: o.transition, evidenceCount: o.evidenceCount, additionalLabels: o.additionalLabels,
    })),
  }
}

async function siteIdsToCapture(arg: string): Promise<{ id: string; name: string }[]> {
  if (arg && arg !== 'corpus') return [{ id: arg, name: arg.slice(0, 8) }]
  if (arg === 'corpus') {
    const { data: occ } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'historical_pdf').limit(100000)
    const ids = [...new Set((occ ?? []).map((o) => o.site_id))]
    const { data: sites } = await sb.from('sites').select('id, name').in('id', ids)
    return (sites ?? []).map((s) => ({ id: s.id, name: s.name }))
  }
  return [{ id: BELLA, name: 'Bella Napoli' }]
}

async function main() {
  const arg = process.argv[2] ?? ''
  const sites = await siteIdsToCapture(arg)
  const out: Record<string, unknown> = {}

  for (const site of sites) {
    const nav = await getNavigableSubjectsForSite(site.id)
    const lives: Record<string, unknown> = {}
    for (const s of nav) {
      const life = await getCanonicalSubjectLife(s.canonicalSubjectId)
      lives[s.canonicalSubjectId] = projectLife(life)
    }
    out[site.id] = {
      name: site.name,
      navigable: nav.map((n) => ({
        id: n.canonicalSubjectId, title: n.title, kind: n.kind, currentStatus: n.currentStatus,
        currentTriState: n.currentTriState, firstSeenAt: n.firstSeenAt, lastSeenAt: n.lastSeenAt,
        lastMeaningfulChangeAt: n.lastMeaningfulChangeAt, pvCount: n.pvCount,
        isStagnant: n.isStagnant, stagnationDays: n.stagnationDays, activeObjectsTotal: n.activeObjects.total,
      })),
      lives,
    }
    console.log(`  ${site.name} : ${nav.length} sujets navigables capturés`)
  }

  const file = arg === 'corpus' ? '_r1_baseline_corpus.json' : '_r1_baseline_bella.json'
  writeFileSync(file, JSON.stringify(out, null, 0))
  console.log(`Baseline écrit → ${file}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
