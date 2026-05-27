// Route PDF publique /h/[token]/pdf — version imprimable/archivable du brief
// de passage de témoin. Polish /h/[token] (Vincent 2026-05-27).
//
// Pattern aligné sur /p/[token]/pdf :
//   - Authentification par le TOKEN (pas de session). 4 cas : 404 / archivé /
//     expiré / actif.
//   - Audit best-effort : un téléchargement PDF compte comme un accès
//     (recordHandoverShareAccess, même compteur que la vue HTML).
//   - QR code généré on-demand (data URL) → pointe vers la vue publique /h/<token>.
//   - Aucun storage : PDF rendu à la volée via renderToBuffer.

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import {
  getHandoverBriefByToken,
  recordHandoverShareAccess,
} from '@/lib/db/handover'
import { HandoverBriefPdf } from '@/lib/pdf/handover-brief'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteCtx {
  params: Promise<{ token: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params

  const brief = await getHandoverBriefByToken(token)
  if (!brief || brief.deleted_at) {
    return NextResponse.json({ error: 'Lien introuvable' }, { status: 404 })
  }
  if (brief.status === 'archived') {
    return NextResponse.json({ error: 'Brief archivé' }, { status: 403 })
  }
  if (brief.expires_at && new Date(brief.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Lien expiré' }, { status: 403 })
  }

  // Audit silencieux (même compteur que la vue HTML).
  recordHandoverShareAccess(token).catch((e) =>
    console.warn('[handover-pdf] recordHandoverShareAccess failed:', e),
  )

  const origin = new URL(req.url).origin
  const shareUrl = `${origin}/h/${token}`

  let qrDataUrl: string | null = null
  try {
    qrDataUrl = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 4,
    })
  } catch (e) {
    console.warn('[handover-pdf] QR generation failed:', e)
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      HandoverBriefPdf({
        title: brief.title,
        kind: brief.kind,
        payload: brief.payload,
        effectiveDate: brief.effective_date,
        qrDataUrl,
        shareUrl,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[handover-pdf] PDF render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  // Nom de fichier NEUTRE : pas le titre (qui contient le nom de la personne)
  // → un PDF téléchargé/transféré ne doit pas exposer de PII. (Audit board A4.)
  const stub = brief.id.slice(0, 8)

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="brief-${stub}.pdf"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
