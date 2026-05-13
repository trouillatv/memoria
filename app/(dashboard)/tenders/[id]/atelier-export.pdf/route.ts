// Sprint 8 — Route GET /tenders/[id]/atelier-export.pdf
//
// Génère un PDF "Dossier de préparation" pour un AO donné, on-demand.
//
// Doctrine V5 :
//   - Auth obligatoire (admin/manager uniquement, jamais chef_equipe).
//     C'est un document de préparation interne, pas un livrable client.
//   - PDF on-demand via @react-pdf/renderer.renderToBuffer.
//     Pas de storage, pas de queue : le rendu est synchrone.
//   - Pas de QR code (contrairement au dossier de preuves Phase 5) : ce PDF
//     est un brouillon interne, pas un document vérifiable.

import { NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getAtelierExportData } from '@/lib/db/atelier-export'
import { renderAtelierExportPdf } from '@/lib/pdf/atelier-export'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteCtx) {
  // 1. Auth — admin/manager uniquement (jamais chef_equipe).
  const user = await getCurrentUserWithProfile()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Resolve params.
  const { id } = await ctx.params

  // 3. Charge le matériau (helper agrège tous les sous-domaines).
  const data = await getAtelierExportData(id)
  if (!data) {
    return NextResponse.json({ error: 'Tender introuvable' }, { status: 404 })
  }

  // 4. Render le PDF.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderAtelierExportPdf(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[atelier-export.pdf] PDF render failed:', e)
    return NextResponse.json(
      { error: `Erreur génération PDF: ${msg}` },
      { status: 500 },
    )
  }

  // 5. Response avec headers PDF.
  const safeStub = id.slice(0, 8)
  const filename = `dossier-preparation-${safeStub}.pdf`

  // Convertir le Buffer Node en Uint8Array pour satisfaire BodyInit.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
