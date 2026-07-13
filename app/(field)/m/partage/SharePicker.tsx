'use client'

// Deux gestes, pas trois : je vois ce que j'ai partagé, je touche le chantier.
//
// Pas de formulaire, pas de « Suivant ». Toucher un chantier IMPORTE — le choix
// EST l'action. La visite se crée alors, et il atterrit sur son écran de tri,
// exactement là où atterrit une visite du terrain. Une seule chaîne.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, FileText, Search, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { confirmShareAction, discardShareAction } from './share-actions'

export interface SharedFile {
  path: string
  filename: string
  mime: string
  url: string | null
}

export function SharePicker({
  lotId,
  files,
  sites,
}: {
  lotId: string
  files: SharedFile[]
  sites: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return sites
    return sites.filter((s) => s.name.toLowerCase().includes(needle))
  }, [q, sites])

  const n = files.length

  function importTo(siteId: string) {
    if (pending) return
    setChosen(siteId)
    start(async () => {
      const r = await confirmShareAction({ lotId, siteId })
      if ('error' in r) {
        setChosen(null)
        toast.error(r.error)
        return
      }
      toast.success(
        `${r.count} ${r.count > 1 ? 'éléments importés' : 'élément importé'} — c’est à l’abri.`,
      )
      router.replace(`/m/visite/${r.reportId}`)
    })
  }

  function abandon() {
    start(async () => {
      await discardShareAction(lotId)
      router.replace('/m')
    })
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold leading-tight">
          {n} {n > 1 ? 'éléments partagés' : 'élément partagé'}
        </h1>
        <p className="text-sm text-muted-foreground">Sur quel chantier ?</p>
      </header>

      {/* Ce qu'il vient de partager — pour qu'il reconnaisse ses photos. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {files.map((f) => (
          <div
            key={f.path}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-muted"
          >
            {f.url && f.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, hors domaine configuré
              <img src={f.url} alt={f.filename} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground">
                <FileText className="h-5 w-5" />
                <span className="line-clamp-2 break-all">{f.filename}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {sites.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
          Aucun chantier accessible.{' '}
          <Link href="/m" className="font-medium text-brand-700 hover:underline">
            Retour
          </Link>
        </p>
      ) : (
        <>
          {sites.length > 6 && (
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher un chantier"
                disabled={pending}
                className="w-full rounded-xl border bg-background py-2.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          )}

          {/* Toucher un chantier IMPORTE. Le choix est l'action. */}
          <ul className="space-y-1.5">
            {filtered.map((s) => {
              const busy = pending && chosen === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => importTo(s.id)}
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  >
                    <span className="truncate font-medium">{s.name}</span>
                    {busy ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-1 py-3 text-sm text-muted-foreground">Aucun chantier à ce nom.</li>
            )}
          </ul>
        </>
      )}

      <button
        type="button"
        onClick={abandon}
        disabled={pending}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Abandonner ce partage
      </button>
    </div>
  )
}
