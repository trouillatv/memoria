'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { ignoreAnomalyMobileAction } from './actions'
import { anomalyLabel } from '@/lib/anomaly-labels'
import type { DbInterventionAnomaly } from '@/types/db'

function AnomalyItem({
  anomaly,
  canDelete,
  onDeleted,
}: {
  anomaly: DbInterventionAnomaly
  canDelete: boolean
  onDeleted: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Auto-reset confirming after 3s so the button doesn't stay stuck in "Confirmer"
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(t)
  }, [confirming])

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDeleting(true)
    onDeleted(anomaly.id)
    await ignoreAnomalyMobileAction(anomaly.id)
  }

  const categoryLabel = anomalyLabel(null, anomaly.category_other, anomaly.category)
  const details = anomaly.description?.trim()

  return (
    <li className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{categoryLabel}</div>
        {details && (
          <p className="mt-1 text-sm text-foreground/85 whitespace-pre-wrap">
            {details}
          </p>
        )}
        {anomaly.status === 'resolved' && (
          <div className="text-xs text-emerald-700 mt-0.5">clôturé</div>
        )}
      </div>
      {canDelete && !deleting && (
        <button
          type="button"
          onClick={handleDelete}
          aria-label={confirming ? 'Confirmer le retrait' : 'Retirer le signalement'}
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

export function AnomalyList({
  anomalies: initial,
  canDelete = false,
}: {
  anomalies: DbInterventionAnomaly[]
  canDelete?: boolean
}) {
  const [anomalies, setAnomalies] = useState(initial)
  const [isOpen, setIsOpen] = useState(true)

  useEffect(() => {
    setAnomalies(initial)
    // Re-open whenever the server sends new anomalies (e.g. after router.refresh)
    if (initial.length > 0) setIsOpen(true)
  }, [initial])

  function handleDeleted(id: string) {
    setAnomalies((prev) => prev.filter((a) => a.id !== id))
  }

  if (anomalies.length === 0) return null

  return (
    <details
      className="group space-y-2"
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        <AlertTriangle className="h-4 w-4" />
        <span>Signalements ({anomalies.length})</span>
      </summary>
      <ul className="space-y-2 mt-2">
        {anomalies.map((a) => (
          <AnomalyItem
            key={a.id}
            anomaly={a}
            canDelete={canDelete}
            onDeleted={handleDeleted}
          />
        ))}
      </ul>
    </details>
  )
}
