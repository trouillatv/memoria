'use client'

// Lanceur du compte-rendu : bouton + overlay plein écran hébergeant le
// SiteReportPanel. Partagé mobile (/m/site), fiche site et fiche contrat.
// Réunion site (siteId) OU réunion contrat (contractId, multi-sites).

import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { SiteReportPanel } from './SiteReportPanel'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'

interface Props {
  // Réunion site
  siteId?: string
  siteName?: string
  // Réunion contrat
  contractId?: string
  contractName?: string
  variant?: 'mobile' | 'desktop'
  label?: string
}

export function SiteReportLauncher({ siteId, siteName, contractId, contractName, variant = 'mobile', label }: Props) {
  const [open, setOpen] = useState(false)
  const reportType = contractId ? 'contract' : 'site'

  const buttonClass =
    variant === 'desktop'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors'
      : 'inline-flex items-center justify-center gap-2 w-full rounded-lg bg-foreground text-background py-3 text-sm font-medium active:scale-[0.99] transition-transform'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        <ClipboardList className="h-4 w-4" />
        {label ?? (reportType === 'contract' ? 'Réunion de contrat' : 'Compte-rendu chantier')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3 sm:p-6">
          <div className="w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg my-2">
            {/* Préparer la réunion AVANT de saisir le compte-rendu (site only). */}
            {reportType === 'site' && siteId && (
              <div className="mb-3">
                <SiteBriefButton siteId={siteId} mode="meeting" variant={variant} />
              </div>
            )}
            <SiteReportPanel
              reportType={reportType}
              siteId={siteId}
              siteName={siteName}
              contractId={contractId}
              contractName={contractName}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  )
}
