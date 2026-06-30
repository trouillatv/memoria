'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Radio, Pause, Camera, Video, Mic, Pencil, Target, MapPin, Star, HelpCircle, CloudUpload, Play, CheckCircle2 } from 'lucide-react'
import { countQueuedVisitCapturesByReport } from '@/lib/field/visit-capture-queue'
import type { VisitCaptureKind } from '@/lib/db/visit-captures'

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

function relativeLabel(mins: number | null): string {
  if (mins == null) return ''
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const h = Math.floor(mins / 60)
  return `il y a ${h} h${mins % 60 ? ` ${mins % 60}` : ''}`
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

const KIND_ICON: Record<VisitCaptureKind, typeof Camera> = {
  photo: Camera, video: Video, vocal: Mic, note: Pencil, verification: Target, position: MapPin,
}

// Composition de la visite — l'agent reconnaît SA visite (« la grosse, 42 photos,
// 4 trucs importants »). Inclut ⭐ et ❓ : ça raconte plus que le seul volume.
function KindChips({ visit }: { visit: ActiveVisitCardItem }) {
  const k = visit.kinds
  const chips: Array<{ icon: typeof Camera; n: number; cls: string }> = [
    { icon: Camera, n: k.photo, cls: '' },
    { icon: Video, n: k.video, cls: '' },
    { icon: Mic, n: k.vocal, cls: '' },
    { icon: Pencil, n: k.note, cls: '' },
    { icon: Star, n: visit.starred, cls: 'text-amber-600 dark:text-amber-400' },
    { icon: HelpCircle, n: visit.questions, cls: 'text-amber-700 dark:text-amber-300' },
  ].filter((c) => c.n > 0)
  if (chips.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-emerald-900/80 dark:text-emerald-100/80">
      {chips.map((c, i) => {
        const Icon = c.icon
        return (
          <span key={i} className="inline-flex items-center gap-1">
            <Icon className={`h-3.5 w-3.5 ${c.cls || 'text-emerald-700/70 dark:text-emerald-300/70'}`} />
            <span className="tabular-nums font-medium">{c.n}</span>
          </span>
        )
      })}
    </div>
  )
}

function VisitRow({ visit }: { visit: ActiveVisitCardItem }) {
  const elapsed = useElapsed(visit.startedAt)
  const idleMins = useMinutesSince(visit.lastActivityAt)
  const pending = usePendingCount(visit.reportId)

  const synced = visit.captureCount
  const total = synced + pending
  const paused = idleMins != null && idleMins >= PAUSE_AFTER_MIN && total > 0
  const LastIcon = visit.lastCapture ? KIND_ICON[visit.lastCapture.kind] : null

  return (
    <Link
      href={`/m/site/${visit.siteId}`}
      className={`block rounded-2xl border px-5 py-5 active:scale-[0.99] transition-transform ${
        paused
          ? 'border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20'
          : 'border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-950/25'
      }`}
    >
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
        paused ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
      }`}>
        {paused ? <Pause className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5 animate-pulse" />}
        {paused ? 'En pause' : 'Visite en cours'}
      </div>

      <p className="mt-1.5 text-lg font-bold leading-tight text-emerald-950 dark:text-emerald-50">
        {visit.siteName}
      </p>
      {elapsed && (
        <p className="text-[13px] text-emerald-800/80 dark:text-emerald-200/70">Commencée il y a {elapsed}</p>
      )}
      {idleMins != null && total > 0 && (
        <p className={`text-[12px] ${paused ? 'text-amber-700/80 dark:text-amber-300/70' : 'text-emerald-700/70 dark:text-emerald-300/60'}`}>
          Dernière activité {relativeLabel(idleMins)}
        </p>
      )}

      <KindChips visit={visit} />

      {/* « Où je me suis arrêté » — repère immédiat (façon Google Docs). */}
      {visit.lastCapture && LastIcon && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-emerald-900/85 dark:text-emerald-100/85">
          <span className="text-muted-foreground">Dernier :</span>
          <LastIcon className="h-3.5 w-3.5 shrink-0 text-emerald-700/70 dark:text-emerald-300/70" />
          <span className="min-w-0 truncate font-medium">{visit.lastCapture.label}</span>
          {visit.lastCapture.starred && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
        </p>
      )}

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
