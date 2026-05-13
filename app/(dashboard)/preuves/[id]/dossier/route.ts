// Slice B.3 — Route GET /preuves/[id]/dossier
// Génère un PDF "Dossier de preuves" on-demand (pas de storage).
//
// Doctrine impérative :
//   - Auth obligatoire (admin/manager). Pas d'exposition publique : la version
//     publique anonymisée passe par Slice B.4 = /p/[token].
//   - Le ?tokenId=xxx (optionnel) charge un proof_share_tokens existant et hérite
//     de son include_identities. Sinon, on prend la valeur de ?includeIdentities
//     du query string (override admin direct, audit log côté server action seulement).
//   - Anonymisation par défaut (includeIdentities=false).
//   - PDF généré on-demand via @react-pdf/renderer.renderToBuffer. Le rendu est
//     suffisamment rapide pour un download synchrone ; aucun storage long-terme.

import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getProofDetail } from '@/lib/db/proofs'
import { getShareTokenById } from '@/lib/db/proof-share'
import { ProofDossierPdf } from '@/lib/pdf/proof-dossier'
import { getTenantName } from '@/lib/tenant'
import { ensureVerificationTokenForIntervention } from '@/lib/db/proof-verification'
import { downloadFrozenPdf } from '@/lib/pdf/freeze-dossier'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  // 1. Auth — admin/manager uniquement.
  const user = await getCurrentUserWithProfile()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Resolve params + query.
  const { id } = await ctx.params
  const url = new URL(req.url)
  const tokenIdParam = url.searchParams.get('tokenId')
  const includeIdentitiesParam = url.searchParams.get('includeIdentities')

  // 3. Resolve effective settings via le token si fourni, sinon depuis le query.
  let includeIdentities = includeIdentitiesParam === 'true'
  let shareUrl: string | null = null
  let expiresAt: string | null = null

  if (tokenIdParam) {
    const tok = await getShareTokenById(tokenIdParam)
    if (!tok) {
      return NextResponse.json({ error: 'Token introuvable' }, { status: 404 })
    }
    if (tok.intervention_id !== id) {
      return NextResponse.json({ error: 'Token incohérent' }, { status: 400 })
    }
    includeIdentities = tok.include_identities
    expiresAt = tok.expires_at
    // Reconstruit l'URL de partage publique pour l'afficher dans le footer du PDF.
    const origin = url.origin
    shareUrl = `${origin}/p/${tok.token}`

    // Phase 1.2 — Si le PDF est figé (dossier clôturé), on le sert tel quel.
    // Garantit l'immutabilité bit-à-bit : le PDF consulté en 2030 est identique
    // à celui produit au moment de la clôture.
    if (tok.frozen_pdf_path && tok.frozen_pdf_sha256) {
      const frozen = await downloadFrozenPdf(tok.frozen_pdf_path, tok.frozen_pdf_sha256)
      if (frozen.ok) {
        const safeStub = id.slice(0, 8)
        const filename = `dossier-preuves-${safeStub}.pdf`
        return new NextResponse(new Uint8Array(frozen.buffer), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          },
        })
      }
      console.error('[dossier route] frozen PDF unavailable, falling back to live render:', frozen.error)
    }
  }

  // 4. Charge le proof.
  const proof = await getProofDetail(id)
  if (!proof) {
    return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })
  }

  // 5. Génère le QR code (PNG data URL) — Slice S3 : pointe vers l'URL de
  //    vérification STABLE plutôt que vers le share_token temporaire.
  let qrDataUrl: string | null = null
  let qrTarget: string | null = null
  try {
    const vt = await ensureVerificationTokenForIntervention({
      interventionId: id,
      tenantName: getTenantName(),
    })
    qrTarget = `${url.origin}/v/${vt.token}`
  } catch (e) {
    console.warn('[dossier route] verification token creation failed (using share url fallback):', e)
    qrTarget = shareUrl
  }
  if (qrTarget) {
    try {
      qrDataUrl = await QRCode.toDataURL(qrTarget, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 4,
      })
    } catch (e) {
      console.warn('[dossier route] QR generation failed:', e)
    }
  }

  // 6. Render le PDF.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      ProofDossierPdf({
        proof,
        qrDataUrl,
        shareUrl,
        generatedAt: new Date().toISOString(),
        includeIdentities,
        expiresAt,
        // Slice S1 — Pilier 6 : prestataire en hero du PDF
        tenantName: getTenantName(),
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[dossier route] PDF render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  // 7. Response avec headers PDF.
  const safeStub = id.slice(0, 8)
  const filename = `dossier-preuves-${safeStub}.pdf`

  // Convertir le Buffer Node en Uint8Array pour satisfaire BodyInit.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
