'use client'

// Lanceur du compte-rendu chantier : bouton + overlay plein écran hébergeant
// le SiteReportPanel. Partagé mobile (/m/site) et desktop (fiche site).

import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { SiteReportPanel } from './SiteReportPanel'

interface Props {
  siteId: string
  siteName: string
  variant?: 'mobile' | 'desktop'
}

export function SiteReportLauncher({ siteId, siteName, variant = 'mobile' }: Props) {
  const [open, setOpen] = useState(false)

  const buttonClass =
    variant === 'desktop'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors'
      : 'inline-flex items-center justify-center gap-2 w-full rounded-lg bg-foreground text-background py-3 text-sm font-medium active:scale-[0.99] transition-transform'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        <ClipboardList className="h-4 w-4" />
        Compte-rendu chantier
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3 sm:p-6">
          <div className="w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg my-2">
            <SiteReportPanel siteId={siteId} siteName={siteName} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
