'use client'

// ── LA FICHE ACTION — Slice 8 + P0-1B : administrer l'action depuis la fiche ──
// Ce fichier est le LIEU d'écriture de la fiche Action : clôturer/rouvrir
// (Slice 8), et depuis P0-1B modifier titre/description et administrer
// l'échéance (confirmer/planifier/replanifier). Réutilise STRICTEMENT les
// Server Actions de app/(dashboard)/actions/actions.ts (mêmes primitives que
// OpenActionsList/le hub Actions) — aucun nouveau chemin d'écriture. La frise
// « État de l'action » (ActionFiche.tsx) reste, elle, un affichage dérivé pur.
// router.refresh() après mutation : la fiche (panel ou page directe) relit
// getSiteActionFiche à jour, sans bouton « régénérer ».

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RotateCcw, Camera, X, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  closeActionAction,
  reopenActionAction,
  updateActionDetailsAction,
  confirmActionDueDateAction,
  setActionDueDateAction,
} from '@/app/(dashboard)/actions/actions'
import type { SiteActionStatus } from '@/types/db'

export function ActionFicheCta({
  actionId,
  siteId,
  status,
}: {
  actionId: string
  siteId: string
  status: SiteActionStatus
}) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [reopening, startReopen] = useTransition()

  if (status === 'done') {
    return (
      <button
        type="button"
        onClick={() =>
          startReopen(async () => {
            const fd = new FormData()
            fd.set('id', actionId)
            fd.set('site_id', siteId)
            const r = await reopenActionAction(fd)
            if (r.ok) {
              toast.success('Action rouverte')
              router.refresh()
            } else {
              toast.error(r.error)
            }
          })
        }
        disabled={reopening}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
      >
        {reopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Rouvrir cette action
      </button>
    )
  }

  if (status === 'cancelled') return null

  if (!closing) {
    return (
      <button
        type="button"
        onClick={() => setClosing(true)}
        className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.98]"
      >
        <Check className="h-3.5 w-3.5" />Marquer comme définitivement traitée
      </button>
    )
  }

  return <CloseForm actionId={actionId} siteId={siteId} onCancel={() => setClosing(false)} onDone={() => { setClosing(false); router.refresh() }} />
}

function CloseForm({
  actionId,
  siteId,
  onCancel,
  onDone,
}: {
  actionId: string
  siteId: string
  onCancel: () => void
  onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) {
      toast.error('Ajoutez un commentaire de clôture.')
      return
    }
    const fd = new FormData()
    fd.set('id', actionId)
    fd.set('site_id', siteId)
    fd.set('comment', comment.trim())
    const f = fileRef.current?.files?.[0]
    if (f) fd.set('file', f)
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Action traitée')
        onDone()
      }
    })
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground/80">Cette action est-elle complètement traitée&nbsp;?</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        autoFocus
        maxLength={1000}
        placeholder="Ex : joints repris et vérifiés — plus rien à suivre."
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-3.5 w-3.5" />
          {photoName ? 'Photo ajoutée' : 'Photo (optionnel)'}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)} />
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />Annuler
          </button>
          <button type="button" onClick={submit} disabled={pending || !comment.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98]">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Définitivement traitée
          </button>
        </div>
      </div>
    </div>
  )
}

// ── P0-1B — Modifier titre / description ─────────────────────────────────────
// Geste toujours disponible (même sur une action clôturée : corriger un titre
// n'est pas une réouverture métier), contrairement aux gestes d'échéance.
export function ActionFicheDetailsCta({
  actionId,
  siteId,
  title,
  body,
}: {
  actionId: string
  siteId: string
  title: string
  body: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        <Pencil className="h-3 w-3" />Modifier le titre ou la description
      </button>
    )
  }

  return (
    <DetailsForm
      actionId={actionId}
      siteId={siteId}
      initialTitle={title}
      initialBody={body}
      onCancel={() => setEditing(false)}
      onDone={() => { setEditing(false); router.refresh() }}
    />
  )
}

