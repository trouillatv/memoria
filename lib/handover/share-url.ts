// Sprint D' — Helpers de partage de brief (polish /h/[token]).
//
// Vincent 2026-05-22. Génère URL absolue + QR code data URL pour le dialog
// de partage côté manager. Pattern aligné sur proof-share.

import 'server-only'
import QRCode from 'qrcode'

/**
 * Construit l'URL absolue d'un brief partagé (utilisée par Open Graph + QR).
 *
 * Priorité : NEXT_PUBLIC_APP_URL > origin du request.
 * En dev local, NEXT_PUBLIC_APP_URL peut pointer vers http://localhost:3000.
 */
export function buildShareUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (base) return `${base}/h/${token}`
  // Fallback : URL relative — l'UI manager l'utilisera en navigator.clipboard
  // côté client où on peut résoudre window.location.origin.
  return `/h/${token}`
}

/**
 * Génère un QR code (data URL PNG) qui pointe vers /h/[token].
 *
 * Taille optimisée pour affichage 200x200 en modale de partage : suffisant
 * pour scan WhatsApp + impression A6.
 */
export async function generateShareQrDataUrl(token: string): Promise<string> {
  const url = buildShareUrl(token)
  const absoluteUrl = url.startsWith('http')
    ? url
    : // Fallback : on ne peut pas savoir l'origin côté server pour un QR utile,
      // donc on accepte le risque que le QR pointe en relatif si NEXT_PUBLIC_APP_URL
      // n'est pas défini. Documentation : exiger NEXT_PUBLIC_APP_URL en prod.
      url
  return QRCode.toDataURL(absoluteUrl, {
    width: 200,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}
