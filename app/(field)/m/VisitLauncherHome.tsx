'use client'

// « Démarrer une visite » DEPUIS l'accueil /m, sous « Enregistrer une réunion ».
// Même schéma que MeetingLauncher : on choisit d'abord le chantier (même liste/
// scoping, zéro duplication), puis on démarre la visite et on file sur le chantier
// — le panier de visite (temps 1) s'y ouvre. Cf. [[visite-trois-temps]].

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, X, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { listMeetingSitesAction } from './meeting-actions'
import { startVisitAction } from './site/[siteId]/visit-actions'

type Site = { id: string; name: string }

export function VisitLauncherHome() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<Site[] | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || sites !== null) return
    listMeetingSitesAction().then(setSites).catch(() => setSites([]))
  }, [open, sites])

  function pick(site: Site) {
    startTransition(async () => {
      const res = await startVisitAction({ site_id: site.id })
      if (res.ok) {
        toast.success('Visite démarrée', { duration: 1500 })
        router.push(`/m/site/${site.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium active:scale-[0.99] transition-transform"
      >
        <Play className="h-4 w-4" /> Démarrer une visite
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Visite — pour quel chantier&nbsp;?</h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
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
                        onClick={() => pick(s)}
                        disabled={pending}
                        className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-left text-sm font-medium hover:bg-accent active:scale-[0.99] transition-transform disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        {pending
                          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
