import { NextResponse } from 'next/server'
import { getTender, updateTenderStatus } from '@/lib/db/tenders'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ status: 'unknown', error_msg: null }, { status: 404 })

  if (tender.status === 'analyzing' || tender.status === 'extracting') {
    // Utilise updated_at (horodatage du dernier changement de statut) pas created_at
    const ref = tender.updated_at ?? tender.created_at
    const ageMs = Date.now() - new Date(ref).getTime()
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
