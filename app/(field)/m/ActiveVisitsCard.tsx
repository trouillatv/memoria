'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Radio, Camera, Video, Mic, Pencil, CloudUpload, Play, CheckCircle2, Check, Loader2, Square } from 'lucide-react'
import { toast } from 'sonner'
import { countQueuedVisitCapturesByReport } from '@/lib/field/visit-capture-queue'
import { endVisitAction } from '@/app/(field)/m/site/[siteId]/visit-actions'

/**
 * Lot A — « Visite en cours » sur l'accueil terrain. Une visite est un objet
 * VIVANT : on l'interrompt (pause déjeuner, voiture) et on la reprend sans la
 * chercher. C'est LE bouton principal quand une collecte est ouverte : il monte
 * tout en haut de /m, avant même « ce qui demande ton attention ».
 *
 * La carte doit permettre de RECONNAÎTRE sa visite (répartition par type) et de
 * savoir où en est l'envoi (✓ synchronisées / ☁ en attente) sans rouvrir le
 * panier. On peut aussi la TERMINER d'ici (depuis la voiture). Le « en attente »
 * est un état CLIENT (file IndexedDB du Lot B) lu ici ; il fond tout seul.
 */
export interface ActiveVisitCardItem {
  reportId: string
  siteId: string
  siteName: string
  startedAt: string | null
  captureCount: number
  kinds: { photo: number; video: number; vocal: number; note: number; verification: number; position: number }
  lastActivityAt: string | null
}

function useElapsed(startedAt: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => {
      const m = Math.max(0, Math.floor((Date.now() - start) / 60000))
      setLabel(m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim())
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [startedAt])
  return label
}

// « il y a X » qui se rafraîchit — repère immédiat pour l'agent qui revient.
function useRelativeSince(iso: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!iso) return
    const t = new Date(iso).getTime()
    const tick = () => {
      const m = Math.max(0, Math.floor((Date.now() - t) / 60000))
      if (m < 1) setLabel("à l'instant")
      else if (m < 60) setLabel(`il y a ${m} min`)
      else {
        const h = Math.floor(m / 60)
        setLabel(`il y a ${h} h${m % 60 ? ` ${m % 60}` : ''}`)
      }
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [iso])
  return label
}

function usePendingCount(reportId: string): number {
  const [pending, setPending] = useState(0)
  useEffect(() => {
    let alive = true
    const read = () => {
      countQueuedVisitCapturesByReport(reportId)
        .then((n) => { if (alive) setPending(n) })
        .catch(() => { /* IndexedDB indispo : on n'affiche juste rien */ })
    }
    read()
    // Le drain global fait fondre la file : on relit régulièrement.
    const id = setInterval(read, 5_000)
    return () => { alive = false; clearInterval(id) }
  }, [reportId])
  return pending
}

// Répartition par type — l'agent reconnaît SA visite (« la grosse, 42 photos »).
function KindChips({ kinds }: { kinds: ActiveVisitCardItem['kinds'] }) {
  const chips: Array<{ icon: typeof Camera; n: number; label: string }> = [
    { icon: Camera, n: kinds.photo, label: kinds.photo > 1 ? 'photos' : 'photo' },
    { icon: Video, n: kinds.video, label: kinds.video > 1 ? 'vidéos' : 'vidéo' },
    { icon: Mic, n: kinds.vocal, label: kinds.vocal > 1 ? 'vocaux' : 'vocal' },
    { icon: Pencil, n: kinds.note, label: kinds.note > 1 ? 'notes' : 'note' },
  ].filter((c) => c.n > 0)
  if (chips.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-emerald-900/80 dark:text-emerald-100/80">
      {chips.map((c) => {
        const Icon = c.icon
        return (
          <span key={c.label} className="inline-flex items-center gap-1">
            <Icon className="h-3.5 w-3.5 text-emerald-700/70 dark:text-emerald-300/70" />
            <span className="tabular-nums font-medium">{c.n}</span> {c.label}
          </span>
        )
      })}
    </div>
  )
}

function VisitRow({ visit }: { visit: ActiveVisitCardItem }) {
  const router = useRouter()
  const elapsed = useElapsed(visit.startedAt)
  const lastActivity = useRelativeSince(visit.lastActivityAt)
  const pending = usePendingCount(visit.reportId)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, startEnding] = useTransition()

  const synced = visit.captureCount
  const total = synced + pending

  function end() {
    startEnding(async () => {
      const r = await endVisitAction({ report_id: visit.reportId, site_id: visit.siteId })
      if (r.ok) {
        toast.success('Visite terminée', { duration: 1500 })
        router.refresh()
      } else {
        toast.error(r.error)
        setConfirmEnd(false)
      }
    })
  }

  return (
    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-50/70 px-5 py-5 dark:bg-emerald-950/25">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <Radio className="h-3.5 w-3.5 animate-pulse" />
        Visite en cours
      </div>

      <p className="mt-1.5 text-lg font-bold leading-tight text-emerald-950 dark:text-emerald-50">
        {visit.siteName}
      </p>
      {elapsed && (
        <p className="text-[13px] text-emerald-800/80 dark:text-emerald-200/70">Commencée il y a {elapsed}</p>
      )}
      {lastActivity && total > 0 && (
        <p className="text-[12px] text-emerald-700/70 dark:text-emerald-300/60">Dernière activité {lastActivity}</p>
      )}

      <KindChips kinds={visit.kinds} />

      {/* État d'envoi EXPLICITE : on ne laisse jamais deviner si « les autres »
          sont parties. ✓ synchronisées + ☁ en attente, séparément. */}
      {total > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {synced} synchronisée{synced > 1 ? 's' : ''}
          </span>
          {pending > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              <CloudUpload className="h-3.5 w-3.5" />
              {pending} en attente
            </span>
          )}
        </div>
      )}

      {/* Reprendre (principal) + Terminer (depuis la voiture, sans rouvrir le
          panier) — avec confirmation pour éviter une clôture accidentelle. */}
      {confirmEnd ? (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100">Terminer la visite ?</span>
          <button
            type="button" onClick={end} disabled={ending}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Oui
          </button>
          <button
            type="button" onClick={() => setConfirmEnd(false)} disabled={ending}
            className="rounded-xl border border-emerald-600/30 px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200 disabled:opacity-50"
          >
            Non
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <Link
            href={`/m/site/${visit.siteId}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-transform"
          >
            <Play className="h-4 w-4 fill-current" />
            Reprendre
          </Link>
          <button
            type="button" onClick={() => setConfirmEnd(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600/30 px-4 py-2.5 text-sm font-medium text-emerald-800 dark:text-emerald-200 active:scale-[0.98] transition-transform"
          >
            <Square className="h-4 w-4" />
            Terminer
          </button>
        </div>
      )}
    </div>
  )
}

export function ActiveVisitsCard({ visits }: { visits: ActiveVisitCardItem[] }) {
  if (visits.length === 0) return null
  return (
    <div className="space-y-3">
      {visits.map((v) => (
        <VisitRow key={v.reportId} visit={v} />
      ))}
    </div>
  )
}
