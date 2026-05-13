// Phase 1.2 — Freeze immuable du PDF dossier de preuves.
//
// Quand un dossier est clôturé, on génère le PDF une fois, on calcule son
// hash SHA-256, et on le stocke dans le bucket privé frozen-dossiers. Toute
// consultation ultérieure sert ce binaire figé — jamais de regénération.
//
// Garantie : le PDF servi 18 mois plus tard est BIT-À-BIT identique à celui
// produit au moment de la clôture, même si les données sous-jacentes ont
// évolué. C'est la fondation de la valeur probante du dossier.
//
// Scope MVP : dossiers de preuves (intervention_id non null) uniquement.

import { createHash } from 'crypto'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { createAdminClient } from '@/lib/supabase/admin'
import { getShareTokenById } from '@/lib/db/proof-share'
import { getProofDetail } from '@/lib/db/proofs'
import { ProofDossierPdf } from '@/lib/pdf/proof-dossier'
import { getTenantName } from '@/lib/tenant'
import { ensureVerificationTokenForIntervention } from '@/lib/db/proof-verification'

const BUCKET = 'frozen-dossiers'

export interface FreezeResult {
  ok: boolean
  error?: string
  path?: string
  sha256?: string
}

/**
 * Génère le PDF du dossier de preuves correspondant au tokenId, calcule son
 * SHA-256, l'upload dans le bucket frozen-dossiers, et met à jour la ligne
 * proof_share_tokens avec le path/hash/timestamp.
 *
 * Idempotent : si frozen_pdf_path est déjà défini, retourne ok=true sans rien
 * faire. Permet de réessayer en cas d'échec partiel.
 */
export async function freezeProofDossierPdf(
  tokenId: string,
  origin: string,
): Promise<FreezeResult> {
  const supabase = createAdminClient()

  const token = await getShareTokenById(tokenId)
  if (!token) return { ok: false, error: 'Token introuvable' }
  if (!token.intervention_id) {
    return { ok: false, error: 'Token sans intervention_id (rapport mensuel non supporté en MVP)' }
  }
  if (token.frozen_pdf_path && token.frozen_pdf_sha256) {
    return { ok: true, path: token.frozen_pdf_path, sha256: token.frozen_pdf_sha256 }
  }

  const proof = await getProofDetail(token.intervention_id)
  if (!proof) return { ok: false, error: 'Intervention introuvable' }

  // QR code : pointe vers la route de vérification stable (cohérent route /preuves/[id]/dossier).
  let qrDataUrl: string | null = null
  try {
    const vt = await ensureVerificationTokenForIntervention({
      interventionId: token.intervention_id,
      tenantName: getTenantName(),
    })
    qrDataUrl = await QRCode.toDataURL(`${origin}/v/${vt.token}`, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 4,
    })
  } catch (e) {
    // Fallback : QR vers l'URL de partage si la création du verification token échoue.
    try {
      qrDataUrl = await QRCode.toDataURL(`${origin}/p/${token.token}`, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 4,
      })
    } catch {
      console.warn('[freeze-dossier] QR generation failed entirely:', e)
    }
  }

  // Rendu PDF figé : on capture l'état des données au moment de la clôture.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      ProofDossierPdf({
        proof,
        qrDataUrl,
        shareUrl: `${origin}/p/${token.token}`,
        generatedAt: new Date().toISOString(),
        includeIdentities: token.include_identities,
        expiresAt: token.expires_at,
        tenantName: getTenantName(),
      }),
    )
  } catch (e) {
    return { ok: false, error: `Erreur génération PDF: ${e instanceof Error ? e.message : 'unknown'}` }
  }

  // Hash SHA-256 du PDF complet.
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex')

  // Upload bucket privé. Le path inclut le tokenId pour traçabilité et le
  // hash pour éviter toute collision (en pratique impossible).
  const path = `${token.intervention_id}/${tokenId}-${sha256.slice(0, 12)}.pdf`
  const { error: uploadErr } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadErr) {
    return { ok: false, error: `Upload échoué : ${uploadErr.message}` }
  }

  // Update token row avec les métadonnées du PDF figé.
  const frozenAt = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('proof_share_tokens')
    .update({
      frozen_pdf_path: path,
      frozen_pdf_sha256: sha256,
      frozen_at: frozenAt,
    })
    .eq('id', tokenId)
  if (updateErr) {
    return { ok: false, error: `Update token échoué : ${updateErr.message}` }
  }

  return { ok: true, path, sha256 }
}

/**
 * Télécharge un PDF figé depuis le bucket frozen-dossiers.
 * Vérifie le SHA-256 attendu pour détecter toute altération.
 */
export async function downloadFrozenPdf(
  path: string,
  expectedSha256: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Download échoué' }

  const buffer = Buffer.from(await data.arrayBuffer())
  const actualSha256 = createHash('sha256').update(buffer).digest('hex')
  if (actualSha256 !== expectedSha256) {
    return { ok: false, error: 'Intégrité PDF figé compromise (hash divergent)' }
  }
  return { ok: true, buffer }
}
