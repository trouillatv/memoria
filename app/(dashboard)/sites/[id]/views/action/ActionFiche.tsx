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
import { todayLocalIso } from '@/lib/time/local-date'
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
            {/* Uniquement les faits réellement journalisés (site_action_events),
                dans l'ordre. Jamais complété par déduction depuis l'état courant. */}
            <div className="mt-1.5 space-y-3">
              {a.historyDays.map((day) => (
                <div key={day.dayIso}>
                  <p className="text-[11.5px] font-medium text-muted-foreground">{day.dayLabel}</p>
                  <ul className="mt-1 space-y-1.5">
                    {day.items.map((it) => {
                      const actor = it.actorLabel
                        ? `Par ${it.actorLabel}`
                        : it.actorFallback === 'auto'
                          ? 'Automatique'
                          : it.actorFallback === 'unknown'
                            ? 'Auteur indisponible'
                            : null
                      return (
                        <li key={it.id} className="flex gap-2.5 text-[13px]">
                          <span className="w-9 shrink-0 tabular-nums text-muted-foreground">{it.time}</span>
                          <div className="min-w-0">
                            <span className="font-medium">{it.line}</span>
                            {it.detail && <div className="text-[12.5px] text-muted-foreground">{it.detail}</div>}
                            {actor && <div className="text-[12px] text-muted-foreground/80">{actor}</div>}
                            {it.reason && <div className="text-[12.5px] text-muted-foreground">Motif : {it.reason}</div>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {a.historyNote && <p className="mt-2 text-[12px] italic text-muted-foreground">{a.historyNote}</p>}
          </section>

          {a.source && (
            <section>
              <h4 className={H4}>Origine</h4>
              {a.source.available ? (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[12px] font-medium text-muted-foreground">{a.source.typeLabel}</p>
                  <p className="text-[13.5px] font-medium">{a.source.title}</p>
                  {a.source.detail && <p className="text-[12px] text-muted-foreground">{a.source.detail}</p>}
                  {a.source.href && (
                    <Link href={a.source.href} className="inline-flex items-center gap-0.5 pt-0.5 text-[13px] font-medium text-primary hover:underline">
                      {a.source.linkLabel} <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ) : (
                // Une relation existait mais l'objet a disparu — jamais masqué.
                <p className="mt-1 text-[13px] text-muted-foreground">Origine indisponible</p>
              )}
              {a.context && (
                <div className="mt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Contexte</p>
                  {a.context.href ? (
                    <Link href={a.context.href} className="text-[13px] text-primary hover:underline">{a.context.label}</Link>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">{a.context.label}</p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
