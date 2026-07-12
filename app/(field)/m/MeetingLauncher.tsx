'use client'

// « Enregistrer une réunion » DEPUIS l'accueil /m : on choisit d'abord le
// chantier (existant OU nouveau, créé à la volée — comme la visite), puis on
// lance l'enregistreur de réunion EXISTANT (SiteReportPanel, mode « réunion
// site ») — zéro duplication de la logique d'ingestion.

import { useState, useEffect, useTransition } from 'react'
import { Mic, X, ChevronRight, Loader2, Plus, ArrowLeft, Play } from 'lucide-react'
import { toast } from 'sonner'
import { listMeetingSitesAction } from './meeting-actions'
import { quickCreateSiteAction } from './quick-site-actions'
import { SiteReportPanel } from './site/[siteId]/SiteReportPanel'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'

type Site = { id: string; name: string }
type Mode = 'pick' | 'create'

const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

export function MeetingLauncher() {
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<Site[] | null>(null)
  const [sel, setSel] = useState<Site | null>(null)
  const [mode, setMode] = useState<Mode>('pick')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [clientName, setClientName] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || sites !== null) return
    listMeetingSitesAction()
      .then(setSites)
      .catch(() => setSites([]))
  }, [open, sites])

  function close() {
    setOpen(false)
    setSel(null)
    setMode('pick')
    setName(''); setAddress(''); setClientName('')
  }

  // Nouveau chantier → on crée juste le site, puis on ouvre la réunion dessus.
  function createAndSelect() {
    if (name.trim().length === 0) return
    startTransition(async () => {
      const res = await quickCreateSiteAction({
        name: name.trim(),
        address: address.trim() || undefined,
        clientName: clientName.trim() || undefined,
      })
      if (res.ok) {
        toast.success('Chantier créé', { duration: 1200 })
        setSel({ id: res.siteId, name: res.siteName })
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
        className="flex h-full w-full flex-col items-center justify-start gap-2.5 rounded-2xl bg-blue-50 px-2 py-5 text-center text-[13px] font-medium leading-snug text-blue-700 active:scale-[0.97] transition-transform dark:bg-blue-950/30 dark:text-blue-300"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/80 text-blue-600 dark:bg-white/10 dark:text-blue-300">
          <Mic className="h-7 w-7" />
        </span>
        {/* L'intention d'abord (audit 2026-07-13). « Décider ensemble » plutôt
            que « Nous venons décider » (revue : la phrase qu'on dirait). */}
        <span className="break-words font-semibold">Décider ensemble</span>
        <span className="-mt-1.5 block text-[11px] font-normal opacity-75">Enregistrer une réunion</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            {!sel ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {mode === 'create' ? 'Nouveau chantier' : 'Réunion — pour quel chantier ?'}
                  </h3>
                  <button type="button" onClick={close} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {mode === 'create' ? (
                  /* Création rapide — nom requis, reste facultatif (comme la visite). */
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Nom du chantier *</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} maxLength={200} placeholder="ex. Résidence Les Palmiers" disabled={pending} autoFocus />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Adresse <span className="font-normal text-muted-foreground/70">(facultatif)</span></label>
                      <input value={address} onChange={(e) => setAddress(e.target.value)} className={INPUT} maxLength={500} placeholder="Rue, ville" disabled={pending} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Client <span className="font-normal text-muted-foreground/70">(facultatif)</span></label>
                      <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={INPUT} maxLength={200} placeholder="On pourra rattacher plus tard" disabled={pending} />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button type="button" onClick={() => setMode('pick')} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium text-muted-foreground disabled:opacity-50">
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={createAndSelect} disabled={pending || name.trim().length === 0} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Créer et enregistrer la réunion
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Créer un nouveau chantier — puis réunion immédiate (comme la visite). */}
                    <button
                      type="button"
                      onClick={() => setMode('create')}
                      disabled={pending}
                      className="flex w-full items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/60 px-3 py-2.5 text-left text-sm font-medium text-blue-700 active:scale-[0.99] transition-transform disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">Nouveau chantier</span>
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    </button>

                    {sites === null ? (
                      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des chantiers…
                      </p>
                    ) : sites.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">Aucun chantier existant — créez-en un ci-dessus.</p>
                    ) : (
                      <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto">
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
                  </>
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
