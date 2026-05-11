// Slice B.4 — Route PDF publique /p/[token]/pdf
//
// Génère le PDF "Dossier de preuves" pour un visiteur non authentifié.
// L'authentification se fait par le token de partage (cryptographiquement
// aléatoire, 24 octets). Mêmes garde-fous que la page HTML /p/[token] :
// 4 cas (404 / révoqué / expiré / actif).
//
// Doctrine impérative :
//   - Pas de check user auth — c'est le TOKEN qui authentifie. La route
//     /preuves/[id]/dossier (Slice B.3) reste réservée admin/manager pour les
//     téléchargements internes ; celle-ci est sa contrepartie publique.
//   - Anonymisation respecte include_identities du token. Si l'émetteur a
//     coché "inclure les identités", le PDF les inclura.
//   - Audit : on incrémente access_count via recordShareAccess (best-effort).
//     Un téléchargement PDF compte comme un accès au même titre que la vue HTML.
//   - Aucun storage : PDF généré on-demand via renderToBuffer.
//
// Note technique : on ré-utilise getShareTokenByValueRaw (récupère même les
// révoqués/expirés) afin de distinguer les 3 cas d'erreur si on voulait
// retourner un message dédié — ici on retourne juste 403/404 puisque le PDF
// n'a pas de fallback HTML naturel.

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { getProofDetail } from '@/lib/db/proofs'
import {
  getShareTokenByValueRaw,
  recordShareAccess,
} from '@/lib/db/proof-share'
import { ProofDossierPdf } from '@/lib/pdf/proof-dossier'

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

  // 2. Charge la preuve.
  const proof = await getProofDetail(shareToken.intervention_id)
  if (!proof) {
    return NextResponse.json(
      { error: 'Intervention introuvable' },
      { status: 404 },
    )
  }

  // 3. Audit : best-effort, ne bloque pas la génération.
  recordShareAccess(shareToken.id).catch((e) =>
    console.warn('[public-pdf] recordShareAccess failed:', e),
  )

  // 4. QR code pointant vers cette même route publique (HTML) — c'est le lien
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

  // 5. Render le PDF.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      ProofDossierPdf({
        proof,
        qrDataUrl,
        shareUrl,
        generatedAt: new Date().toISOString(),
        includeIdentities: shareToken.include_identities,
        expiresAt: shareToken.expires_at,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[public-pdf] PDF render failed:', e)
    return NextResponse.json(
      { error: `Erreur génération PDF: ${msg}` },
      { status: 500 },
    )
  }

  // 6. Response avec headers PDF.
  const safeStub = proof.id.slice(0, 8)
  const filename = `dossier-preuves-${safeStub}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      // Pas de cache côté navigateur — un revoke doit faire effet immédiat.
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
