'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { ignoreAnomalyMobileAction } from './actions'
import { anomalyLabel } from '@/lib/anomaly-labels'
import type { DbInterventionAnomaly } from '@/types/db'

function AnomalyItem({
  anomaly,
  onDeleted,
}: {
  anomaly: DbInterventionAnomaly
  onDeleted: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    onDeleted(anomaly.id)
    await ignoreAnomalyMobileAction(anomaly.id)
  }

  const label = anomalyLabel(anomaly.description, anomaly.category_other, anomaly.category)

  return (
    <li className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {anomaly.status === 'resolved' && (
          <div className="text-xs text-emerald-700 mt-0.5">clôturé</div>
        )}
      </div>
      {!deleting && (
        <button
          type="button"
          onClick={handleDelete}
          className={`shrink-0 flex items-center justify-center h-8 rounded-lg px-2 text-xs gap-1 transition-colors ${
            confirming
              ? 'bg-destructive text-destructive-foreground'
              : 'text-muted-foreground active:text-destructive'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirming && <span>Confirmer</span>}
        </button>
      )}
    </li>
  )
}

export function AnomalyList({ anomalies: initial }: { anomalies: DbInterventionAnomaly[] }) {
  const [anomalies, setAnomalies] = useState(initial)

  useEffect(() => { setAnomalies(initial) }, [initial])

  function handleDeleted(id: string) {
    setAnomalies((prev) => prev.filter((a) => a.id !== id))
  }

  if (anomalies.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium flex items-center gap-1.5 text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        Signalements ({anomalies.length})
      </h2>
      <ul className="space-y-2">
        {anomalies.map((a) => (
          <AnomalyItem key={a.id} anomaly={a} onDeleted={handleDeleted} />
        ))}
      </ul>
    </section>
  )
}
