// Phase 6E.1B — étape 1/4 : localiser et valider (READ-ONLY) la paire pilote sur RUS.
// Aucune écriture. Vérifie les 7 conditions posées par Vincent avant toute simulation :
//   composante de taille 2, aucune 3e cible, aucun CONFLICTED, même site, deux Points
//   active, aucun merged_into_id existant.

import { config } from 'dotenv'
config({ path: '.env.local' })

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  deriveCandidatePointPairs,
  computeConnectedComponents,
  chooseCanonicalMergeTarget,
  type CandidatePairPointRow,
  type CandidatePairMemberRow,
  type CandidatePairIdentityCandidateRow,
  type MergeGraphPoint,
} from '@/lib/knowledge/tracked-point-merge'

const RUS_SITE_ID = 'bebcdf12-fec0-44d8-858b-249ddea02db4'

async function fetchAll<T>(db: ReturnType<typeof createAdminClient>, table: string, select: string, siteId: string): Promise<T[]> {
  const out: T[] = []
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await db.from(table).select(select).eq('site_id', siteId).range(from, from + pageSize - 1)
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
    id: string; site_id: string; status: string; merged_into_id: string | null; label: string
    identity_status: 'CONFIRMED' | 'PROVISIONAL' | 'CONFLICTED'
    founding_kind: 'cbo' | 'trackable_condition' | 'manual'; founding_reference: string | null; created_at: string
  }>(db, 'tracked_point', 'id, site_id, status, merged_into_id, label, identity_status, founding_kind, founding_reference, created_at', RUS_SITE_ID)

  const pointIds = rawPoints.map((p) => p.id)
  const { data: rawMembersAll, error: memErr } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id, scope, status')
    .in('tracked_point_id', pointIds)
  if (memErr) throw memErr

  const rawCandidates = await fetchAll<{
    id: string; site_id: string; candidate_point_id: string; subject_thread_id: string; status: string
  }>(db, 'tracked_point_identity_candidate', 'id, site_id, candidate_point_id, subject_thread_id, status', RUS_SITE_ID)

  console.log(`RUS: ${rawPoints.length} points / ${rawMembersAll?.length ?? 0} memberships / ${rawCandidates.length} candidates`)

  const points: CandidatePairPointRow[] = rawPoints.map((p) => ({
    id: p.id, siteId: p.site_id, status: p.status as CandidatePairPointRow['status'],
    mergedIntoId: p.merged_into_id, foundingKind: p.founding_kind, foundingReference: p.founding_reference,
  }))
  const members: CandidatePairMemberRow[] = (rawMembersAll ?? []).map((m) => ({
    trackedPointId: m.tracked_point_id, subjectThreadId: m.subject_thread_id,
    scope: m.scope as CandidatePairMemberRow['scope'], status: m.status as CandidatePairMemberRow['status'],
  }))
  const candidates: CandidatePairIdentityCandidateRow[] = rawCandidates.map((c) => ({
    id: c.id, siteId: c.site_id, candidatePointId: c.candidate_point_id,
    subjectThreadId: c.subject_thread_id, status: c.status as CandidatePairIdentityCandidateRow['status'],
  }))

  const pairs = deriveCandidatePointPairs(points, members, candidates)
  console.log(`RUS: ${pairs.length} paires dérivées`)

  const components = computeConnectedComponents(pairs.map((p) => ({ a: p.pointAId, b: p.pointBId })))
  const componentByPointId = new Map<string, string[]>()
  for (const c of components) for (const id of c) componentByPointId.set(id, c)

  const pointById = new Map(rawPoints.map((p) => [p.id, p]))

  // Recherche des deux labels donnés par Vincent.
  const labelA = 'Transmettre le listing et le plan des extincteurs'
  const labelB = 'Listing et plan des extincteurs à transmettre'
  const candidatesA = rawPoints.filter((p) => p.label === labelA)
  const candidatesB = rawPoints.filter((p) => p.label === labelB)
  console.log(`\nPoints label exact "${labelA}": ${candidatesA.length}`, candidatesA.map((p) => p.id))
  console.log(`Points label exact "${labelB}": ${candidatesB.length}`, candidatesB.map((p) => p.id))

  const fuzzyExtincteurs = rawPoints.filter((p) => /extincteur/i.test(p.label))
  console.log(`\nTous points RUS mentionnant "extincteur" (${fuzzyExtincteurs.length}):`)
  for (const p of fuzzyExtincteurs) {
    console.log(`  ${p.id} status=${p.status} identity=${p.identity_status} label="${p.label}"`)
  }

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    baseline: { points: rawPoints.length, memberships: rawMembersAll?.length ?? 0, candidates: rawCandidates.length, pairs: pairs.length },
    extincteursPoints: fuzzyExtincteurs,
  }

  if (candidatesA.length === 1 && candidatesB.length === 1) {
    const a = candidatesA[0]
    const b = candidatesB[0]
    const componentA = componentByPointId.get(a.id) ?? [a.id]
    const componentB = componentByPointId.get(b.id) ?? [b.id]
    const sameComponent = new Set(componentA).size === 2 && new Set(componentA).has(b.id)
    const pair = pairs.find((p) => (p.pointAId === a.id && p.pointBId === b.id) || (p.pointAId === b.id && p.pointBId === a.id))

    const aGraph: MergeGraphPoint = { id: a.id, siteId: a.site_id, status: a.status as MergeGraphPoint['status'], mergedIntoId: a.merged_into_id, identityStatus: a.identity_status, createdAt: a.created_at }
    const bGraph: MergeGraphPoint = { id: b.id, siteId: b.site_id, status: b.status as MergeGraphPoint['status'], mergedIntoId: b.merged_into_id, identityStatus: b.identity_status, createdAt: b.created_at }

    let canonicalTargetId: string | null = null
    let canonicalError: string | null = null
    try {
      canonicalTargetId = chooseCanonicalMergeTarget(aGraph, bGraph)
    } catch (e) {
      canonicalError = e instanceof Error ? e.message : String(e)
    }

    const checks = {
      componentSizeIsTwo: componentA.length === 2 && sameComponent,
      componentMembers: componentA,
      noThirdCandidateTarget: componentA.length === 2,
      neitherConflicted: a.identity_status !== 'CONFLICTED' && b.identity_status !== 'CONFLICTED',
      sameSite: a.site_id === b.site_id,
      bothActive: a.status === 'active' && b.status === 'active',
      noExistingMergedIntoId: a.merged_into_id === null && b.merged_into_id === null,
      pairFound: pair !== undefined,
      pairCandidateIds: pair?.candidateIds ?? [],
      pairReciprocal: pair?.reciprocal ?? null,
    }

    const eligible = Object.values(checks).every((v) => v !== false) && canonicalError === null

    console.log('\n=== Vérification des 7 conditions ===')
    console.log(checks)
    console.log(`canonicalTargetId (chooseCanonicalMergeTarget) = ${canonicalTargetId} (erreur: ${canonicalError})`)
    console.log(`\nÉLIGIBLE pour pilote 6E.1B = ${eligible}`)

    report.pointA = a
    report.pointB = b
    report.checks = checks
    report.canonicalTargetId = canonicalTargetId
    report.canonicalError = canonicalError
    report.eligible = eligible
  } else {
    console.log('\nATTENTION: correspondance exacte de labels non unique — inspection manuelle requise via la liste "extincteurs" ci-dessus.')
    report.eligible = false
    report.note = 'label exact match non unique, voir extincteursPoints'
  }

  writeFileSync('scripts/_p6e1b-01-locate-pair-report.json', JSON.stringify(report, null, 2))
  console.log('\nRapport écrit : scripts/_p6e1b-01-locate-pair-report.json')
  console.log('=== HARD STOP — 0 écriture ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
