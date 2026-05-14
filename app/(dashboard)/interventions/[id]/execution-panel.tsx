'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, Play, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  startInterventionAction,
  completeInterventionAction,
  toggleChecklistItemAction,
  uploadInterventionPhotoAction,
} from './intervention-actions'
import type { DbIntervention, DbInterventionChecklistItem, DbInterventionPhoto, PhotoKind } from '@/types/db'

const KIND_LABELS: Record<PhotoKind, string> = {
  before: 'Avant',
  after: 'Après',
  anomaly: 'Anomalie',
  proof: 'Preuve',
  passage: 'Passage', // V5.1 Slice 1 — trace libre hors workflow planifié
}

const KIND_COLORS: Record<PhotoKind, string> = {
  before: 'bg-slate-50 border-slate-200 text-slate-700',
  after: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  anomaly: 'bg-amber-50 border-amber-200 text-amber-700',
  proof: 'bg-sky-50 border-sky-200 text-sky-700',
  passage: 'bg-slate-50 border-slate-200 text-slate-600', // V5.1 — couleur sobre (grammaire descriptive)
}

interface Props {
  intervention: DbIntervention
  checklistItems: DbInterventionChecklistItem[]
  photos: DbInterventionPhoto[]
  signedUrls: Record<string, string>
}