function DetailsForm({
  actionId,
  siteId,
  initialTitle,
  initialBody,
  onCancel,
  onDone,
}: {
  actionId: string
  siteId: string
  initialTitle: string
  initialBody: string | null
  onCancel: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody ?? '')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!title.trim()) {
      toast.error('Le titre est requis.')
      return
    }
    const fd = new FormData()
    fd.set('id', actionId)
    fd.set('site_id', siteId)
    fd.set('title', title.trim())
    fd.set('body', body)
    startTransition(async () => {
      const r = await updateActionDetailsAction(fd)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Action modifiée')
        onDone()
      }
    })
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        autoFocus
        placeholder="Titre"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Description (optionnel)"
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || !title.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98]">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Enregistrer
        </button>
      </div>
    </div>
  )
}

// ── P0-1B — Confirmer / planifier / replanifier l'échéance ───────────────────
// Gestes d'échéance actifs uniquement sur une action vivante (open/planned) :
// une action clôturée fige son échéance comme le reste de son état — la
// réouvrir (ActionFicheCta) est le chemin pour la corriger.
export function ActionFicheDueDateCta({
  actionId,
  siteId,
  status,
  dueDate,
  dueDateStatus,
  label,
  isLate,
}: {
  actionId: string
  siteId: string
  status: SiteActionStatus
  dueDate: string | null
  dueDateStatus: 'explicit' | 'estimated' | null
  label: string | null
  isLate: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirming, startConfirm] = useTransition()

  // Repli honnête : une échéance existe mais son statut ne produit pas de
  // libellé fort (describeAssignedActionDate — cas résiduel, jamais un silence
  // qui la fait paraître absente alors qu'une date est enregistrée).
  const displayLabel = label ?? (dueDate ? `Date envisagée le ${dueDate} · à confirmer` : null)
  const confirmed = dueDateStatus === 'explicit'
  const editable = status === 'open' || status === 'planned'

  if (editing) {
    return (
      <DueDateForm
        actionId={actionId}
        siteId={siteId}
        initial={dueDate}
        onCancel={() => setEditing(false)}
        onDone={() => { setEditing(false); router.refresh() }}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {displayLabel
        ? <p className={cn('text-[13.5px]', isLate && 'text-rose-600 dark:text-rose-400')}>{displayLabel}</p>
        : <p className="text-[13px] text-muted-foreground">Aucune échéance.</p>}
      {editable && dueDate && !confirmed && (
        <button
          type="button"
          disabled={confirming}
          onClick={() =>
            startConfirm(async () => {
              const fd = new FormData()
              fd.set('id', actionId)
              fd.set('site_id', siteId)
              const r = await confirmActionDueDateAction(fd)
              if (r.ok) {
                toast.success('Échéance confirmée')
                router.refresh()
              } else {
                toast.error(r.error)
              }
            })
          }
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Confirmer
        </button>
      )}
      {editable && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />{dueDate ? 'Replanifier' : 'Planifier une échéance'}
        </button>
      )}
    </div>
  )
}

function DueDateForm({
  actionId,
  siteId,
  initial,
  onCancel,
  onDone,
}: {
  actionId: string
  siteId: string
  initial: string | null
  onCancel: () => void
  onDone: () => void
}) {
  const [value, setValue] = useState(initial ?? '')
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!value) {
      toast.error('Choisissez une date.')
      return
    }
    const fd = new FormData()
    fd.set('id', actionId)
    fd.set('site_id', siteId)
    fd.set('due_date', value)
    startTransition(async () => {
      const r = await setActionDueDateAction(fd)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Échéance mise à jour')
        onDone()
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className="rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button type="button" onClick={submit} disabled={pending || !value}
        className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 text-white px-2.5 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98]">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Enregistrer
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />Annuler
      </button>
    </div>
  )
}
