'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AnomalyModal } from './anomaly-modal'

export function AnomalyTrigger({
  interventionId,
  categories,
}: {
  interventionId: string
  categories: { key: string; label: string; icon: string | null }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border bg-card text-base font-medium px-4 py-3 active:bg-muted/40"
        style={{ minHeight: 56 }}
      >
        <AlertTriangle className="h-5 w-5 text-muted-foreground" />
        {/* « Découverte » couvre le problème ET l'imprévu (poutre fissurée) —
            le terrain constate, le conducteur qualifie (audit 2026-07-13). */}
        Signaler une découverte
      </button>
      <AnomalyModal
        interventionId={interventionId}
        open={open}
        onClose={() => setOpen(false)}
        categories={categories}
      />
    </>
  )
}
