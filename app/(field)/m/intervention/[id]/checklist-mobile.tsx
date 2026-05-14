'use client'

import { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { toggleChecklistItemMobileAction } from './actions'
import { PhotoCaptureButton } from './photo-capture-button'
import { usePhotoUploader } from '@/lib/field/use-photo-uploader'
import {
  listQueuedPhotosByIntervention,
  blobToDataUrl,
} from '@/lib/field/photo-queue'
import type { DbInterventionChecklistItem, DbInterventionPhoto } from '@/types/db'

interface Props {
  interventionId: string
  items: DbInterventionChecklistItem[]
  serverPhotos: DbInterventionPhoto[]
  signedUrls: Record<string, string>
  canEdit: boolean
}

interface ThumbForItem {
  key: string
  dataUrl: string | null  // local data URL OR null + use signedUrl
  signedUrl: string | null
  kind: string
  isLocal: boolean        // pending in queue
}

export function ChecklistMobile({
  interventionId,
  items,
  serverPhotos,
  signedUrls,
  canEdit,
}: Props) {
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  // keyed by checklistItemId or 'free'
  const [localPhotos, setLocalPhotos] = useState<Record<string, ThumbForItem[]>>({})
  const { pendingCount } = usePhotoUploader()

  const refreshLocalPhotos = useCallback(async () => {
    try {
      const queued = await listQueuedPhotosByIntervention(interventionId)
      const grouped: Record<string, ThumbForItem[]> = {}
      for (const q of queued) {
        const key = q.checklistItemId ?? 'free'
        const dataUrl = await blobToDataUrl(q.blob)
        if (!grouped[key]) grouped[key] = []
        grouped[key].push({
          key: q.tempId,
          dataUrl,
          signedUrl: null,
          kind: q.kind,
          isLocal: true,
        })
      }
      setLocalPhotos(grouped)
    } catch (e) {
      console.error('[refreshLocalPhotos]', e)
    }
  }, [interventionId])

  useEffect(() => {
    void refreshLocalPhotos()
  }, [refreshLocalPhotos, pendingCount])

  // Group server photos by checklist_item_id (or 'free' for null)
  const serverByItem: Record<string, DbInterventionPhoto[]> = {}
  for (const p of serverPhotos) {
    const key = p.checklist_item_id ?? 'free'
    if (!serverByItem[key]) serverByItem[key] = []
    serverByItem[key].push(p)
  }

  function thumbsForItem(itemKey: string): ThumbForItem[] {
    const fromServer: ThumbForItem[] = (serverByItem[itemKey] ?? []).map((p) => ({
      key: p.id,
      dataUrl: null,
      signedUrl: signedUrls[p.storage_path] ?? null,
      kind: p.kind,
      isLocal: false,
    }))
    const fromLocal = localPhotos[itemKey] ?? []
    return [...fromServer, ...fromLocal]
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-base text-muted-foreground">Aucune tâche pour cette intervention.</p>
      </div>
    )
  }

  function toggle(item: DbInterventionChecklistItem) {
    if (!canEdit) return
    const currentDone = optimistic[item.id] !== undefined ? optimistic[item.id] : item.done
    const newDone = !currentDone
    // Optimistic UI immediat — bascule instantanee cote utilisateur
    setOptimistic((prev) => ({ ...prev, [item.id]: newDone }))

    const fd = new FormData()
    fd.set('id', item.id)
    fd.set('done', newDone.toString())

    // V5.1 fix UX : pas de startTransition + pas de router.refresh().
    // - startTransition marquait l'update comme "non urgent" -> React deferre
    //   le render qui suit, donnant une sensation de lenteur.
    // - router.refresh() re-fetchait toutes les RSC props (500-1000ms sur 4G NC),
    //   bloquant l'UI pendant la sync.
    // Le state optimistic + le toast d'erreur en cas de fail couvrent le besoin.
    void (async () => {
      const r = await toggleChecklistItemMobileAction(fd)
      if (r && 'error' in r && r.error) {
        setOptimistic((prev) => ({ ...prev, [item.id]: !newDone }))
        toast.error(r.error)
      }
    })()
  }

  const doneCount = items.filter((i) => {
    const o = optimistic[i.id]
    return o !== undefined ? o : i.done
  }).length

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Tâches</h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {doneCount} / {items.length}
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isDone = optimistic[item.id] !== undefined ? optimistic[item.id] : item.done
          const thumbs = thumbsForItem(item.id)
          return (
            <li
              key={item.id}
              className={`rounded-xl border p-4 ${
                isDone ? 'bg-emerald-50/40 border-emerald-200' : 'bg-card border-border'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={!canEdit}
                className="w-full flex items-center gap-3 text-left active:bg-muted/50 disabled:opacity-70 -m-1 p-1 rounded-lg"
                style={{ minHeight: 52 }}
              >
                <span
                  className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'bg-card border-foreground/40'
                  }`}
                  aria-hidden
                >
                  {isDone && <Check className="h-5 w-5 text-white" strokeWidth={3} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-base ${
                      isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {item.label}
                  </div>
                </div>
              </button>

              {/* Photo capture buttons + thumbs */}
              {canEdit && (
                <div className="flex items-center gap-2 mt-3 pl-10 flex-wrap">
                  <PhotoCaptureButton
                    interventionId={interventionId}
                    checklistItemId={item.id}
                    kind="before"
                    label="Avant"
                    onPhotoQueued={refreshLocalPhotos}
                  />
                  <PhotoCaptureButton
                    interventionId={interventionId}
                    checklistItemId={item.id}
                    kind="after"
                    label="Après"
                    onPhotoQueued={refreshLocalPhotos}
                  />
                </div>
              )}

              {thumbs.length > 0 && (
                <div className="flex items-center gap-1.5 mt-3 pl-10 flex-wrap">
                  {thumbs.map((t) => (
                    <PhotoThumb key={t.key} thumb={t} />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Free photo button (proof, not tied to a specific item) */}
      {canEdit && (
        <div className="flex flex-col gap-2 mt-4">
          <PhotoCaptureButton
            interventionId={interventionId}
            checklistItemId={null}
            kind="proof"
            label="Photo libre"
            onPhotoQueued={refreshLocalPhotos}
          />
          {thumbsForItem('free').length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {thumbsForItem('free').map((t) => (
                <PhotoThumb key={t.key} thumb={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* V5.1 — retrait du marqueur "* Tâche obligatoire" : pas bloquant en
          pratique (soft-required avec commentaire au moment du Terminer).
          Aligne avec la grammaire descriptive V5.1 : pas d'injonction. */}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  before: 'AVANT',
  after: 'APRÈS',
  anomaly: 'ANOMALIE',
  proof: 'PREUVE',
}

function PhotoThumb({ thumb }: { thumb: ThumbForItem }) {
  const url = thumb.dataUrl ?? thumb.signedUrl
  if (!url) return null
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={thumb.kind}
        className={`w-14 h-14 rounded-lg object-cover border ${
          thumb.isLocal ? 'border-amber-300 opacity-90' : 'border-border'
        }`}
      />
      <span
        className={`absolute bottom-0 left-0 right-0 text-[8px] font-bold tracking-wider px-0.5 py-px text-center text-white ${
          thumb.kind === 'before'
            ? 'bg-slate-700/80'
            : thumb.kind === 'after'
            ? 'bg-emerald-700/80'
            : thumb.kind === 'anomaly'
            ? 'bg-amber-700/80'
            : 'bg-sky-700/80'
        }`}
      >
        {KIND_LABEL[thumb.kind] ?? thumb.kind.toUpperCase()}
      </span>
    </div>
  )
}
