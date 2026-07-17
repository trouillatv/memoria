'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2,
  FileText,
  Mic,
  Video,
  Search,
  ChevronRight,
  ArrowLeft,
  Plus,
  MapPin,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  attachSharedBatchAction,
  discardShareAction,
  listRecentVisitsAction,
  listRecentMeetingsAction,
  type ShareTargetOption,
  type LastShareTarget,
} from './share-actions'

export interface SharedFile {
  path: string
  filename: string
  mime: string
  url: string | null
}

type Destination = 'existing-visit' | 'existing-meeting' | 'new-visit' | 'new-meeting'
type Site = { id: string; name: string }

function whenFr(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  if (day(d) === day(today)) return 'Aujourd’hui'
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (day(d) === day(yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function destinationMeta(destination: Destination) {
  switch (destination) {
    case 'existing-visit':
      return {
        title: 'Visite existante',
        lead: 'Ajouter les médias à une visite non terminée',
        icon: MapPin,
        kind: 'visit' as const,
      }
    case 'existing-meeting':
      return {
        title: 'Réunion existante',
        lead: 'Ajouter les médias à une réunion non terminée',
        icon: Users,
        kind: 'meeting' as const,
      }
    case 'new-visit':
      return {
        title: 'Nouvelle visite',
        lead: 'Créer une visite terrain sur un chantier',
        icon: Plus,
        kind: 'visit' as const,
      }
    case 'new-meeting':
      return {
        title: 'Nouvelle réunion',
        lead: 'Créer une réunion et y joindre ces médias',
        icon: Plus,
        kind: 'meeting' as const,
      }
  }
}

export function SharePicker({
  lotId,
  files,
  sites,
  lotLabel,
  last,
}: {
  lotId: string
  files: SharedFile[]
  sites: Site[]
  lotLabel: string
  last: LastShareTarget | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [q, setQ] = useState('')
  const [site, setSite] = useState<Site | null>(null)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [targets, setTargets] = useState<ShareTargetOption[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? sites.filter((s) => s.name.toLowerCase().includes(needle)) : sites
  }, [q, sites])

  const audios = files.filter((f) => f.mime.startsWith('audio/')).length
  const metas = destination ? destinationMeta(destination) : null
  const kind = metas?.kind ?? null
  const isExisting = destination === 'existing-visit' || destination === 'existing-meeting'
  const isNew = destination === 'new-visit' || destination === 'new-meeting'

  function openDestination(next: Destination) {
    if (!site || pending) return
    setDestination(next)
    setBusyId(null)
    setTitle('')
    setTargets(null)
    if (next === 'existing-visit' || next === 'new-visit') {
      start(async () => {
        const list = await listRecentVisitsAction(site.id)
        setTargets(list)
      })
      return
    }
    if (next === 'existing-meeting' || next === 'new-meeting') {
      start(async () => {
        const list = await listRecentMeetingsAction(site.id)
        setTargets(list)
      })
    }
  }

  function attach(id: string | null) {
    if (!site || !destination || pending) return
    const meta = destinationMeta(destination)
    const kind = meta.kind
    setBusyId(id ?? '__new__')
    start(async () => {
      const r = await attachSharedBatchAction({
        lotId,
        siteId: site.id,
        destination: {
          type: kind,
          id,
          title: isNew ? title.trim() || null : undefined,
        },
      })
      if ('error' in r) {
        setBusyId(null)
        toast.error(r.error)
        return
      }
      toast.success(
        r.duplicates > 0
          ? `${r.added} ajouté${r.added > 1 ? 's' : ''} — ${r.duplicates} était${r.duplicates > 1 ? 'ent' : ''} déjà là.`
          : r.transcribed > 0
            ? `${lotLabel} — ${r.transcribed > 1 ? 'les enregistrements sont écrits' : 'l’enregistrement est écrit'}.`
            : `${lotLabel} — c’est à l’abri.`,
      )
      router.replace(r.destination === 'meeting' ? `/meetings/${r.reportId}` : `/m/visite/${r.reportId}`)
    })
  }

  function createAndAttach() {
    if (!destination || !isNew || pending) return
    attach(null)
  }

  const Vignettes = (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {files.map((f) => (
        <div key={f.path} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-muted">
          {f.url && f.mime.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, hors domaine configuré
            <img src={f.url} alt={f.filename} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground">
              {f.mime.startsWith('audio/') ? (
                <Mic className="h-5 w-5" />
              ) : f.mime.startsWith('video/') ? (
                <Video className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
              <span className="line-clamp-2 break-all">{f.filename}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  )

  if (site && destination && targets) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
        <button
          type="button"
          onClick={() => {
            setDestination(null)
            setTargets(null)
            setTitle('')
          }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {site.name}
        </button>

        <header className="space-y-1">
          <h1 className="text-lg font-semibold leading-tight">{metas?.title}</h1>
          <p className="text-sm text-muted-foreground">{metas?.lead}</p>
        </header>

        <section className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chantier</p>
          <p className="mt-1 text-sm font-medium">{site.name}</p>
        </section>

        {isExisting ? (
          <div className="space-y-3">
            <section className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Éléments non terminés
              </p>
              <p className="text-sm text-muted-foreground">
                Toucher une ligne ajoute immédiatement les médias au bon objet.
              </p>
            </section>

            <ul className="space-y-1.5">
              {targets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => attach(t.id)}
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {kind === 'visit' ? 'Visite' : 'Réunion'} · {t.title}
                        </span>
                        {t.open && (
                          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            en cours
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {site.name} · {whenFr(t.at)} · {t.items} source{t.items > 1 ? 's' : ''}
                      </span>
                    </span>
                    {pending && busyId === t.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
              {targets.length === 0 && (
                <li className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Aucune {kind === 'visit' ? 'visite' : 'réunion'} non terminée sur ce chantier.
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-dashed p-4">
            <p className="text-sm font-medium">Créer {kind === 'visit' ? 'une visite' : 'une réunion'}</p>
            <p className="text-xs text-muted-foreground">
              Le chantier est déjà repris. Tu n’as plus qu’à donner le minimum nécessaire.
            </p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={kind === 'visit' ? 'Motif facultatif' : 'Titre facultatif'}
              disabled={pending}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={createAndAttach}
              disabled={pending}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-brand-600 px-4 py-3 text-left font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> Créer et ajouter les {files.length} éléments
              </span>
              {pending && busyId === '__new__' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
            </button>
          </div>
        )}

        {targets.length > 0 && isExisting && (
          <p className="text-[11px] text-muted-foreground">
            Rejoindre un objet existant ajoute ces éléments. Rien n’est remplacé, et un fichier déjà envoyé ne
            revient pas deux fois.
          </p>
        )}

        {Vignettes}
      </div>
    )
  }

  if (site) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
        <button
          type="button"
          onClick={() => setSite(null)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Changer de chantier
        </button>

        <header className="space-y-1">
          <h1 className="text-lg font-semibold leading-tight">{site.name}</h1>
          <p className="text-sm text-muted-foreground">{lotLabel} — où les ajouter ?</p>
        </header>

        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => openDestination('existing-visit')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'existing-visit' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <MapPin className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Visite existante</span>
            <span className="text-xs text-muted-foreground">Ajouter les médias à une visite non terminée</span>
          </button>

          <button
            type="button"
            onClick={() => openDestination('existing-meeting')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'existing-meeting' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Users className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Réunion existante</span>
            <span className="text-xs text-muted-foreground">Ajouter les médias à une réunion non terminée</span>
          </button>

          <button
            type="button"
            onClick={() => openDestination('new-visit')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'new-visit' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Nouvelle visite</span>
            <span className="text-xs text-muted-foreground">Créer une visite terrain sur un chantier</span>
          </button>

          <button
            type="button"
            onClick={() => openDestination('new-meeting')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'new-meeting' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Nouvelle réunion</span>
            <span className="text-xs text-muted-foreground">Créer une réunion et y joindre ces médias</span>
          </button>
        </div>

        {last && (
          <p className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
            Dernier partage: {last.siteName} · {last.type === 'visit' ? 'visite' : 'réunion'} {last.title}
          </p>
        )}

        {Vignettes}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold leading-tight">{lotLabel}</h1>
        <p className="text-sm text-muted-foreground">Sur quel chantier ?</p>
      </header>

      {Vignettes}

      {audios > 0 && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {pending
            ? 'On écrit ce qui a été dit… quelques secondes.'
            : audios > 1
              ? 'Les enregistrements seront écrits à l’arrivée : vous pourrez les relire et les chercher.'
              : 'L’enregistrement sera écrit à l’arrivée : vous pourrez le relire et le chercher.'}
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
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSite(s)}
                  disabled={pending}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                >
                  <span className="truncate font-medium">{s.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-1 py-3 text-sm text-muted-foreground">Aucun chantier à ce nom.</li>
            )}
          </ul>
        </>
      )}

      <button
        type="button"
        onClick={() =>
          start(async () => {
            await discardShareAction(lotId)
            router.replace('/m')
          })
        }
        disabled={pending}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Abandonner ce partage
      </button>
    </div>
  )
}
