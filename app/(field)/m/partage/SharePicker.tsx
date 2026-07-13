'use client'

// Trois questions, jamais plus :
//
//   1. Sur quel chantier ?
//   2. Une visite, ou une réunion ?          ← C'EST LUI QUI CHOISIT
//   3. Laquelle ? (ou : une nouvelle)
//
// La deuxième question n'est pas une paresse d'implémentation : c'est la
// correction d'une erreur. On avait cru pouvoir deviner (« vocal → réunion,
// photo → visite »). Faux : un vocal peut documenter une visite de terrain,
// une photo peut illustrer une réunion technique. Deviner, c'est ranger la
// mémoire au mauvais endroit — pire que poser la question.
//
// Et tout est ADDITIF : rejoindre une visite existante ajoute les éléments,
// n'écrase rien, et ne recrée pas la visite.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2, FileText, Mic, Video, Search, ChevronRight, ArrowLeft, Plus, MapPin, Users,
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

type Kind = 'visit' | 'meeting'
type Site = { id: string; name: string }

/** « Aujourd'hui », « Hier », « 12 juillet » — jamais une date ISO. */
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
  /** « 3 photos et 2 enregistrements ». */
  lotLabel: string
  /** Là où le partage précédent est allé, il y a moins de 6 h. */
  last: LastShareTarget | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [q, setQ] = useState('')
  const [site, setSite] = useState<Site | null>(null)
  const [kind, setKind] = useState<Kind | null>(null)
  const [targets, setTargets] = useState<ShareTargetOption[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? sites.filter((s) => s.name.toLowerCase().includes(needle)) : sites
  }, [q, sites])

  // Un vocal est transcrit À L'ARRIVÉE : ça prend quelques secondes, et il faut
  // le DIRE — sinon l'attente ressemble à un bug.
  const audios = files.filter((f) => f.mime.startsWith('audio/')).length

  function pickKind(k: Kind) {
    if (!site || pending) return
    setBusyId(k)
    start(async () => {
      const list = k === 'visit' ? await listRecentVisitsAction(site.id) : await listRecentMeetingsAction(site.id)
      setKind(k)
      setTargets(list)
      setBusyId(null)
    })
  }

  /** Le raccourci : continuer là où on vient d'aller, sans reposer une question. */
  function continueLast() {
    if (!last || pending) return
    setBusyId('__last__')
    start(async () => {
      const r = await attachSharedBatchAction({
        lotId,
        siteId: last.siteId,
        destination: { type: last.type, id: last.reportId },
      })
      if ('error' in r) {
        setBusyId(null)
        toast.error(r.error)
        return
      }
      toast.success(
        r.transcribed > 0
          ? `Ajouté à « ${last.title} » — ${r.transcribed} ${r.transcribed > 1 ? 'enregistrements écrits' : 'enregistrement écrit'}.`
          : `${lotLabel} — ajouté${r.added > 1 ? 's' : ''} à « ${last.title} ».`,
      )
      router.replace(r.destination === 'meeting' ? `/meetings/${r.reportId}` : `/m/visite/${r.reportId}`)
    })
  }

  function attach(id: string | null) {
    if (!site || !kind || pending) return
    setBusyId(id ?? '__new__')
    start(async () => {
      const r = await attachSharedBatchAction({
        lotId,
        siteId: site.id,
        destination: { type: kind, id, title: title.trim() || null },
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

  // ── 3. Laquelle ? ─────────────────────────────────────────────────────────
  if (site && kind && targets) {
    const mot = kind === 'visit' ? 'visite' : 'réunion'
    return (
      <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
        <button
          type="button"
          onClick={() => {
            setKind(null)
            setTargets(null)
            setTitle('')
          }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {site.name}
        </button>

        <header className="space-y-1">
          <h1 className="text-lg font-semibold leading-tight">{lotLabel}</h1>
          <p className="text-sm text-muted-foreground">
            {targets.length > 0
              ? `Dans quelle ${mot} ?`
              : `Aucune ${mot} sur ce chantier — on en ouvre une ?`}
          </p>
        </header>

        <ul className="space-y-1.5">
          {targets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => attach(t.id)}
                disabled={pending}
                className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">
                      {whenFr(t.at)} — {t.title}
                    </span>
                    {/* Une visite EN COURS est presque toujours celle qu'il vise. */}
                    {t.open && (
                      <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        en cours
                      </span>
                    )}
                  </span>
                  {t.items > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {t.items} élément{t.items > 1 ? 's' : ''} déjà dedans
                    </span>
                  )}
                </span>
                {pending && busyId === t.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Une nouvelle. On ne demande QUE le minimum : la date, c'est celle des
            fichiers ; l'auteur, c'est vous. Reste le titre — et il est optionnel. */}
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={kind === 'visit' ? 'Motif (facultatif)' : 'Titre de la réunion (facultatif)'}
            disabled={pending}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => attach(null)}
            disabled={pending}
            className="flex w-full items-center justify-between gap-2 rounded-lg bg-brand-600 px-4 py-3 text-left font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nouvelle {mot}
            </span>
            {pending && busyId === '__new__' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
          </button>
        </div>

        {targets.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Rejoindre une {mot} existante AJOUTE ces éléments — rien n’est remplacé, et un fichier
            déjà envoyé n’arrive pas deux fois.
          </p>
        )}
      </div>
    )
  }

  // ── 2. Visite, ou réunion ? ───────────────────────────────────────────────
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
          <p className="text-sm text-muted-foreground">
            {lotLabel} — qu’est-ce que ça documente ?
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => pickKind('visit')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'visit' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <MapPin className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Une visite</span>
            <span className="text-xs text-muted-foreground">Ce qui a été vu sur place</span>
          </button>

          <button
            type="button"
            onClick={() => pickKind('meeting')}
            disabled={pending}
            className="flex flex-col items-start gap-1.5 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {pending && busyId === 'meeting' ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Users className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">Une réunion</span>
            <span className="text-xs text-muted-foreground">Ce qui a été dit et décidé</span>
          </button>
        </div>

        {Vignettes}
      </div>
    )
  }

  // ── 1. Sur quel chantier ? ────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold leading-tight">{lotLabel}</h1>
        <p className="text-sm text-muted-foreground">Sur quel chantier ?</p>
      </header>

      {Vignettes}

      {/* WhatsApp n'autorise qu'UN partage à la fois dès qu'on sélectionne
          plusieurs messages : « Partager » disparaît, il ne reste que
          « Transférer ». Cinq photos = cinq partages. Reposer trois questions à
          chaque fois serait insupportable — alors on propose de continuer là où
          on vient d'aller, en UN geste. */}
      {last && (
        <button
          type="button"
          onClick={continueLast}
          disabled={pending}
          className="flex w-full items-center justify-between gap-2 rounded-2xl border-2 border-brand-300 bg-brand-50 px-4 py-3.5 text-left transition-colors hover:bg-brand-100 disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-brand-900">
              Ajouter à « {last.title} »
            </span>
            <span className="block truncate text-xs text-brand-800/80">
              {last.siteName} — {last.type === 'visit' ? 'la visite' : 'la réunion'} que vous venez
              d’alimenter
            </span>
          </span>
          {pending && busyId === '__last__' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-700" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-brand-700" />
          )}
        </button>
      )}

      {audios > 0 && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {pending
            ? 'On écrit ce qui a été dit… quelques secondes.'
            : audios > 1
              ? 'Les enregistrements seront écrits à l’arrivée : vous pourrez les relire et les chercher.'
              : 'L’enregistrement sera écrit à l’arrivée : vous pourrez le relire et le chercher.'}
        </p>
      )}

      {last && sites.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">ou rangez-le ailleurs :</p>
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
        onClick={() => start(async () => {
          await discardShareAction(lotId)
          router.replace('/m')
        })}
        disabled={pending}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Abandonner ce partage
      </button>
    </div>
  )
}
