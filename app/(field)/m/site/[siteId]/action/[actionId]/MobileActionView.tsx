import Link from 'next/link'
import { ArrowLeft, Check, Circle, UserCheck } from 'lucide-react'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import { cn } from '@/lib/utils'

const STATUS_CLS: Record<string, string> = {
  open:      'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned:   'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done:      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-1 ring-border',
}

export function MobileActionView({ action, siteId }: { action: ActionFicheData; siteId: string }) {
  const a = action
  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3.5 px-4 pb-16 pt-5">
      <Link
        href={`/m/site/${siteId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {a.siteName}
      </Link>

      {/* En-tête */}
      <div>
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium', STATUS_CLS[a.status] ?? STATUS_CLS.open)}>
          {a.statusLabel}
        </span>
        <h1 className="mt-2 text-lg font-semibold leading-snug">{a.title}</h1>
        {a.body && (
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{a.body}</p>
        )}
      </div>

      {/* Responsable + échéance */}
      {(a.responsible || a.dueDate) && (
        <div className="rounded-xl border bg-card px-3 py-2.5 space-y-1.5">
          {a.responsible && (
            <div className="flex items-center gap-2 text-[13px]">
              <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {a.responsible.kind === 'contact' ? a.responsible.name : a.responsible.label}
                {a.responsible.kind === 'contact' && a.responsible.fonction && (
                  <span className="ml-1 text-muted-foreground">· {a.responsible.fonction}</span>
                )}
              </span>
            </div>
          )}
          {a.dueDate && (
            <p className={cn('text-[12px]', a.isLate ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
              {a.isLate ? 'En retard · ' : ''}Échéance : {a.dueDate}
            </p>
          )}
        </div>
      )}

      {/* Origine / provenance */}
      {a.source && (
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Origine</p>
          <p className="text-[13px] font-medium">{a.source.typeLabel}</p>
          {a.source.title && <p className="text-[12px] text-muted-foreground">{a.source.title}</p>}
          {a.source.detail && <p className="text-[12px] text-muted-foreground">{a.source.detail}</p>}
          {a.source.available && a.source.href ? (
            <Link
              href={a.source.href}
              className="mt-1.5 inline-flex text-[12px] text-primary underline underline-offset-2"
            >
              {a.source.linkLabel}
            </Link>
          ) : !a.source.available ? (
            <p className="mt-1 text-[11px] italic text-muted-foreground">Origine indisponible</p>
          ) : null}
        </div>
      )}

      {/* Contexte secondaire */}
      {a.context && (
        <div className="rounded-xl border bg-muted/30 px-3 py-2">
          <p className="text-[12px] text-muted-foreground">{a.context.label}</p>
        </div>
      )}

      {/* Décision associée */}
      {a.fromDecision && (
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Découle de la décision</p>
          <Link href={a.fromDecision.href} className="text-[13px] text-primary underline underline-offset-2">
            {a.fromDecision.title}
          </Link>
        </div>
      )}

      {/* Ce qui a été observé (source_capture) */}
      {a.observed?.text && (
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ce qui a été observé</p>
          <p className="text-[13px] leading-relaxed">{a.observed.text}</p>
          {a.observed.authorLabel && (
            <p className="mt-1 text-[11px] text-muted-foreground">{a.observed.authorLabel}</p>
          )}
        </div>
      )}

      {/* Avancement */}
      {a.progress.length > 0 && (
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Avancement</p>
          <ul className="space-y-1.5">
            {a.progress.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                {p.done
                  ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className={p.done ? 'text-muted-foreground line-through' : ''}>{p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preuves de clôture */}
      {a.proofs && !a.proofs.empty && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            {a.proofs.scope === 'current' ? 'Clôturé' : 'Ancienne clôture'}
            {a.proofs.dateLabel ? ` · ${a.proofs.dateLabel}` : ''}
          </p>
          {a.proofs.comment && (
            <p className="text-[12px] leading-relaxed">{a.proofs.comment}</p>
          )}
        </div>
      )}

      {/* Historique */}
      {a.historyDays.length > 0 && (
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Historique</p>
          <ul className="space-y-3">
            {a.historyDays.map((day) => (
              <li key={day.dayIso}>
                <p className="mb-1 text-[11px] text-muted-foreground">{day.dayLabel}</p>
                <ul className="space-y-1.5 pl-2 border-l border-border">
                  {day.items.map((e) => (
                    <li key={e.id} className="text-[12px]">
                      <span className="font-medium">{e.line}</span>
                      {e.actorLabel && <span className="text-muted-foreground"> · {e.actorLabel}</span>}
                      {e.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{e.detail}</p>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {a.historyNote && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">{a.historyNote}</p>
          )}
        </div>
      )}
    </div>
  )
}
