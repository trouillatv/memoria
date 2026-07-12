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
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 text-base font-bold text-amber-800 px-4 py-4 active:scale-[0.99] transition-transform dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        style={{ minHeight: 64 }}
      >
        <AlertTriangle className="h-6 w-6" />
        {/* « Découverte » couvre le problème ET l'imprévu (poutre fissurée) —
            le terrain constate, le conducteur qualifie (audit 2026-07-13).
            Ambre = le geste transversal, comme sur la visite. */}
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
