'use client'

// ── LA FICHE ACTION — lecture canonique d'une action (Lot 4 · Slice 3) ───────
// Comme la fiche Intervenant : un Sheet latéral, présentationnel pur, alimenté
// par un read model unique (getSiteActionFiche). On y LIT une action en entier :
// responsable identifié (preuve structurelle), échéance/retard, statut, source,
// historique minimal. Aucune écriture ici (clôture = Slice 8).

import Link from 'next/link'
import { ChevronRight, UserCheck } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { frDayMonthLocal, todayLocalIso } from '@/lib/time/local-date'
import { describeAssignedActionDate } from '@/lib/knowledge/assigned-actions'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import type { SiteActionStatus } from '@/types/db'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

const STATUS_CLS: Record<SiteActionStatus, string> = {
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-border',
}

export function ActionFicheSheet({ action, onClose }: { action: ActionFicheData | null; onClose: () => void }) {
  if (!action) return null
  const a = action
  const date = describeAssignedActionDate(
    { dueDate: a.dueDate, dueDateStatus: a.dueDateStatus, isLate: a.isLate },
    todayLocalIso(),
  )

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-0">
          <span className={cn('w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_CLS[a.status])}>
            {a.statusLabel}
          </span>
          <SheetTitle className="text-base font-semibold leading-snug">{a.title}</SheetTitle>
          {a.corpsEtat && <p className="text-[13px] text-muted-foreground">{a.corpsEtat}</p>}
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {a.body && <p className="text-[13.5px]">{a.body}</p>}

          <section>
            <h4 className={H4}>Responsable</h4>
            {a.responsible?.kind === 'contact' ? (
              <p className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-medium text-emerald-700 dark:text-emerald-400">
                <UserCheck className="h-3.5 w-3.5" />
                {a.responsible.name}{a.responsible.fonction ? ` · ${a.responsible.fonction}` : ''}
              </p>
            ) : a.responsible?.kind === 'text' ? (
              // Trace texte historique — jamais présentée comme une personne.
              <p className="mt-1 text-[13px] text-muted-foreground">Responsable (ancien suivi) : {a.responsible.label}</p>
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground">Aucun responsable identifié.</p>
            )}
          </section>

          {date.label && (
            <section>
              <h4 className={H4}>Échéance</h4>
              <p className={cn('mt-1 text-[13.5px]', date.kind === 'late' && 'text-rose-600 dark:text-rose-400')}>
                {date.label}
              </p>
            </section>
          )}

          <section>
            <h4 className={H4}>Historique</h4>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              <li><span className="text-muted-foreground">Créée</span> · {frDayMonthLocal(a.createdAt)}</li>
              {a.doneAt && <li><span className="text-muted-foreground">Terminée</span> · {frDayMonthLocal(a.doneAt)}</li>}
            </ul>
          </section>

          {a.source && (
            <Link
              href={a.source.href}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-muted"
            >
              {a.source.label} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
