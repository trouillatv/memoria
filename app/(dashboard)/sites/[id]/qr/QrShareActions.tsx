'use client'

import { useState } from 'react'
import { Check, Copy, MessageCircle } from 'lucide-react'

interface Props {
  siteName: string
  publicUrl: string
}

export function QrShareActions({ siteName, publicUrl }: Props) {
  const [copied, setCopied] = useState(false)
  const shareText = `QR Code chantier ${siteName} - Journal du chantier : ${publicUrl}`
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="w-full border-t pt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copié' : 'Copier le lien'}
        </button>
      </div>
      <details className="text-center">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Voir le lien public
        </summary>
        <p className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs font-mono break-all text-foreground/80 text-left">
          {publicUrl}
        </p>
      </details>
    </div>
  )
}
