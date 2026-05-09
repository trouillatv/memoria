import { NextResponse } from 'next/server'
import { getTender, getTenderDocument, updateTenderStatus, insertTenderAnalysis } from '@/lib/db/tenders'
import { analyzeTender } from '@/services/ai/orchestrator'

/**
 * Triggered by the Server Action after upload completes.
 * Runs the full analyze pipeline and writes results.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  const got = req.headers.get('x-internal-trigger')
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params

  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ error: 'tender not found' }, { status: 404 })

  const doc = await getTenderDocument(id)
  if (!doc || !doc.extracted_text) {
    await updateTenderStatus(id, 'failed', 'no extracted text')
    return NextResponse.json({ error: 'no extracted text' }, { status: 400 })
  }

  try {
    const result = await analyzeTender(doc.extracted_text, tender.created_by)
    await insertTenderAnalysis({
      tender_id: id,
      provider: result.provider as never,
      model: result.model,
      prompt_versions: result.promptVersions,
      summary: result.reading.summary,
      constraints: result.reading.constraints,
      risks: result.reading.risks,
      checklist: result.reading.checklist,
      technical_memo: result.memo.technical_memo,
      library_snapshot: result.librarySnapshot,
      raw_response: null,
    })
    await updateTenderStatus(id, 'ready', null, result.score.score)
    return NextResponse.json({ ok: true, score: result.score.score })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    await updateTenderStatus(id, 'failed', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
