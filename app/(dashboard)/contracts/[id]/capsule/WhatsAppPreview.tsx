'use client'

import { useState } from 'react'

/**
 * V5.1 Slice 4 — Preview WhatsApp pour l'atelier capsule (côté Patrick).
 *
 * Rend une bulle chat WhatsApp fidèle (couleur #DCF8C6 sur fond #ECE5DD,
 * iOS classique). Affiche la photo + le texte + le lien-signature. Patrick
 * voit exactement ce que Sylvie recevra dans son WhatsApp.
 *
 * 3 boutons d'action :
 *   - Copier l'image (download blob côté client)
 *   - Copier le texte (clipboard API)
 *   - Ouvrir WhatsApp (wa.me ou URL share native, contact à choisir par
 *     Patrick côté WhatsApp)
 *
 * Patrick reste expéditeur. L'app ne fait JAMAIS d'envoi automatique.
 */

interface Props {
  photoUrl: string
  text: string
  publicUrl: string
  tenantName: string
}

export function WhatsAppPreview({ photoUrl, text, publicUrl, tenantName }: Props) {
  const [copied, setCopied] = useState<'text' | 'url' | null>(null)

  async function copyToClipboard(value: string, key: 'text' | 'url') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch (e) {
      console.error('[clipboard]', e)
    }
  }

  // Texte à coller : phrase + saut de ligne + lien
  const fullText = `${text}\n${publicUrl}`

  // Lien wa.me sans contact (Patrick choisit le destinataire dans WhatsApp)
  const waLink = `https://wa.me/?text=${encodeURIComponent(fullText)}`

  return (
    <div className="space-y-4">
      {/* Preview chat WA */}
      <div
        className="rounded-xl p-4 max-w-md"
        style={{ background: '#ECE5DD' }}
      >
        <div
          className="rounded-2xl p-3 shadow-sm"
          style={{ background: '#DCF8C6', maxWidth: '85%' }}
        >
          <div
            className="overflow-hidden rounded-md"
            style={{ aspectRatio: '4/5', background: '#1a1a1a' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <p className="mt-2 text-[14px] leading-snug text-gray-900 whitespace-pre-wrap">
            {text}
          </p>
          <p className="mt-1 text-[12px] text-blue-700 break-all">{publicUrl}</p>
          <div className="text-[10px] text-gray-500 text-right mt-1">
            Émis par {tenantName}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2 max-w-md">
        <button
          type="button"
          onClick={() => copyToClipboard(fullText, 'text')}
          className="w-full inline-flex items-center justify-center px-4 py-3 rounded-lg border bg-card active:bg-muted text-sm font-medium"
        >
          {copied === 'text' ? '✓ Texte + lien copiés' : 'Copier le texte + lien'}
        </button>
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center px-4 py-3 rounded-lg bg-foreground text-background text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Ouvrir WhatsApp →
        </a>
        <p className="text-[11px] text-muted-foreground text-center">
          Vous restez l&apos;expéditeur. Choisissez le destinataire dans WhatsApp.
        </p>
      </div>
    </div>
  )
}
