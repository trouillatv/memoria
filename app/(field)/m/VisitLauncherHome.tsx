'use client'

// « Démarrer une visite » DEPUIS l'accueil /m, sous « Enregistrer une réunion ».
// Deux entrées dans le même geste :
//   - CHANTIER EXISTANT : on choisit dans la liste (même scoping que /m/sites),
//     on démarre la visite et on file sur le chantier — le panier s'ouvre.
//   - NOUVEAU CHANTIER : création minimale (nom requis, adresse/client facultatifs)
//     puis première visite immédiate. Capturer d'abord, structurer ensuite.
// Cf. [[visite-trois-temps]].

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, X, ChevronRight, Loader2, Plus, ArrowLeft, Camera, MessageSquare, FolderUp } from 'lucide-react'
import { toast } from 'sonner'
import { listMeetingSitesAction } from './meeting-actions'
import { startVisitAction } from './site/[siteId]/visit-actions'
import { quickCreateSiteVisitAction } from './quick-site-actions'

type Site = { id: string; name: string }
type Mode = 'pick' | 'create'

export function VisitLauncherHome() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('pick')
  const [sites, setSites] = useState<Site[] | null>(null)
  // Chantier choisi, en attente du MODE de création (capturer / WhatsApp / fichiers).
  const [chosenSite, setChosenSite] = useState<Site | null>(null)
  const [pending, startTransition] = useTransition()

  // Champs création rapide
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [clientName, setClientName] = useState('')

  useEffect(() => {
    if (!open || mode !== 'pick' || sites !== null) return
    listMeetingSitesAction().then(setSites).catch(() => setSites([]))
  }, [open, mode, sites])

  function reset() {
    setMode('pick'); setName(''); setAddress(''); setClientName(''); setChosenSite(null)
  }

  function close() {
    setOpen(false)
    reset()
  }

  // Choisir un chantier n'ouvre plus directement la visite : on demande d'abord le
  // MODE (capturer sur place, ou importer un lot). WhatsApp est un mode, pas un métier.
  function pick(site: Site) {
    setChosenSite(site)
  }

  function captureNow() {
    if (!chosenSite) return
    startTransition(async () => {
      const res = await startVisitAction({ site_id: chosenSite.id })
      if (res.ok) {
        toast.success('Visite démarrée', { duration: 1500 })
        router.push(`/m/site/${chosenSite.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  function importMode(m: 'whatsapp_zip' | 'upload') {
    if (!chosenSite) return
    router.push(`/m/import?site=${chosenSite.id}&mode=${m}`)
  }

  function createAndStart() {
    if (name.trim().length === 0) return
    startTransition(async () => {
      const res = await quickCreateSiteVisitAction({
        name: name.trim(),
        address: address.trim() || undefined,
        clientName: clientName.trim() || undefined,
      })
      if (res.ok) {
        toast.success('Chantier créé — visite démarrée', { duration: 1500 })
        router.push(`/m/site/${res.siteId}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full w-full flex-col items-center justify-start gap-2.5 rounded-2xl bg-emerald-50 px-2 py-5 text-center text-[13px] font-medium leading-snug text-emerald-700 active:scale-[0.97] transition-transform dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/80 text-emerald-600 dark:bg-white/10 dark:text-emerald-300">
          <Play className="h-7 w-7" />
        </span>
        <span className="break-words">Démarrer une visite</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {chosenSite ? `Nouvelle visite : ${chosenSite.name}` : mode === 'create' ? 'Nouveau chantier' : 'Visite — pour quel chantier ?'}
                </h3>
                <button type="button" onClick={close} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {chosenSite ? (
                <div className="space-y-2">
                  <button type="button" onClick={() => setChosenSite(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ArrowLeft className="h-3.5 w-3.5" /> Changer de chantier
                  </button>
                  <p className="text-[13px] text-muted-foreground">Comment démarrer cette visite ?</p>
                  <ModeBtn onClick={captureNow} disabled={pending} icon={<Camera className="h-5 w-5" />} title="Capturer maintenant" hint="Photos, vidéos, vocaux sur place" />
                  <ModeBtn onClick={() => importMode('whatsapp_zip')} disabled={pending} icon={<MessageSquare className="h-5 w-5" />} title="Importer depuis WhatsApp" hint="Un export .zip de la discussion" />
                  <ModeBtn onClick={() => importMode('upload')} disabled={pending} icon={<FolderUp className="h-5 w-5" />} title="Importer des fichiers" hint="Photos, vidéos, vocaux, PDF" />
                </div>
              ) : mode === 'pick' ? (
                <>
                  {/* Créer un nouveau chantier — première visite immédiate. */}
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    disabled={pending}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-2.5 text-left text-sm font-medium text-emerald-700 active:scale-[0.99] transition-transform disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
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
                </>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Nom du chantier *</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={INPUT}
                      maxLength={200}
                      placeholder="ex. Résidence Les Palmiers"
                      disabled={pending}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Adresse <span className="font-normal text-muted-foreground/70">(facultatif)</span>
                    </label>
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className={INPUT}
                      maxLength={500}
                      placeholder="Rue, ville"
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Client <span className="font-normal text-muted-foreground/70">(facultatif)</span>
                    </label>
                    <input
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      className={INPUT}
                      maxLength={200}
                      placeholder="On pourra rattacher plus tard"
                      disabled={pending}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Le nom suffit pour démarrer. MemorIA complétera le dossier au fur et à mesure.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMode('pick')}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium text-muted-foreground disabled:opacity-50"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={createAndStart}
                      disabled={pending || name.trim().length === 0}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Créer et démarrer la visite
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Un mode de création de visite (capturer / WhatsApp / fichiers). */
function ModeBtn({ onClick, disabled, icon, title, hint }: {
  onClick: () => void; disabled?: boolean; icon: React.ReactNode; title: string; hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left active:scale-[0.99] transition-transform disabled:opacity-50"
    >
      <span className="shrink-0 text-emerald-700 dark:text-emerald-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
