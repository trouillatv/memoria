'use client'

// « Partager » le compte-rendu — on partage le PDF lui-même (fichier) via la
// feuille de partage native du téléphone (WhatsApp, mail…). Repli : ouvrir le
// PDF si le partage de fichier n'est pas supporté. Une visite clôturée se
// CONSULTE et se PARTAGE ; elle ne se « reprend » plus.

import { useState } from 'react'
import { Share2, Loader2 } from 'lucide-react'

export function VisitShareButton({ reportId, siteName }: { reportId: string; siteName: string }) {
  const [busy, setBusy] = useState(false)
  const url = `/m/visite/${reportId}/pdf`

  async function share() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('fetch')
      const blob = await res.blob()
      const file = new File([blob], 'compte-rendu-visite.pdf', { type: 'application/pdf' })
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], title: `Compte-rendu — ${siteName}` })
        } catch { /* partage annulé par l'utilisateur — on ne fait rien */ }
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      className="flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium active:bg-accent disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Partager
    </button>
  )
}
