'use client'

/**
 * Slice A.1 — PhotoQueueSheet (élargie Lot B).
 *
 * Drawer (bottom-up sur mobile) qui liste les éléments en attente d'envoi vers
 * le serveur — TOUS canaux confondus : photos d'intervention (file legacy),
 * captures de visite photo/vidéo/vocal (file visite) et vidéos en upload direct.
 * Déclenchée depuis le SyncIndicator du header field.
 *
 * Doctrine :
 *   - Wording calme, jamais "FAILURE/ERROR/ALERTE".
 *   - Empty state rassurant : "Toutes vos photos sont synchronisées".
 *   - "Vos captures" — pas "qui a pris quoi" (anonymisation).
 *   - Bouton "Re-essayer maintenant" force un drain immédiat des files.
 *   - Pas de banner rouge, pas de notif push.
 *   - Une entry avec attempts >= 3 affiche "Re-essai dans X" — pas
 *     "ERREUR" ni "FAILED".
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { ImageIcon, RotateCw, Clock, CheckCircle2, X, Check, Trash2, UploadCloud } from 'lucide-react'
import { useQueueEntries, type PendingEntry } from '@/lib/field/sync-status'
import { blobToDataUrl, isReadyForRetry, nextRetryDelay } from '@/lib/field/photo-queue'

interface Props {
  /** Element déclencheur — typiquement le SyncIndicator wrappé. */
  trigger: React.ReactNode
  /** Callback invoqué après "Re-essayer maintenant" (pour déclencher un drain). */
  onRetryNow?: () => void
  /** Permet de contrôler l'état d'ouverture depuis l'extérieur (tests). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function formatTakenAgo(takenAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - takenAt) / 1000))
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.round(hours / 24)
  return `il y a ${days} j`
}

function formatStatus(entry: PendingEntry, now = Date.now()): string {
  // Upload direct (vidéo) : pas de file, il monte en ce moment même.
  if (entry.source === 'live') return 'Envoi en cours'

  // Sans tentative encore : "En attente"
  if (entry.lastAttemptAt == null) return 'En attente'

  const delay = nextRetryDelay(entry.attempts)
  const elapsed = now - entry.lastAttemptAt
  const remaining = delay - elapsed

  // Sur le point d'être retentée
  if (remaining <= 0) return 'En attente'

  if (remaining < 60_000) {
    const s = Math.max(1, Math.round(remaining / 1000))
    return `Re-essai dans ${s} s`
  }
  if (remaining < 3_600_000) {
    const m = Math.max(1, Math.round(remaining / 60_000))
    return `Re-essai dans ${m} min`
  }
  const h = Math.max(1, Math.round(remaining / 3_600_000))
  return `Re-essai dans ${h} h`
}

function QueueRow({ entry, onDelete }: { entry: PendingEntry; onDelete: () => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(entry.thumbUrl ?? null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    // Upload direct : la vignette est déjà un objectURL prêt à l'emploi.
    if (!entry.thumbBlob) {
      setThumbUrl(entry.thumbUrl ?? null)
      return
    }
    let cancelled = false
    blobToDataUrl(entry.thumbBlob)
      .then((url) => {
        if (!cancelled) setThumbUrl(url)
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [entry.thumbBlob, entry.thumbUrl])

  const status = formatStatus(entry)
  const ago = formatTakenAgo(entry.takenAt)

  return (
    <li
      data-testid="photo-queue-row"
      className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
    >
      <div className="flex-shrink-0 w-12 h-12 rounded-md bg-muted overflow-hidden flex items-center justify-center">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon className="w-5 h-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {entry.label}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <Clock className="w-3 h-3" aria-hidden />
          <span>capturé {ago}</span>
        </div>
      </div>
      {confirming ? (
        <div className="flex flex-shrink-0 items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Supprimer&nbsp;?</span>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Confirmer la suppression"
            data-testid="photo-queue-delete-confirm"
            className="rounded-md border border-rose-300 bg-rose-50 p-1 text-rose-700"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            aria-label="Annuler la suppression"
            className="rounded-md border p-1 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{status}</span>
          {entry.deletable && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label="Supprimer cette capture"
              data-testid="photo-queue-delete"
              className="p-1 text-muted-foreground hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export function PhotoQueueSheet({
  trigger,
  onRetryNow,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { entries, retryAll, remove } = useQueueEntries()
  const [internalOpen, setInternalOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  const handleRetry = useCallback(() => {
    startTransition(async () => {
      try {
        await retryAll()
        onRetryNow?.()
      } catch (e) {
        console.error('[PhotoQueueSheet] retry', e)
      }
    })
  }, [onRetryNow, retryAll])

  // Abandon manuel d'une capture (filet de sécurité pour une entry qui ne partira
  // jamais — ex. cause structurelle). Destructif : la capture est perdue, d'où la
  // confirmation 2 temps côté ligne. La file ne supprime JAMAIS d'elle-même.
  const handleDelete = useCallback(
    (entry: PendingEntry) => {
      startTransition(async () => {
        try {
          await remove(entry)
        } catch (e) {
          console.error('[PhotoQueueSheet] delete', e)
        }
      })
    },
    [remove],
  )

  const empty = entries.length === 0
  // « Re-essayer » n'a de sens que pour les entries en file (pas les uploads directs).
  const hasQueued = useMemo(() => entries.some((e) => e.source !== 'live'), [entries])
  const allReady = useMemo(
    () =>
      entries
        .filter((e) => e.source !== 'live')
        .every((e) => isReadyForRetry(e)),
    [entries],
  )

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        data-vaul-drawer-direction="bottom"
        data-testid="photo-queue-sheet"
      >
        <DrawerHeader>
          <DrawerTitle>Mes éléments en attente</DrawerTitle>
          <DrawerDescription>
            {empty
              ? 'Tout est à jour sur le serveur.'
              : 'Vos captures sont en sécurité sur cet appareil. Elles seront envoyées dès que possible.'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {empty ? (
            <div
              data-testid="photo-queue-empty"
              className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center"
            >
              <CheckCircle2
                className="w-8 h-8 text-emerald-500"
                aria-hidden
              />
              <p className="text-sm font-medium text-foreground">
                Toutes vos photos sont synchronisées
              </p>
              <p className="text-xs text-muted-foreground">
                Rien à envoyer pour le moment.
              </p>
            </div>
          ) : (
            <ul className="divide-y" data-testid="photo-queue-list">
              {entries.map((entry) => (
                <QueueRow
                  key={entry.key}
                  entry={entry}
                  onDelete={() => handleDelete(entry)}
                />
              ))}
            </ul>
          )}
        </div>

        <DrawerFooter className="gap-2">
          {!empty && hasQueued && (
            <Button
              type="button"
              onClick={handleRetry}
              disabled={pending}
              data-testid="photo-queue-retry"
              className="w-full"
              style={{ minHeight: 44 }}
            >
              <RotateCw
                className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`}
                aria-hidden
              />
              {pending ? 'Relance en cours…' : allReady ? 'Re-essayer maintenant' : 'Re-essayer maintenant'}
            </Button>
          )}
          {!empty && !hasQueued && (
            <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
              <UploadCloud className="w-4 h-4" aria-hidden /> Envoi en cours…
            </p>
          )}
          <DrawerClose asChild>
            <Button
              type="button"
              variant="ghost"
              data-testid="photo-queue-close"
              className="w-full"
              style={{ minHeight: 44 }}
            >
              <X className="w-4 h-4" aria-hidden />
              Fermer
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
