'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowRight } from 'lucide-react'

// AVANT / APRÈS — choix des DEUX BORNES. Garde-fous : le PV d'arrivée est toujours postérieur
// au PV de départ, et un PV ne peut jamais être comparé à lui-même (la liste d'arrivée ne
// propose que des PV strictement postérieurs).

export interface BoundOption {
  runId: string
  effectiveDate: string
  pvNumber: number
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
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

  function navigate(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    startTransition(() => {
      router.push(`/sites/${siteId}/historique?view=avant-apres&from=${nextFrom}&to=${nextTo}`)
    })
  }

  function onFromChange(value: string) {
    // Le PV d'arrivée doit rester postérieur : sinon on repositionne sur le dernier PV.
    const nextTo = idxOf(to) > idxOf(value) ? to : runs[runs.length - 1].runId
    navigate(value, nextTo)
  }

  const fromIdx = idxOf(from)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Situation au</span>
        <select
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          disabled={pending}
          className="rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm disabled:opacity-60"
        >
          {runs.slice(0, -1).map((r) => (
            <option key={r.runId} value={r.runId}>
              PV{r.pvNumber} — {fmt(r.effectiveDate)}
            </option>
          ))}
        </select>
      </label>

      <ArrowRight className="mb-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Comparée à</span>
        <select
          value={to}
          onChange={(e) => navigate(from, e.target.value)}
          disabled={pending}
          className="rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm disabled:opacity-60"
        >
          {runs.slice(fromIdx + 1).map((r) => (
            <option key={r.runId} value={r.runId}>
              PV{r.pvNumber} — {fmt(r.effectiveDate)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
