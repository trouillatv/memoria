'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Circle, UserCheck, RotateCcw, Camera, X, Loader2, MoreHorizontal, Pencil, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import {
  closeActionAction,
  reopenActionAction,
  updateActionDetailsAction,
  setActionDueDateAction,
} from '@/app/(dashboard)/actions/actions'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import { cn } from '@/lib/utils'

const STATUS_CLS: Record<string, string> = {
  open:      'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned:   'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done:      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-1 ring-border',
}

export function MobileActionView({ action, siteId, backHref }: { action: ActionFicheData; siteId: string; backHref?: string }) {
  const a = action
  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-3.5 px-4 pb-16 pt-5">
      <Link
        href={backHref ?? `/m/site/${siteId}`}
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

      {/* Gestes — mêmes primitives que la fiche desktop (ActionFicheCta). */}
      <ActionMobileCta action={a} />

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

// ── Gestes — mêmes primitives que ActionFicheCta (desktop), portées ici pour
// que la fiche mobile ne soit plus lecture seule (audit convergence Actions). ──
function ActionMobileCta({ action }: { action: ActionFicheData }) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [reopening, startReopen] = useTransition()

  if (action.status === 'cancelled') return null

  if (action.status === 'done') {
    return (
      <button
        type="button"
        onClick={() =>
          startReopen(async () => {
            const fd = new FormData()
            fd.set('id', action.id)
            fd.set('site_id', action.siteId)
            const r = await reopenActionAction(fd)
            if (r.ok) { toast.success('Action rouverte'); router.refresh() }
            else toast.error(r.error)
          })
        }
        disabled={reopening}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-semibold text-muted-foreground disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Rouvrir cette action
      </button>
    )
  }

  if (closing) {
    return <MobileCloseForm action={action} onCancel={() => setClosing(false)} onDone={() => { setClosing(false); router.refresh() }} />
  }
  if (editing) {
    return <MobileDetailsForm action={action} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); router.refresh() }} />
  }
  if (planning) {
    return <MobileDueDateForm action={action} onCancel={() => setPlanning(false)} onDone={() => { setPlanning(false); router.refresh() }} />
  }

  const editable = action.status === 'open' || action.status === 'planned'

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setClosing(true)}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-emerald-600 bg-emerald-600 px-3 py-2.5 text-[13px] font-semibold text-white active:scale-[0.98] transition-transform"
      >
        <Check className="h-4 w-4" />Clôturer
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Plus d'actions"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-muted-foreground active:scale-95"
            />
          }
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </DropdownMenuItem>
          {editable && (
            <DropdownMenuItem onClick={() => setPlanning(true)}>
              <CalendarClock className="h-3.5 w-3.5" /> {action.dueDate ? 'Replanifier' : 'Planifier une échéance'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MobileCloseForm({ action, onCancel, onDone }: { action: ActionFicheData; onCancel: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) { toast.error('Ajoute un commentaire de clôture.'); return }
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', action.siteId); fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Action traitée'); onDone() }
    })
  }

  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5 space-y-2.5">
      <p className="text-[13px] font-semibold">Comment sais-tu qu&apos;elle est terminée&nbsp;?</p>
      <textarea
        value={comment} onChange={(e) => setComment(e.target.value)} rows={3} autoFocus maxLength={1000}
        placeholder="Ex : joints repris et vérifiés — plus rien à suivre."
        className="w-full rounded-lg border bg-background px-2.5 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-[12.5px] text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
        <Camera className="h-4 w-4" />{photoName ? 'Photo ajoutée' : 'Ajouter une photo (facultatif)'}
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} disabled={pending}
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-[13px] font-medium text-muted-foreground active:scale-[0.98] transition-transform">
          <span className="inline-flex items-center gap-1.5"><X className="h-4 w-4" />Annuler</span>
        </button>
        <button type="button" onClick={submit} disabled={pending || !comment.trim()}
          className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 active:scale-[0.98] transition-transform">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirmer
        </button>
      </div>
    </div>
  )
}

function MobileDetailsForm({ action, onCancel, onDone }: { action: ActionFicheData; onCancel: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(action.title)
  const [body, setBody] = useState(action.body ?? '')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!title.trim()) { toast.error('Le titre est requis.'); return }
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', action.siteId); fd.set('title', title.trim()); fd.set('body', body)
    startTransition(async () => {
      const r = await updateActionDetailsAction(fd)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Action modifiée'); onDone() }
    })
  }

  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5 space-y-2.5">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus
        placeholder="Titre"
        className="w-full rounded-lg border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000}
        placeholder="Description (optionnel)"
        className="w-full rounded-lg border bg-background px-2.5 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} disabled={pending}
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-[13px] font-medium text-muted-foreground active:scale-[0.98] transition-transform">
          <span className="inline-flex items-center gap-1.5"><X className="h-4 w-4" />Annuler</span>
        </button>
        <button type="button" onClick={submit} disabled={pending || !title.trim()}
          className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[13px] font-semibold text-background disabled:opacity-50 active:scale-[0.98] transition-transform">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Enregistrer
        </button>
      </div>
    </div>
  )
}

function MobileDueDateForm({ action, onCancel, onDone }: { action: ActionFicheData; onCancel: () => void; onDone: () => void }) {
  const [value, setValue] = useState(action.dueDate ? action.dueDate.slice(0, 10) : '')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!value) { toast.error('Choisis une date.'); return }
    const fd = new FormData()
    fd.set('id', action.id); fd.set('site_id', action.siteId); fd.set('due_date', value)
    startTransition(async () => {
      const r = await setActionDueDateAction(fd)
      if (!r.ok) toast.error(r.error)
      else { toast.success('Échéance mise à jour'); onDone() }
    })
  }

  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-2.5 space-y-2.5">
      <input
        type="date" value={value} onChange={(e) => setValue(e.target.value)} autoFocus
        className="w-full rounded-lg border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} disabled={pending}
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-[13px] font-medium text-muted-foreground active:scale-[0.98] transition-transform">
          <span className="inline-flex items-center gap-1.5"><X className="h-4 w-4" />Annuler</span>
        </button>
        <button type="button" onClick={submit} disabled={pending || !value}
          className="inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[13px] font-semibold text-background disabled:opacity-50 active:scale-[0.98] transition-transform">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Enregistrer
        </button>
      </div>
    </div>
  )
}
