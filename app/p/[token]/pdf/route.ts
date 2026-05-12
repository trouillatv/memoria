// Slice B.4 — Route PDF publique /p/[token]/pdf
// Slice E.2 — Étendue pour servir aussi les rapports mensuels client.
//
// Génère le PDF "Dossier de preuves" OU "Rapport mensuel" selon le type de
// token. L'authentification se fait par le token de partage (cryptographique
// aléatoire, 24 octets). Mêmes garde-fous : 4 cas (404 / révoqué / expiré / actif).
//
// Doctrine impérative :
//   - Pas de check user auth — c'est le TOKEN qui authentifie. La route
//     /preuves/[id]/dossier (Slice B.3) reste réservée admin/manager pour les
//     téléchargements internes ; celle-ci est sa contrepartie publique.
//   - Anonymisation respecte include_identities du token. Si l'émetteur a
//     coché "inclure les identités", le PDF dossier les inclura. Pour le rapport
//     mensuel, anonymisation totale par construction (pas de noms d'agent).
//   - Audit : on incrémente access_count via recordShareAccess (best-effort).
//     Un téléchargement PDF compte comme un accès au même titre que la vue HTML.
//   - Aucun storage : PDF généré on-demand via renderToBuffer.
//
// Slice E.2 — Dispatch :
//   - shareToken.intervention_id NOT NULL → ProofDossierPdf (Phase 5)
//   - shareToken.contract_id + report_month NOT NULL → MonthlyReportPdf
//   La CHECK chk_token_kind garantit le XOR au niveau DB.

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { getProofDetail } from '@/lib/db/proofs'
import { getContractMonthlyReport } from '@/lib/db/monthly-report'
import {
  getShareTokenByValueRaw,
  recordShareAccess,
} from '@/lib/db/proof-share'
import { ProofDossierPdf } from '@/lib/pdf/proof-dossier'
import { MonthlyReportPdf } from '@/lib/pdf/monthly-report'

// Force dynamic — chaque téléchargement re-valide le token côté serveur.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteCtx {
  params: Promise<{ token: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params

  // 1. Validate token (existence / révoqué / expiré).
  const shareToken = await getShareTokenByValueRaw(token)
  if (!shareToken) {
    return NextResponse.json({ error: 'Lien introuvable' }, { status: 404 })
  }
  if (shareToken.revoked_at) {
    return NextResponse.json(
      { error: 'Lien révoqué par son émetteur' },
      { status: 403 },
    )
  }
  if (new Date(shareToken.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Lien expiré' }, { status: 403 })
  }

  // 2. Audit : best-effort, ne bloque pas la génération.
  recordShareAccess(shareToken.id).catch((e) =>
    console.warn('[public-pdf] recordShareAccess failed:', e),
  )

  // 3. QR code pointant vers cette même route publique (HTML) — c'est le lien
  //    que l'auditeur scanne pour vérifier.
  const origin = new URL(req.url).origin
  const shareUrl = `${origin}/p/${shareToken.token}`
  let qrDataUrl: string | null = null
  try {
    qrDataUrl = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 4,
    })
  } catch (e) {
    console.warn('[public-pdf] QR generation failed:', e)
  }

  // 4. Dispatch selon le type de token (Slice E.2).
  if (shareToken.contract_id && shareToken.report_month && !shareToken.intervention_id) {
    return renderMonthlyReportPdf({
      shareToken,
      qrDataUrl,
      shareUrl,
    })
  }

  if (!shareToken.intervention_id) {
    return NextResponse.json(
      { error: 'Token mal formé : ni intervention ni rapport mensuel.' },
      { status: 422 },
    )
  }

  return renderDossierProofPdf({
    interventionId: shareToken.intervention_id,
    qrDataUrl,
    shareUrl,
    includeIdentities: shareToken.include_identities,
    expiresAt: shareToken.expires_at,
  })
}

// ----------------------------------------------------------------------------
// Helpers de rendu — séparés pour clarté + facilité d'évolution.
// ----------------------------------------------------------------------------

async function renderDossierProofPdf(input: {
  interventionId: string
  qrDataUrl: string | null
  shareUrl: string
  includeIdentities: boolean
  expiresAt: string
}) {
  const proof = await getProofDetail(input.interventionId)
  if (!proof) {
    return NextResponse.json(
      { error: 'Intervention introuvable' },
      { status: 404 },
    )
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      ProofDossierPdf({
        proof,
        qrDataUrl: input.qrDataUrl,
        shareUrl: input.shareUrl,
        generatedAt: new Date().toISOString(),
        includeIdentities: input.includeIdentities,
        expiresAt: input.expiresAt,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[public-pdf] PDF render failed (dossier):', e)
    return NextResponse.json(
      { error: `Erreur génération PDF: ${msg}` },
      { status: 500 },
    )
  }

  const safeStub = proof.id.slice(0, 8)
  const filename = `dossier-preuves-${safeStub}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}

async function renderMonthlyReportPdf(input: {
  shareToken: NonNullable<Awaited<ReturnType<typeof getShareTokenByValueRaw>>>
  qrDataUrl: string | null
  shareUrl: string
}) {
  const { shareToken } = input
  if (!shareToken.contract_id || !shareToken.report_month) {
    return NextResponse.json(
      { error: 'Token rapport mensuel incomplet' },
      { status: 422 },
    )
  }

  const reportData = await getContractMonthlyReport(
    shareToken.contract_id,
    shareToken.report_month,
  )
  if (!reportData) {
    return NextResponse.json(
      { error: 'Rapport mensuel introuvable' },
      { status: 404 },
    )
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      MonthlyReportPdf({
        data: reportData,
        selectedPhotoIds: shareToken.selected_photo_ids ?? [],
        dgNote: shareToken.dg_note ?? '',
        qrDataUrl: input.qrDataUrl,
        shareUrl: input.shareUrl,
        generatedAt: new Date().toISOString(),
        expiresAt: shareToken.expires_at,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[public-pdf] PDF render failed (monthly report):', e)
    return NextResponse.json(
      { error: `Erreur génération PDF: ${msg}` },
      { status: 500 },
    )
  }

  const stub = shareToken.contract_id.slice(0, 8)
  const filename = `rapport-mensuel-${stub}-${shareToken.report_month}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
