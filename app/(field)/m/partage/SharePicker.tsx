'use client'

// Je vois ce que j'ai partagé, je touche le chantier. C'est tout.
//
// Une seule question de plus, et seulement quand elle a un sens : si le lot
// contient des VOCAUX, ils vont nourrir une RÉUNION — alors on demande
// laquelle. Trois vocaux dans la même réunion, c'est le modèle qui fonctionne
// comme prévu (une réunion = un objet, plusieurs sources), pas un cas tordu.
//
// Le contenu décide de la destination. Guillaume n'a jamais à choisir « visite
// ou réunion » : ses photos sont une visite, ses vocaux sont une réunion.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, FileText, Mic, Search, ChevronRight, ArrowLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { confirmShareAction, discardShareAction, listRecentMeetingsAction } from './share-actions'

export interface SharedFile {
  path: string
  filename: string
  mime: string
  url: string | null
}

interface Meeting {
  id: string
  title: string
  createdAt: string
  sources: number
}

const frDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

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

  // Le lot contient-il des vocaux ? Alors c'est une réunion.
  const audioCount = files.filter((f) => f.mime.startsWith('audio/')).length
  const versReunion = audioCount > 0

  // Étape 2, seulement pour une réunion : laquelle ?
  const [site, setSite] = useState<{ id: string; name: string } | null>(null)
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return sites
    return sites.filter((s) => s.name.toLowerCase().includes(needle))
  }, [q, sites])

  const n = files.length

  function pickSite(s: { id: string; name: string }) {
    if (pending) return
    if (!versReunion) {
      importer(s.id, null)
      return
    }
    // Réunion : on va chercher celles qu'on peut encore enrichir.
    setChosen(s.id)
    start(async () => {
      const list = await listRecentMeetingsAction(s.id)
      setSite(s)
      setMeetings(list)
      setChosen(null)
    })
  }

  function importer(siteId: string, meetingId: string | null) {
    if (pending) return
    setChosen(meetingId ?? siteId)
    start(async () => {
      const r = await confirmShareAction({ lotId, siteId, meetingId })
      if ('error' in r) {
        setChosen(null)
        toast.error(r.error)
        return
      }
      toast.success(
        `${r.count} ${r.count > 1 ? 'éléments arrivés' : 'élément arrivé'} — c’est à l’abri.`,
      )
      router.replace(
        r.destination === 'meeting' ? `/meetings/${r.reportId}` : `/m/visite/${r.reportId}`,
      )
    })
  }

  function abandon() {
    start(async () => {
      await discardShareAction(lotId)
      router.replace('/m')
    })
  }

  // ── Étape 2 — dans quelle réunion ? ────────────────────────────────────────
  if (site && meetings) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
        <button
          type="button"
          onClick={() => {
            setSite(null)
            setMeetings(null)
          }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {site.name}
        </button>

        <header className="space-y-1">
          <h1 className="text-lg font-semibold leading-tight">
            {audioCount} {audioCount > 1 ? 'enregistrements' : 'enregistrement'}
          </h1>
          <p className="text-sm text-muted-foreground">Dans quelle réunion ?</p>
        </header>

        <ul className="space-y-1.5">
          {meetings.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => importer(site.id, m.id)}
                disabled={pending}
                className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {frDate(m.createdAt)}
                    {m.sources > 0 &&
                      ` · ${m.sources} ${m.sources > 1 ? 'enregistrements' : 'enregistrement'}`}
                  </span>
                </span>
                {pending && chosen === m.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}

          <li>
            <button
              type="button"
              onClick={() => importer(site.id, null)}
              disabled={pending}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <Plus className="h-4 w-4" /> Nouvelle réunion
              </span>
              {pending && chosen === site.id ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          </li>
        </ul>

        {meetings.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Un enregistrement ajouté à une réunion existante s’ajoute aux siens — il ne remplace
            rien.
          </p>
        )}
      </div>
    )
  }

  // ── Étape 1 — sur quel chantier ? ─────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold leading-tight">
          {n} {n > 1 ? 'éléments partagés' : 'élément partagé'}
        </h1>
        <p className="text-sm text-muted-foreground">Sur quel chantier ?</p>
      </header>

      {/* Ce qu'il vient de partager — pour qu'il reconnaisse ses fichiers. */}
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
                {f.mime.startsWith('audio/') ? (
                  <Mic className="h-5 w-5" />
                ) : (
                  <FileText className="h-5 w-5" />
                )}
                <span className="line-clamp-2 break-all">{f.filename}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {versReunion && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {audioCount > 1
            ? `${audioCount} enregistrements — ils peuvent nourrir la même réunion.`
            : 'Un enregistrement — il rejoindra une réunion.'}
        </p>
      )}

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

          <ul className="space-y-1.5">
            {filtered.map((s) => {
              const busy = pending && chosen === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pickSite(s)}
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