export function ExecutionPanel({ intervention, checklistItems, photos, signedUrls }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [uploadingForItem, setUploadingForItem] = useState<string | 'free' | null>(null)
  const [uploadKind, setUploadKind] = useState<PhotoKind>('after')
  const fileRef = useRef<HTMLInputElement>(null)

  const canExecute = intervention.status === 'in_progress'
  const canStart = intervention.status === 'planned'
  const canComplete = intervention.status === 'in_progress'

  const photosByItem = new Map<string, DbInterventionPhoto[]>()
  const freePhotos: DbInterventionPhoto[] = []
  for (const p of photos) {
    if (p.checklist_item_id) {
      const list = photosByItem.get(p.checklist_item_id) ?? []
      list.push(p)
      photosByItem.set(p.checklist_item_id, list)
    } else {
      freePhotos.push(p)
    }
  }

  function handleStart() {
    const fd = new FormData()
    fd.set('id', intervention.id)
    startTransition(async () => {
      const r = await startInterventionAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Intervention démarrée'); router.refresh() }
    })
  }

  function handleComplete() {
    const fd = new FormData()
    fd.set('id', intervention.id)
    startTransition(async () => {
      const r = await completeInterventionAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Intervention terminée'); router.refresh() }
    })
  }

  function handleToggleItem(itemId: string, currentDone: boolean) {
    const fd = new FormData()
    fd.set('id', itemId)
    fd.set('done', (!currentDone).toString())
    startTransition(async () => {
      const r = await toggleChecklistItemAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else router.refresh()
    })
  }

  function openFilePicker(itemId: string | 'free', kind: PhotoKind) {
    setUploadingForItem(itemId)
    setUploadKind(kind)
    setTimeout(() => fileRef.current?.click(), 50)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset
    if (!file || !uploadingForItem) return

    const fd = new FormData()
    fd.set('intervention_id', intervention.id)
    fd.set('checklist_item_id', uploadingForItem === 'free' ? '' : uploadingForItem)
    fd.set('kind', uploadKind)
    fd.set('file', file)

    startTransition(async () => {
      const r = await uploadInterventionPhotoAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Photo ajoutée'); router.refresh() }
      setUploadingForItem(null)
    })
  }

  return (
    <>
      {/* Status actions */}
      {canStart && (
        <section className="rounded-lg border bg-card p-4">
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border bg-foreground text-background text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {pending ? 'Démarrage...' : "Démarrer l'intervention"}
          </button>
          <p className="text-[11px] text-muted-foreground mt-2">
            Une fois démarrée, vous pourrez cocher les tâches et ajouter des photos preuves.
          </p>
        </section>
      )}

      {/* Checklist */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Checklist ({checklistItems.length})
          </h2>
          {canExecute && (
            <button
              type="button"
              onClick={() => openFilePicker('free', 'proof')}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-muted/50 disabled:opacity-50"
            >
              <Camera className="h-3 w-3" /> Photo libre
            </button>
          )}
        </div>

        {checklistItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune tâche pour cette intervention.</p>
        ) : (
          <ul className="space-y-1.5">
            {checklistItems.map((item) => {
              const itemPhotos = photosByItem.get(item.id) ?? []
              return (
                <li key={item.id} className="rounded border bg-background p-2.5">
                  <div className="flex items-start gap-2">
                    {canExecute ? (
                      <button
                        type="button"
                        onClick={() => handleToggleItem(item.id, item.done)}
                        disabled={pending}
                        aria-label={item.done ? 'Décocher' : 'Cocher'}
                        className={`shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center transition-colors ${item.done ? 'bg-emerald-500 border-emerald-600' : 'bg-card border-border hover:border-foreground/40'}`}
                      >
                        {item.done && <Check className="h-3 w-3 text-background" />}
                      </button>
                    ) : (
                      <span className={`shrink-0 w-5 h-5 rounded border mt-0.5 flex items-center justify-center ${item.done ? 'bg-emerald-500 border-emerald-600' : 'bg-card border-border'}`} aria-hidden>
                        {item.done && <Check className="h-3 w-3 text-background" />}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${item.done ? 'line-through text-muted-foreground' : ''}`}>
                        {item.label}
                        {item.required && <span className="ml-1 text-rose-500">*</span>}
                      </div>
                      {item.done && item.done_at && (
                        <div className="text-[10px] text-muted-foreground">
                          ✓ {new Date(item.done_at).toLocaleString('fr-FR')}
                        </div>
                      )}
                      {/* Inline photo thumbs for this item */}
                      {itemPhotos.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {itemPhotos.map((p) => {
                            const url = signedUrls[p.storage_path]
                            return url ? (
                              <a key={p.id} href={url} target="_blank" rel="noopener noreferrer" className="block w-12 h-12 rounded overflow-hidden border bg-muted relative group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={p.kind} className="w-full h-full object-cover" />
                                <span className={`absolute bottom-0 left-0 right-0 text-[8px] uppercase font-semibold px-0.5 py-px ${KIND_COLORS[p.kind]}`}>
                                  {KIND_LABELS[p.kind]}
                                </span>
                              </a>
                            ) : (
                              <span key={p.id} className="block w-12 h-12 rounded border bg-muted/50" />
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {/* Photo capture buttons for this item */}
                    {canExecute && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openFilePicker(item.id, 'before')}
                          disabled={pending}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] hover:bg-muted/50 disabled:opacity-50"
                        >
                          <Camera className="h-2.5 w-2.5" /> Avant
                        </button>
                        <button
                          type="button"
                          onClick={() => openFilePicker(item.id, 'after')}
                          disabled={pending}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] hover:bg-muted/50 disabled:opacity-50"
                        >
                          <Camera className="h-2.5 w-2.5" /> Après
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Free photos gallery */}
      {freePhotos.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Photos libres ({freePhotos.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {freePhotos.map((p) => {
              const url = signedUrls[p.storage_path]
              return url ? (
                <a key={p.id} href={url} target="_blank" rel="noopener noreferrer" className="block relative rounded overflow-hidden border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={p.kind} className="w-full h-32 object-cover" />
                  <span className={`absolute bottom-1 left-1 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${KIND_COLORS[p.kind]}`}>
                    {KIND_LABELS[p.kind]}
                  </span>
                </a>
              ) : (
                <span key={p.id} className="block w-full h-32 rounded border bg-muted/50" />
              )
            })}
          </div>
        </section>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Complete button */}
      {canComplete && (
        <section className="rounded-lg border bg-card p-4">
          <button
            type="button"
            onClick={handleComplete}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {pending ? '...' : "Terminer l'intervention"}
          </button>
          <p className="text-[11px] text-muted-foreground mt-2">
            Toutes les tâches obligatoires (*) doivent être cochées. Vous pourrez ensuite faire valider par un superviseur.
          </p>
        </section>
      )}
    </>
  )
}
