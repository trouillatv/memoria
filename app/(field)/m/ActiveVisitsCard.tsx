'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Radio, Pause, Camera, Video, Mic, Pencil, Star, HelpCircle, CloudUpload, Play } from 'lucide-react'
import { countQueuedVisitCapturesByReport } from '@/lib/field/visit-capture-queue'
import type { VisitCaptureKind } from '@/lib/db/visit-captures'
import { HomeVisitDeleteButton } from './HomeVisitDeleteButton'

/**
 * Lot A — « Visite en cours » sur l'accueil terrain. Une visite est un objet
 * VIVANT : on l'interrompt (pause déjeuner, voiture) et on la reprend sans la
 * chercher. C'est LE bouton principal quand une collecte est ouverte.
 *
 * La carte doit RACONTER la visite : composition (📷/🎤/⭐/❓), où on s'est
 * arrêté (dernier élément), et où en est l'envoi (✓/☁). Au-delà d'un certain
 * temps sans activité, elle bascule d'elle-même en « En pause » (déduit, aucun
 * bouton). Un seul point de CLÔTURE : le panier (on n'ajoute pas « Terminer »
 * ici pour ne pas multiplier les façons de terminer).
 */
export interface ActiveVisitCardItem {
  reportId: string
  siteId: string
  siteName: string
  startedAt: string | null
  captureCount: number
  kinds: { photo: number; video: number; vocal: number; note: number; verification: number; position: number }
  starred: number
  questions: number
  lastCapture: { kind: VisitCaptureKind; label: string; starred: boolean } | null
  lastActivityAt: string | null
}

// Au-delà de ce silence, la visite « semble en pause » (déjeuner, déplacement).
const PAUSE_AFTER_MIN = 45

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

// Minutes écoulées depuis `iso`, rafraîchies — sert au libellé ET à l'état pause.
function useMinutesSince(iso: string | null): number | null {
  const [mins, setMins] = useState<number | null>(null)
  useEffect(() => {
    if (!iso) return // l'état par défaut est déjà null
    const t = new Date(iso).getTime()
    const tick = () => setMins(Math.max(0, Math.floor((Date.now() - t) / 60000)))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [iso])
  return mins
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
    const id = setInterval(read, 5_000)
    return () => { alive = false; clearInterval(id) }
  }, [reportId])
  return pending
}

function VisitRow({ visit }: { visit: ActiveVisitCardItem }) {
  const elapsed = useElapsed(visit.startedAt)
  const idleMins = useMinutesSince(visit.lastActivityAt)
  const pending = usePendingCount(visit.reportId)

  const synced = visit.captureCount
  const total = synced + pending
  const paused = idleMins != null && idleMins >= PAUSE_AFTER_MIN && total > 0

  // Composition de la visite en SYMBOLES compacts (📷/🎥/🎤/✏️/⭐/❓) : l'état
  // se lit d'un coup d'œil, sur une seule ligne, sans déplier la carte.
  const k = visit.kinds
  const chips: Array<{ icon: typeof Camera; n: number; cls: string }> = [
    { icon: Camera, n: k.photo, cls: '' },
    { icon: Video, n: k.video, cls: '' },
    { icon: Mic, n: k.vocal, cls: '' },
    { icon: Pencil, n: k.note, cls: '' },
    { icon: Star, n: visit.starred, cls: 'text-amber-600 dark:text-amber-400' },
    { icon: HelpCircle, n: visit.questions, cls: 'text-amber-700 dark:text-amber-300' },
  ].filter((c) => c.n > 0)

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border px-4 py-3 ${
        paused
          ? 'border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20'
          : 'border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-950/25'
      }`}
    >
      {/* Zone tapable = reprendre. Le nom + les symboles d'état. */}
      <Link href={`/m/site/${visit.siteId}`} className="flex min-w-0 flex-1 flex-col active:opacity-70">
        {/* Ligne 1 : état (● en cours / ⏸ en pause) + nom du chantier. */}
        <span className="flex items-center gap-1.5">
          {paused
            ? <Pause className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            : <Radio className="h-3.5 w-3.5 shrink-0 animate-pulse text-emerald-600" />}
          <span className="min-w-0 truncate font-semibold text-emerald-950 dark:text-emerald-50">
            {visit.siteName}
          </span>
        </span>

        {/* Ligne 2 : symboles d'état (nb de photos/vidéos/vocaux/notes…) + envoi + durée. */}
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-emerald-900/75 dark:text-emerald-100/75">
          {chips.length === 0 ? (
            <span className="text-emerald-800/55 dark:text-emerald-200/45">Rien capturé pour l&apos;instant</span>
          ) : (
            chips.map((c, i) => {
              const Icon = c.icon
              return (
                <span key={i} className="inline-flex items-center gap-0.5">
                  <Icon className={`h-3.5 w-3.5 ${c.cls || 'text-emerald-700/70 dark:text-emerald-300/70'}`} />
                  <span className="tabular-nums font-medium">{c.n}</span>
                </span>
              )
            })
          )}
          {pending > 0 && (
            <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300" title={`${pending} en attente d'envoi`}>
              <CloudUpload className="h-3.5 w-3.5" />
              <span className="tabular-nums font-medium">{pending}</span>
            </span>
          )}
          {elapsed && (
            <span className="text-emerald-700/50 dark:text-emerald-300/40">· {paused ? 'en pause' : elapsed}</span>
          )}
        </span>
      </Link>

      {/* Supprimer la visite (fantôme / test / doublon) — 2 temps, sans l'ouvrir. */}
      <HomeVisitDeleteButton reportId={visit.reportId} tone={paused ? 'amber' : 'emerald'} />

      {/* Reprendre : triangle de lecture à DROITE. */}
      <Link
        href={`/m/site/${visit.siteId}`}
        aria-label="Reprendre"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white active:brightness-95 ${
          paused ? 'bg-amber-600' : 'bg-emerald-700'
        }`}
      >
        <Play className="h-5 w-5 fill-current" />
      </Link>
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
