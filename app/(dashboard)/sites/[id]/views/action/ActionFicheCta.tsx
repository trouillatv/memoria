'use client'

// ── LA FICHE ACTION — Slice 8 minimale : clôturer / rouvrir depuis la fiche ──
// La frise « État de l'action » (ActionFiche.tsx) reste lecture seule ; ce
// composant est le SEUL endroit qui écrit. Réutilise STRICTEMENT
// closeActionAction/reopenActionAction (mêmes Server Actions que
// OpenActionsList) — aucune nouvelle définition de statut, aucun nouveau
// chemin d'écriture. router.refresh() après mutation : la fiche (panel ou
// page directe) relit getSiteActionFiche à jour, sans bouton « régénérer ».

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RotateCcw, Camera, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { closeActionAction, reopenActionAction } from '@/app/(dashboard)/actions/actions'
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
