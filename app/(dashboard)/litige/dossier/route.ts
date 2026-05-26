// Sprint 3 — UX-8 Mode litige express : route GET /litige/dossier.
//
// Génère un PDF "Préparation de défense" agrégé site × période, on-demand.
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - Auth admin/manager obligatoire (chef_equipe → 403).
//   - Filename + headers PDF cohérents avec /preuves/[id]/dossier.
//   - QR code pointe vers la page publique /p/<token> (vérification).
//   - Wording strictement passif dans le PDF (LitigeDossierPdf gère ça).

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { searchProofs } from '@/lib/db/proofs'
import { getShareTokenById } from '@/lib/db/proof-share'
import { LitigeDossierPdf } from '@/lib/pdf/litige-dossier'
import { getTenantName } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'

export async function GET(req: Request) {
  // 1. Auth — admin/manager.
  const user = await getCurrentUserWithProfile()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Resolve query params.
  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const tokenId = url.searchParams.get('tokenId')

  if (!siteId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: 'Paramètres manquants (siteId, dateFrom, dateTo)' },
      { status: 400 },
    )
  }

  // 3. Charge le token si fourni (pour shareUrl + expiresAt dans le footer).
  let shareUrl: string | null = null
  let expiresAt: string | null = null
  if (tokenId) {
    const tok = await getShareTokenById(tokenId)
    if (tok) {
      shareUrl = `${url.origin}/p/${tok.token}`
      expiresAt = tok.expires_at
    }
  }

  // 4. Récupère le nom du site (pour le titre du PDF).
  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('name')
    .eq('id', siteId)
    .maybeSingle()
  const siteName = (site as { name: string } | null)?.name ?? 'Site'

  // 5. Agrège les interventions sur la période.
  const result = await searchProofs({
    siteId,
    dateFrom,
    dateTo,
    limit: 200,
  })

  const counts = {
    interventions: result.items.length,
    photos: result.items.reduce((acc, it) => acc + it.photosCount, 0),
    anomalies: result.items.reduce((acc, it) => acc + it.anomaliesCount, 0),
    anomaliesResolved: result.items.reduce(
      (acc, it) => acc + it.anomaliesResolvedCount,
      0,
    ),
    validations: result.items.reduce((acc, it) => acc + it.validationsCount, 0),
  }

  // 6. QR code (pointe vers la page publique de vérification).
  let qrDataUrl: string | null = null
  if (shareUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(shareUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 4,
      })
    } catch (e) {
      console.warn('[litige/dossier] QR generation failed:', e)
    }
  }

  // 7. Render le PDF.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      LitigeDossierPdf({
        siteName,
        dateFrom,
        dateTo,
        interventions: result.items,
        counts,
        generatedAt: new Date().toISOString(),
        qrDataUrl,
        shareUrl,
        expiresAt,
        tenantName: getTenantName(),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[litige/dossier] PDF render failed:', e)
    return NextResponse.json(
      { error: `Erreur génération PDF: ${msg}` },
      { status: 500 },
    )
  }

  // 8. Audit (action à portée juridique → trace obligatoire de qui/quoi/quand).
  await logAuditEvent({
    userId: user.id,
    entityType: 'site',
    entityId: siteId,
    action: 'downloaded',
    metadata: {
      kind: 'litige_dossier_pdf',
      site_name: siteName,
      date_from: dateFrom,
      date_to: dateTo,
      token_id: tokenId ?? null,
      counts,
    },
  })

  // 9. Response avec headers PDF.
  const filename = `preparation-defense-${dateFrom}_${dateTo}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
