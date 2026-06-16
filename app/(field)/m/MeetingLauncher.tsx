'use client'

// « Enregistrer une réunion » DEPUIS l'accueil /m : on choisit d'abord le
// chantier, puis on lance l'enregistreur de réunion EXISTANT (SiteReportPanel,
// mode « réunion site ») — zéro duplication de la logique d'ingestion.
// La liste des chantiers est chargée à l'ouverture (action serveur scopée).

import { useState, useEffect } from 'react'
import { Mic, X, ChevronRight, Loader2 } from 'lucide-react'
import { listMeetingSitesAction } from './meeting-actions'
import { SiteReportPanel } from './site/[siteId]/SiteReportPanel'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'

type Site = { id: string; name: string }

export function MeetingLauncher() {
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<Site[] | null>(null)
  const [sel, setSel] = useState<Site | null>(null)

  useEffect(() => {
    if (!open || sites !== null) return
    listMeetingSitesAction()
      .then(setSites)
      .catch(() => setSites([]))
  }, [open, sites])

  function close() {
    setOpen(false)
    setSel(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium active:scale-[0.99] transition-transform"
      >
        <Mic className="h-4 w-4" /> Enregistrer une réunion
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            {!sel ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Réunion — pour quel chantier&nbsp;?</h3>
                  <button type="button" onClick={close} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {sites === null ? (
                  <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des chantiers…
                  </p>
                ) : sites.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Aucun chantier disponible.</p>
                ) : (
                  <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                    {sites.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSel(s)}
                          className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-left text-sm font-medium hover:bg-accent active:scale-[0.99] transition-transform"
                        >
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
                {/* Préparer la réunion avant de saisir (même flux que /m/site). */}
                <div className="mb-3">
                  <SiteBriefButton siteId={sel.id} mode="meeting" variant="mobile" />
                </div>
                <SiteReportPanel
                  reportType="site"
                  siteId={sel.id}
                  siteName={sel.name}
                  onClose={close}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
