// Phase 6E.1A — audit READ-ONLY de la projection des identity candidates en paires Point↔Point.
//
// Zéro écriture, zéro migration, zéro LLM. Charge l'état réel (mêmes tables que 6E.0) et fait
// passer les 268 tracked_point_identity_candidate à travers deriveCandidatePointPairs
// (lib/knowledge/tracked-point-merge.ts) pour vérifier, sur données réelles, que la projection
// canonicalisation-aware retombe bien sur les 179 POINT_TO_POINT / 95 paires distinctes / 68
// réciproques déjà établis par 6E.0 (scripts/_p6e0-consolidation-inventory-report.json) — et,
// puisqu'aucun merge réel n'existe encore aujourd'hui (0 ligne status='merged'), que la
// canonicalisation est un no-op sur les données actuelles (aucune paire renommée/droppée par
// résolution de chaîne). Sert aussi de point de départ pour visualiser les grappes (paires qui
// partagent un Point, via computeConnectedComponents) avant toute décision de fusion humaine.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  deriveCandidatePointPairs,
  computeConnectedComponents,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
} from '@/lib/knowledge/tracked-point-merge'

const SITES: Array<{ id: string; name: string }> = [
  { id: '2c939e67-e986-4635-86a0-638cda870480', name: '2C93' },
  { id: '06c62e48-c488-4787-b322-0581c36b83c8', name: 'OCEF' },
  { id: 'fae6149d-f490-4b8e-b1fa-34f0ce8a32b4', name: 'FAE' },
  { id: '655edb00-032d-4379-b76d-d598c2c7c254', name: '655E' },
  { id: 'bebcdf12-fec0-44d8-858b-249ddea02db4', name: 'RUS' },
  { id: '23a66c4e-e758-412d-a613-d3626b2a10bc', name: '23A6' },
]
const siteNameById = new Map(SITES.map((s) => [s.id, s.name]))

async function fetchAll<T>(db: ReturnType<typeof createAdminClient>, table: string, select: string): Promise<T[]> {
  const out: T[] = []
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await db.from(table).select(select).range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return out
}

async function main() {
  const db = createAdminClient()

  const rawPoints = await fetchAll<{
    id: string; site_id: string; status: string; merged_into_id: string | null
    founding_kind: 'cbo' | 'trackable_condition' | 'manual'; founding_reference: string | null
  }>(db, 'tracked_point', 'id, site_id, status, merged_into_id, founding_kind, founding_reference')

  const rawMembers = await fetchAll<{
    tracked_point_id: string; subject_thread_id: string; scope: 'thread' | 'proposal_set'; status: string
  }>(db, 'tracked_point_member', 'tracked_point_id, subject_thread_id, scope, status')

  const rawCandidates = await fetchAll<{
    id: string; site_id: string; candidate_point_id: string; subject_thread_id: string; status: string
  }>(db, 'tracked_point_identity_candidate', 'id, site_id, candidate_point_id, subject_thread_id, status')

  console.log(`Chargé : ${rawPoints.length} points / ${rawMembers.length} memberships / ${rawCandidates.length} candidates`)

  const points: CandidatePairPointRow[] = rawPoints.map((p) => ({
    id: p.id,
    siteId: p.site_id,
    status: p.status as CandidatePairPointRow['status'],
    mergedIntoId: p.merged_into_id,
    foundingKind: p.founding_kind,
    foundingReference: p.founding_reference,
  }))
  const members: CandidatePairMemberRow[] = rawMembers.map((m) => ({
    trackedPointId: m.tracked_point_id,
    subjectThreadId: m.subject_thread_id,
    scope: m.scope,
    status: m.status as CandidatePairMemberRow['status'],
  }))
  const candidates: CandidatePairIdentityCandidateRow[] = rawCandidates.map((c) => ({
    id: c.id,
    siteId: c.site_id,
    candidatePointId: c.candidate_point_id,
    subjectThreadId: c.subject_thread_id,
    status: c.status as CandidatePairIdentityCandidateRow['status'],
  }))

  const pairs = deriveCandidatePointPairs(points, members, candidates)

  const reciprocalCount = pairs.filter((p) => p.reciprocal).length
  const totalCandidatesInPairs = pairs.reduce((n, p) => n + p.candidateIds.length, 0)

  const pairsBySite: Record<string, number> = {}
  for (const p of pairs) {
    const name = siteNameById.get(p.siteId) ?? p.siteId
    pairsBySite[name] = (pairsBySite[name] ?? 0) + 1
  }

  const components = computeConnectedComponents(pairs.map((p) => ({ a: p.pointAId, b: p.pointBId })))
  const clusterSizeHistogram: Record<string, number> = {}
  const clustersOfThreeOrMore = components.filter((c) => c.length >= 3)
  for (const c of components) {
    const key = c.length >= 3 ? '3+' : String(c.length)
    clusterSizeHistogram[key] = (clusterSizeHistogram[key] ?? 0) + 1
  }

  // Comparaison à la baseline 6E.0 (mêmes données, classification indépendamment réimplémentée
  // et canonicalisation-aware) : doit concorder puisqu'aucun merge réel n'existe encore.
  const EXPECTED_PAIRS = 95
  const EXPECTED_RECIPROCAL = 68
  const matchesBaseline = pairs.length === EXPECTED_PAIRS && reciprocalCount === EXPECTED_RECIPROCAL

  const report = {
    mandate: 'Phase 6E.1A — Audit READ-ONLY projection identity_candidate -> paires Point<->Point (0 écriture)',
    generatedAt: new Date().toISOString(),
    inputCounts: { points: rawPoints.length, activeMemberships: rawMembers.filter((m) => m.status === 'active').length, candidates: rawCandidates.length, pendingCandidates: rawCandidates.filter((c) => c.status === 'pending').length },
    derivedPairs: { total: pairs.length, reciprocal: reciprocalCount, totalCandidatesConsumed: totalCandidatesInPairs, bySite: pairsBySite },
    baselineComparison: { expectedPairs: EXPECTED_PAIRS, expectedReciprocal: EXPECTED_RECIPROCAL, matchesBaseline },
    clusters: { totalComponents: components.length, sizeHistogram: clusterSizeHistogram, clustersOfThreeOrMore: clustersOfThreeOrMore.map((c) => c.sort()) },
    samplePairs: pairs.slice(0, 20),
  }

  writeFileSync('scripts/_p6e1a-merge-pairs-audit-report.json', JSON.stringify(report, null, 2))

  console.log('\n=== Paires dérivées ===')
  console.log(`total=${pairs.length} réciproques=${reciprocalCount} candidats consommés=${totalCandidatesInPairs}`)
  console.log('par site:', pairsBySite)

  console.log('\n=== Comparaison à la baseline 6E.0 ===')
  console.log(`attendu 95 paires / 68 réciproques — obtenu ${pairs.length} / ${reciprocalCount} — concorde=${matchesBaseline}`)
  if (!matchesBaseline) {
    console.log('ÉCART détecté — à investiguer avant toute suite (ne pas ignorer).')
  }

  console.log('\n=== Grappes (composantes connexes des paires) ===')
  console.log(clusterSizeHistogram, `— ${clustersOfThreeOrMore.length} grappe(s) de 3+ Points`)

  console.log('\nRapport complet écrit : scripts/_p6e1a-merge-pairs-audit-report.json')
  console.log('\n=== HARD STOP — 0 écriture effectuée, 6E.1B (exécution réelle de fusion) hors périmètre ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
