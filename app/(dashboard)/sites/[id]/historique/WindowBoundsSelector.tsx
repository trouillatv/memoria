'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

// AVANT / APRÈS — choix des DEUX BORNES. Garde-fous : le PV d'arrivée est toujours postérieur
// au PV de départ, et un PV ne peut jamais être comparé à lui-même (la liste d'arrivée ne
// propose que des PV strictement postérieurs). La comparaison n'est relancée qu'au clic sur
// « Comparer » (ou immédiatement si le choix change les bornes réelles).

export interface BoundOption {
  runId: string
  effectiveDate: string
  pvNumber: number
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function WindowBoundsSelector({
  siteId,
  runs,
  fromRunId,
  toRunId,
}: {
  siteId: string
  runs: BoundOption[]
  fromRunId: string
  toRunId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [from, setFrom] = useState(fromRunId)
  const [to, setTo] = useState(toRunId)

  const idxOf = (id: string) => runs.findIndex((r) => r.runId === id)

  function onFromChange(value: string) {
    // Le PV d'arrivée doit rester strictement postérieur : sinon on repositionne sur le dernier PV.
    const nextTo = idxOf(to) > idxOf(value) ? to : runs[runs.length - 1].runId
    setFrom(value)
    setTo(nextTo)
  }

  function compare() {
    startTransition(() => {
      router.push(`/sites/${siteId}/historique?view=avant-apres&from=${from}&to=${to}`)
    })
  }

  const fromIdx = idxOf(from)
  const dirty = from !== fromRunId || to !== toRunId

  const selectClass =
    'w-full appearance-none rounded-xl border bg-background py-2.5 pl-10 pr-8 text-sm font-medium shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60'

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Situation au</span>
        <span className="relative block">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <select value={from} onChange={(e) => onFromChange(e.target.value)} disabled={pending} className={selectClass}>
            {runs.slice(0, -1).map((r) => (
              <option key={r.runId} value={r.runId}>
                PV n°{r.pvNumber} — {fmt(r.effectiveDate)}
              </option>
            ))}
          </select>
        </span>
        <span className="text-[11px] text-muted-foreground">(le dernier PV n’est pas proposé ici)</span>
      </label>

      <ArrowRight className="mb-8 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />

      <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comparée à</span>
        <span className="relative block">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <select value={to} onChange={(e) => setTo(e.target.value)} disabled={pending} className={selectClass}>
            {runs.slice(fromIdx + 1).map((r) => (
              <option key={r.runId} value={r.runId}>
                PV n°{r.pvNumber} — {fmt(r.effectiveDate)}
              </option>
            ))}
          </select>
        </span>
        <span className="text-[11px] text-muted-foreground">&nbsp;</span>
      </label>

      <button
        type="button"
        onClick={compare}
        disabled={pending || !dirty}
        className={cn(
          'mb-6 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition',
          'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {pending ? 'Comparaison…' : 'Comparer'}
      </button>
    </div>
  )
}
