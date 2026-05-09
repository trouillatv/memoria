import { NextResponse } from 'next/server'
import { getTender, updateTenderStatus } from '@/lib/db/tenders'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ status: 'unknown', error_msg: null }, { status: 404 })

  if (tender.status === 'analyzing' || tender.status === 'extracting') {
    const ageMs = Date.now() - new Date(tender.created_at).getTime()
    if (ageMs > 10 * 60 * 1000) {
      await updateTenderStatus(id, 'failed', 'analyze_timeout')
      return NextResponse.json({ status: 'failed', error_msg: 'analyze_timeout', opportunity_score: null })
    }
  }

  return NextResponse.json({
    status: tender.status,
    error_msg: tender.error_msg,
    opportunity_score: tender.opportunity_score,
  })
}
