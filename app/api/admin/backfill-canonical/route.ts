// Route admin : backfill canonical_subject depuis les visites terrain existantes.
//
// Usage :
//   POST /api/admin/backfill-canonical
//   Header: x-internal-trigger: <INTERNAL_ANALYZE_SECRET>
//   Body: { "siteId": "<uuid>", "dryRun": true }          ← liste les visites candidates
//   Body: { "siteId": "<uuid>", "reportIds": ["<uuid>"]}  ← traite une liste précise
//   Body: { "siteId": "<uuid>", "all": true }             ← traite toutes les visites du site
//
// Toutes les visites sont traitées en mode backfill=true :
//   - inclut fulfilled + superseded (pas seulement proposed)
//   - produit des occurrences confirmed (visite close = vérité terrain)
//
// Idempotent : les propositions déjà liées (canonical_subject_id non null) sont ignorées.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileSourceToCanonicalSubjects } from '@/lib/db/canonical-subject-source-reconcile'

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  if (!expected || req.headers.get('x-internal-trigger') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { siteId?: string; dryRun?: boolean; reportIds?: string[]; all?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { siteId, dryRun = false, reportIds, all = false } = body
  if (!siteId) return NextResponse.json({ error: 'siteId requis' }, { status: 400 })

  const sb = createAdminClient()

  // Vérifier que le site existe
  const { data: site } = await sb.from('sites').select('id, name').eq('id', siteId).maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

  // Récupérer les visites à traiter
  let targetReportIds: string[]

  if (reportIds && reportIds.length > 0) {
    targetReportIds = reportIds
  } else if (all) {
    const { data: reports } = await sb
      .from('site_reports')
      .select('id, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    targetReportIds = (reports ?? []).map((r: { id: string }) => r.id)
  } else {
    return NextResponse.json({ error: 'Fournir reportIds[] ou all:true' }, { status: 400 })
  }

  if (dryRun) {
    // Compter les propositions candidates sans rien écrire
    const candidates = await Promise.all(
      targetReportIds.map(async (rid) => {
        const { count } = await sb
          .from('site_knowledge_proposals')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', rid)
          .eq('site_id', siteId)
          .is('canonical_subject_id', null)
          .in('kind', ['action', 'vigilance', 'decision', 'knowledge'])
          .in('status', ['proposed', 'fulfilled', 'superseded'])
        return { reportId: rid, candidateCount: count ?? 0 }
      }),
    )
    return NextResponse.json({
      site: (site as { id: string; name: string }).name,
      siteId,
      totalReports: targetReportIds.length,
      candidates,
      totalCandidates: candidates.reduce((s, c) => s + c.candidateCount, 0),
    })
  }

  // ── Mode écriture ────────────────────────────────────────────────────────────
  const results: Array<{
    reportId: string
    matched: number
    created: number
    clustered: number
    ambiguous: number
    orphaned: number
    error?: string
  }> = []

  for (const reportId of targetReportIds) {
    try {
      const r = await reconcileSourceToCanonicalSubjects({
        type: 'field_visit',
        id: reportId,
        siteId,
        authorId: null,
        backfill: true,
      })
      results.push({ reportId, ...r })
    } catch (err) {
      results.push({
        reportId,
        matched: 0, created: 0, clustered: 0, ambiguous: 0, orphaned: 0,
        error: String(err).slice(0, 200),
      })
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      matched: acc.matched + r.matched,
      created: acc.created + r.created,
      clustered: acc.clustered + r.clustered,
      ambiguous: acc.ambiguous + r.ambiguous,
      orphaned: acc.orphaned + r.orphaned,
    }),
    { matched: 0, created: 0, clustered: 0, ambiguous: 0, orphaned: 0 },
  )

  return NextResponse.json({
    site: (site as { id: string; name: string }).name,
    siteId,
    totalReports: targetReportIds.length,
    totals,
    results,
  })
}
