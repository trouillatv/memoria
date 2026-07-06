'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Square, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { startVisitAction, endVisitAction } from './visit-actions'

/**
 * Démarrer / terminer une visite terrain (mobile). FRICTION ZÉRO :
 *   - « Démarrer une visite » → pose un repère (started_at). Aucune question.
 *   - pendant : le conducteur capture normalement (photo/note/vocal/action/réserve).
 *   - « Terminer » → pose ended_at. La réflexion (objectif/résultat) se fait au
 *     bureau, dans le Débrief. Il repart, fin.
 */
export function VisitLauncher({
  siteId,
  activeVisit,
}: {
  siteId: string
  activeVisit: { id: string; started_at: string | null } | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!activeVisit?.started_at) return
    const start = new Date(activeVisit.started_at).getTime()
    const tick = () => {
      const mins = Math.max(0, Math.floor((Date.now() - start) / 60000))
      setElapsed(mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [activeVisit?.started_at])

  function start() {
    startTransition(async () => {
      const res = await startVisitAction({ site_id: siteId })
      if (res.ok) {
        toast.success('Visite démarrée', { duration: 1500 })
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function end() {
    if (!activeVisit) return
    startTransition(async () => {
      const res = await endVisitAction({ report_id: activeVisit.id, site_id: siteId })
      if (res.ok) {
        toast.success('Visite terminée — relisons vite', { duration: 1500 })
        router.push(`/m/visite/${activeVisit.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  if (activeVisit) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
          <Radio className="h-4 w-4 animate-pulse text-emerald-600" />
          Visite en cours{elapsed ? ` · ${elapsed}` : ''}
        </div>
        <button
          type="button"
          onClick={end}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Square className="h-4 w-4" /> Terminer
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
    >
      <Play className="h-4 w-4" /> Démarrer une visite
    </button>
  )
}
