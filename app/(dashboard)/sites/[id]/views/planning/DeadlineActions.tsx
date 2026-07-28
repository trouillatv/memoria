'use client'

// ── FIN DE VIE D'UNE ÉCHÉANCE VALIDÉE — menu d'actions ───────────────────────
// Sur chaque échéance ACTIVE : la réaliser, la replanifier, ou l'annuler (avec
// motif obligatoire). L'annulation n'efface rien — elle mémorise qui/quand/
// pourquoi, et le lien vers l'échéance de remplacement le cas échéant.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Check, CalendarClock, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { completeDeadlineAction, rescheduleDeadlineAction, cancelDeadlineAction } from './deadline-actions'

// Copie UI des motifs (la source `site-deadlines.ts` est `server-only`, non
// importable côté client — mais les valeurs DOIVENT rester alignées avec l'enum).
const CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: 'abandoned', label: 'Travaux abandonnés' },
  { value: 'superseded', label: 'Remplacée par une autre échéance' },
  { value: 'done_otherwise', label: 'Déjà réalisée autrement' },
  { value: 'bad_extraction', label: 'Mauvaise extraction' },
  { value: 'not_needed', label: 'Plus nécessaire' },
  { value: 'other', label: 'Autre (préciser)' },
]

type Modal = null | 'reschedule' | 'cancel'

export function DeadlineActions({
  deadlineId,
  hasDate,
  currentDueDate,
  otherDeadlines,
}: {
  deadlineId: string
  hasDate: boolean
  currentDueDate: string | null
  otherDeadlines: Array<{ id: string; title: string }>
}) {
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [pending, start] = useTransition()

  // Champs de replanification / annulation.
  const [dueDate, setDueDate] = useState(currentDueDate ?? '')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [replacementId, setReplacementId] = useState('')

  function close() { setModal(null); setReason(''); setComment(''); setReplacementId('') }

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    start(async () => {
      const res = await fn()
      if (res.ok) { toast.success(okMsg, { duration: 1800 }); close(); router.refresh() }
      else toast.error(res.error)
    })
  }

  const complete = () => run(() => completeDeadlineAction(deadlineId), 'Échéance marquée réalisée')
  const reschedule = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { toast.error('Choisissez une date.'); return }
    run(() => rescheduleDeadlineAction({ deadlineId, dueDate }), 'Échéance replanifiée')
  }
  const cancel = () => {
    if (!reason) { toast.error('Choisissez un motif.'); return }
    if (reason === 'other' && !comment.trim()) { toast.error('Précisez le motif.'); return }
    run(
      () => cancelDeadlineAction({
        deadlineId,
        reason: reason as never,
        comment: comment.trim() || undefined,
        replacementId: reason === 'superseded' && replacementId ? replacementId : undefined,
      }),
      'Échéance annulée',
    )
  }

  return (
    <>
      <div className="relative inline-block">
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label="Actions sur l’échéance"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <>
            {/* Fermeture au clic extérieur. */}
            <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border bg-card py-1 shadow-lg">
              <MenuItem icon={Check} onClick={() => { setMenu(false); complete() }}>Marquer comme réalisée</MenuItem>
              <MenuItem icon={CalendarClock} onClick={() => { setMenu(false); setDueDate(currentDueDate ?? ''); setModal('reschedule') }}>
                {hasDate ? 'Replanifier' : 'Planifier'}
              </MenuItem>
              <MenuItem icon={XCircle} danger onClick={() => { setMenu(false); setModal('cancel') }}>Annuler / déclarer sans objet</MenuItem>
            </div>
          </>
        )}
      </div>

      {modal === 'reschedule' && (
        <Overlay onClose={() => !pending && close()} title="Replanifier l’échéance">
          <label className="block text-[13px] font-medium">Nouvelle date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Actions pending={pending} onCancel={close} onConfirm={reschedule} confirmLabel="Replanifier" />
        </Overlay>
      )}

      {modal === 'cancel' && (
        <Overlay onClose={() => !pending && close()} title="Annuler l’échéance">
          <p className="text-[12.5px] text-muted-foreground">
            L’échéance n’est pas supprimée : elle est conservée dans la traçabilité, avec son motif.
          </p>
          <fieldset className="mt-3 space-y-1.5">
            <legend className="text-[13px] font-medium">Motif</legend>
            {CANCEL_REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="cancel-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                {r.label}
              </label>
            ))}
          </fieldset>

          {/* Remplacée → on désigne l'échéance qui prend le relais (lien conservé). */}
          {reason === 'superseded' && otherDeadlines.length > 0 && (
            <div className="mt-3">
              <label className="block text-[13px] font-medium">Échéance de remplacement</label>
              <select
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Aucune (annuler simplement) —</option>
                {otherDeadlines.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          )}

          <div className="mt-3">
            <label className="block text-[13px] font-medium">
              Commentaire {reason === 'other' ? '(obligatoire)' : '(facultatif)'}
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Précision éventuelle…"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Actions pending={pending} onCancel={close} onConfirm={cancel} confirmLabel="Confirmer l’annulation" danger />
        </Overlay>
      )}
    </>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Check; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-muted ${danger ? 'text-red-700 dark:text-red-400' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" /> {children}
    </button>
  )
}

function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t bg-background p-5 shadow-lg sm:max-w-md sm:rounded-2xl sm:border-t-0 sm:border">
        <h2 className="mb-2 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function Actions({ pending, onCancel, onConfirm, confirmLabel, danger }: { pending: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel: string; danger?: boolean }) {
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onCancel} disabled={pending} className="rounded-xl border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
        Fermer
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-foreground text-background hover:bg-foreground/90'}`}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {confirmLabel}
      </button>
    </div>
  )
}
