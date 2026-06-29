'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Radio, Camera, CloudUpload, Play, CheckCircle2 } from 'lucide-react'
import { countQueuedVisitCapturesByReport } from '@/lib/field/visit-capture-queue'

/**
 * Lot A — « Visite en cours » sur l'accueil terrain. Une visite est un objet
 * VIVANT : on l'interrompt (pause déjeuner, voiture) et on la reprend sans la
 * chercher. C'est LE bouton principal quand une collecte est ouverte : il monte
 * tout en haut de /m, avant même « ce qui demande ton attention ».
 *
 * Le « N en attente d'envoi » est un état CLIENT (file IndexedDB du Lot B) : il
 * fond tout seul à mesure que le drain de fond monte les médias. Données serveur
 * (lieu, ancienneté, nombre de captures) passées en props ; le pending est lu ici.
 */
export interface ActiveVisitCardItem {
  reportId: string
  siteId: string
  siteName: string
  startedAt: string | null
  captureCount: number
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

function VisitRow({ visit }: { visit: ActiveVisitCardItem }) {
  const elapsed = useElapsed(visit.startedAt)
  const lastActivity = useRelativeSince(visit.lastActivityAt)
  const pending = usePendingCount(visit.reportId)

  return (
    <Link
      href={`/m/site/${visit.siteId}`}
      className="block rounded-2xl border border-emerald-500/40 bg-emerald-50/70 px-5 py-5 active:scale-[0.99] transition-transform dark:bg-emerald-950/25"
    >
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
      {lastActivity && visit.captureCount > 0 && (
        <p className="text-[12px] text-emerald-700/70 dark:text-emerald-300/60">Dernière activité {lastActivity}</p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
          <Camera className="h-3.5 w-3.5" />
          {visit.captureCount} capture{visit.captureCount > 1 ? 's' : ''}
        </span>
        {pending > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            <CloudUpload className="h-3.5 w-3.5" />
            {pending} en attente d&apos;envoi
          </span>
        ) : visit.captureCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            tout est envoyé
          </span>
        ) : null}
      </div>

      <div className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
        <Play className="h-4 w-4 fill-current" />
        Reprendre
      </div>
    </Link>
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
