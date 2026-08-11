// Route admin : backfill des canonical_subject_occurrence manquantes.
//
// Invariant Lot 4 :
//   proposal.canonical_subject_id IS NOT NULL
//   ⇒ canonical_subject_occurrence avec source_proposal_id = proposal.id DOIT exister.
//
// Usage :
//   POST /api/admin/backfill-occurrences
//   Header: x-internal-trigger: <INTERNAL_ANALYZE_SECRET>
//   Body: {}                           ← traite tous les sites
//   Body: { "siteId": "<uuid>" }       ← restreint à un site
//   Body: { "dryRun": true }           ← compte les gaps sans écrire

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCanonicalSubjectOccurrence } from '@/lib/db/canonical-subject-reconcile'

const VISIT_ORIGINS = new Set(['planned', 'spontaneous', 'qr', 'gps', 'import'])

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  if (!expected || req.headers.get('x-internal-trigger') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { siteId?: string; dryRun?: boolean }
  try { body = await req.json() } catch { body = {} }

  const { siteId, dryRun = false } = body
  const sb = createAdminClient()

  // 1. Trouver toutes les proposals avec canonical_subject_id mais sans occurrence
  //    La jointure LEFT est simulée : on charge les deux côtés puis on diff.
  let proposalsQuery = sb
    .from('site_knowledge_proposals')
    .select('id, site_id, report_id, kind, title, body, status, canonical_subject_id, entity_ids, created_at')
    .not('canonical_subject_id', 'is', null)

  if (siteId) proposalsQuery = proposalsQuery.eq('site_id', siteId)

  const { data: rawProposals, error: propErr } = await proposalsQuery
  if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 })

  const proposals = (rawProposals ?? []) as Array<{
    id: string
    site_id: string
    report_id: string
    kind: string
    title: string
    body: string | null
    status: string
    canonical_subject_id: string
    entity_ids: string[]
    created_at: string
  }>

  if (proposals.length === 0) {
    return NextResponse.json({ gap: 0, fixed: 0, dryRun })
  }

  // 2. Charger les occurrence.source_proposal_id existants pour le périmètre
  const proposalIds = proposals.map((p) => p.id)

  // Supabase REST : filtre IN sur uuid[]
  const { data: rawOccs } = await sb
    .from('canonical_subject_occurrence')
    .select('source_proposal_id')
    .in('source_proposal_id', proposalIds)

  const existingSet = new Set((rawOccs ?? []).map((o: { source_proposal_id: string }) => o.source_proposal_id))

  // 3. Identifier les gaps
  const gaps = proposals.filter((p) => !existingSet.has(p.id))

  if (dryRun || gaps.length === 0) {
    return NextResponse.json({
      totalWithCs: proposals.length,
      gap: gaps.length,
      fixed: 0,
      dryRun,
      sample: gaps.slice(0, 10).map((g) => ({
        proposalId: g.id,
        siteId: g.site_id,
        reportId: g.report_id,
        kind: g.kind,
        status: g.status,
        title: g.title.slice(0, 80),
      })),
    })
  }

  // 4. Charger les reports nécessaires (batch)
  const reportIds = [...new Set(gaps.map((g) => g.report_id))]
  const { data: rawReports } = await sb
    .from('site_reports')
    .select('id, origin, started_at, created_at')
    .in('id', reportIds)

  const reportMap = new Map(
    (rawReports ?? []).map((r: { id: string; origin: string | null; started_at: string | null; created_at: string }) => [r.id, r]),
  )

  // 5. Backfill
  let fixed = 0
  const errors: string[] = []

  for (const proposal of gaps) {
    try {
      const report = reportMap.get(proposal.report_id)
      const origin = report?.origin ?? null
      const sourceKind: 'field_visit' | 'meeting' = (origin && VISIT_ORIGINS.has(origin)) ? 'field_visit' : 'meeting'
      const effectiveDate = (report?.started_at ?? report?.created_at ?? proposal.created_at).slice(0, 10)

      await ensureCanonicalSubjectOccurrence({
        proposalId: proposal.id,
        canonicalSubjectId: proposal.canonical_subject_id,
        siteId: proposal.site_id,
        sourceKind,
        sourceRefId: proposal.report_id,
        effectiveDate,
        label: proposal.title,
        note: proposal.body,
        entityIds: proposal.entity_ids ?? [],
        proposalStatus: proposal.status,
        createdBy: null,
      })
      fixed++
    } catch (err) {
      errors.push(`${proposal.id}: ${String(err).slice(0, 120)}`)
    }
  }

  return NextResponse.json({
    totalWithCs: proposals.length,
    gap: gaps.length,
    fixed,
    errors: errors.length > 0 ? errors : undefined,
    dryRun: false,
  })
}
