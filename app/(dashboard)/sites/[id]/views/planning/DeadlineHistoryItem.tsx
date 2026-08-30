'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { CANCEL_REASON_LABEL, type SiteDeadlineHistory } from '@/lib/db/site-deadlines'
import { WhyButton } from '@/components/provenance/WhyButton'

const historyDateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })

// L'historique ne contient en pratique que done/cancelled/superseded, mais le
// type DeadlineStatus est plus large — repli neutre pour rester exhaustif.
const STATUS_META: Record<SiteDeadlineHistory['status'], { label: string; color: string; dot: string }> = {
  to_plan: { label: 'À planifier', color: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
  planned: { label: 'Planifiée', color: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
  done: { label: 'Réalisée', color: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  cancelled: { label: 'Annulée', color: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  superseded: { label: 'Remplacée', color: 'text-muted-foreground', dot: 'bg-muted-foreground/50' },
}

// Deux niveaux de lecture : une ligne compacte toujours visible (statut +
// motif court) ; le détail (date, acteur, explication, source) n'apparaît
// qu'au clic sur « Pourquoi ? ». Avant ce composant, la ligne compacte ET le
// panneau détaillé s'affichaient tous les deux par défaut — du bruit répété
// sur chaque élément de l'historique.
export function DeadlineHistoryItem({ item: d, siteId }: { item: SiteDeadlineHistory; siteId: string }) {
  const [open, setOpen] = useState(false)
  const when = d.cancelled_at ?? d.completed_at
  const whenLabel = when ? historyDateFmt.format(new Date(when)) : null
  const reasonLabel = d.status === 'cancelled' && d.cancel_reason ? CANCEL_REASON_LABEL[d.cancel_reason] : null
  const hasDetail = Boolean(whenLabel || d.actor_name || d.cancel_comment || d.report_id || (d.status === 'superseded' && d.replacement_title))
  const meta = STATUS_META[d.status]

  return (
    <li className="border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-foreground/80">{d.title}</p>
          <p className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${meta.color}`}>
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
            {meta.label}{reasonLabel ? ` · ${reasonLabel}` : ''}
          </p>
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            Pourquoi ? {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 rounded-xl border bg-muted/20 p-3 text-[12px] text-muted-foreground">
          {whenLabel && <p>{meta.label} le {whenLabel}{d.actor_name ? ` · par ${d.actor_name}` : ''}</p>}
          {d.status === 'superseded' && d.replacement_title && (
            <p>
              Remplacée par{' '}
              <Link
                href={`/sites/${siteId}?tab=planning&plantab=echeances`}
                className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                « {d.replacement_title} »
              </Link>
            </p>
          )}
          {d.cancel_comment && <p className="italic">«&nbsp;{d.cancel_comment}&nbsp;»</p>}
          {d.report_id && <WhyButton objectType="deadline" objectId={d.id} label="Voir la source" />}
        </div>
      )}
    </li>
  )
}
