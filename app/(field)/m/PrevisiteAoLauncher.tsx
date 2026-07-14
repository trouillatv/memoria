'use client'

// « Nouvelle prévisite AO » DEPUIS l'accueil /m : créer l'affaire + le lieu et
// démarrer la capture, 100 % téléphone. On reste minimal (affaire + site + client
// optionnel) — le reste du module AO vit au bureau. Cf. previsite-actions.ts.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Compass, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { startPrevisiteAoAction } from './previsite-actions'

export function PrevisiteAoLauncher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [affaire, setAffaire] = useState('')
  const [site, setSite] = useState('')
  const [client, setClient] = useState('')
  const [pending, startTransition] = useTransition()

  const canSubmit = affaire.trim().length > 0 && site.trim().length > 0 && !pending

  function submit() {
    if (!canSubmit) return
    startTransition(async () => {
      const res = await startPrevisiteAoAction({
        affaireName: affaire.trim(),
        siteName: site.trim(),
        clientName: client.trim() || undefined,
      })
      if (res.ok) {
        toast.success('Prévisite démarrée', { duration: 1500 })
        router.push(`/m/site/${res.siteId}`)
      } else toast.error(res.error)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full w-full flex-col items-center justify-start gap-2.5 rounded-2xl bg-violet-50 px-2 py-5 text-center text-[13px] font-medium leading-snug text-violet-700 active:scale-[0.97] transition-transform dark:bg-violet-950/30 dark:text-violet-300"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/80 text-violet-600 dark:bg-white/10 dark:text-violet-300">
          <Compass className="h-7 w-7" />
        </span>
        <span className="break-words">Nouvelle prévisite AO</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg space-y-3 rounded-xl border bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Nouvelle prévisite AO</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Nom de l&apos;affaire</span>
              <input
                value={affaire} onChange={(e) => setAffaire(e.target.value)} autoFocus maxLength={200}
                placeholder="Ex : Réfection école Jules Ferry"
                className="w-full rounded-lg border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Chantier / lieu</span>
              <input
                value={site} onChange={(e) => setSite(e.target.value)} maxLength={200}
                placeholder="Ex : École Jules Ferry, Nouméa"
                className="w-full rounded-lg border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Donneur d&apos;ordre <span className="text-muted-foreground/50">(optionnel)</span></span>
              <input
                value={client} onChange={(e) => setClient(e.target.value)} maxLength={200}
                placeholder="Ex : Mairie de Nouméa"
                className="w-full rounded-lg border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <button
              type="button" onClick={submit} disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Démarrer la prévisite
            </button>
          </div>
        </div>
      )}
    </>
  )
}
