import { NextResponse } from 'next/server'
import { getTender } from '@/lib/db/tenders'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const tender = await getTender(id)
  if (!tender) return NextResponse.json({ status: 'unknown', error_msg: null }, { status: 404 })
  return NextResponse.json({
    status: tender.status,
    error_msg: tender.error_msg,
    opportunity_score: tender.opportunity_score,
  })
}
