'use client'

// Une visite terminée dont le TRI reste à faire, sur « Reprendre mon travail ».
// Client (pas seulement un lien) pour pouvoir DISPARAÎTRE tout de suite quand on la
// supprime — sans attendre le rafraîchissement serveur.

import { useState } from 'react'
import Link from 'next/link'
import { ListChecks, ArrowRight } from 'lucide-react'
import { HomeVisitDeleteButton } from './HomeVisitDeleteButton'
import type { PendingTriageItem } from '@/lib/db/visits'

export function PendingTriageRow({ item }: { item: PendingTriageItem }) {
  const [deleted, setDeleted] = useState(false)
  if (deleted) return null

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-amber-300/50 bg-amber-50/50 px-4 py-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
      <Link href={`/m/visite/${item.reportId}`} className="flex min-w-0 flex-1 items-center gap-3 active:opacity-70">
        <ListChecks className="h-5 w-5 shrink-0 text-amber-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{item.siteName}</span>
          <span className="block text-[13px] text-muted-foreground">
            Tri restant : {item.remaining} capture{item.remaining > 1 ? 's' : ''}
          </span>
        </span>
      </Link>
      {/* Supprimer la visite (test / plus utile) sans avoir à la trier. */}
      <HomeVisitDeleteButton reportId={item.reportId} tone="amber" onDeleted={() => setDeleted(true)} />
      <Link
        href={`/m/visite/${item.reportId}`}
        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-amber-700 active:opacity-70 dark:text-amber-300"
      >
        Terminer <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
