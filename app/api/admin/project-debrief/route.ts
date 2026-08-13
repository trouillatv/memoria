// Route admin : rejoue la projection debrief → site_knowledge_proposals pour des visites
// dont debrief_projected_at est null mais debrief_analysis est présente.
//
// Usage :
//   POST /api/admin/project-debrief
//   Header: x-internal-trigger: <INTERNAL_ANALYZE_SECRET>
//   Body: { "reportIds": ["<uuid>", ...] }
//
// Idempotent via dedupe_key. Ne relance pas le LLM.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureActionProposalsProjected } from '@/lib/visits/debrief-analysis'

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  if (!expected || req.headers.get('x-internal-trigger') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { reportIds?: string[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { reportIds } = body
  if (!reportIds?.length) return NextResponse.json({ error: 'reportIds[] requis' }, { status: 400 })

  const sb = createAdminClient()
  const results: Array<{ reportId: string; projected?: boolean; proposals?: number; error?: string }> = []

  for (const reportId of reportIds) {
    try {
      const { data: visit } = await sb
        .from('site_reports')
        .select('site_id, organization_id, debrief_analysis, debrief_projected_at')
        .eq('id', reportId)
        .maybeSingle()

      if (!visit) { results.push({ reportId, error: 'Introuvable' }); continue }
      if (!visit.debrief_analysis) { results.push({ reportId, error: 'Pas d\'analyse stockée' }); continue }
      if (visit.debrief_projected_at) { results.push({ reportId, projected: false, error: 'Déjà projeté' }); continue }

      await ensureActionProposalsProjected(reportId, visit.site_id, visit.organization_id)

      const { count } = await sb
        .from('site_knowledge_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)

      results.push({ reportId, projected: true, proposals: count ?? 0 })
    } catch (err) {
      results.push({ reportId, error: String(err).slice(0, 200) })
    }
  }

  return NextResponse.json({ results })
}
