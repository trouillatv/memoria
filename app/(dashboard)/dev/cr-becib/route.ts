// GET /dev/cr-becib — rend la FIXTURE La Cravache via le gabarit BECIB, pour
// comparer page à page au PDF original (méthode du brief). Admin/manager only.
// Outil d'itération visuelle ; pas une surface produit.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import { stampPageNumbers } from '@/lib/pdf/stamp-page-numbers'
import { CRAVACHE_FIXTURE } from '@/lib/documents/fixtures/cravache'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(CrBecibPdf({ cr: CRAVACHE_FIXTURE }))
    pdfBuffer = await stampPageNumbers(pdfBuffer) // « Page n / total » (render @react-pdf cassé)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[dev/cr-becib] render failed:', e)
    return NextResponse.json({ error: `Erreur rendu: ${msg}` }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="cr-becib-fixture.pdf"', 'Cache-Control': 'no-store' },
  })
}
