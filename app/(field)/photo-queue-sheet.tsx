'use client'

/**
 * Slice A.1 — PhotoQueueSheet
 *
 * Drawer (bottom-up sur mobile) qui liste les photos en attente de sync vers
 * le serveur. Déclenchée depuis le SyncIndicator du header field.
 *
 * Doctrine :
 *   - Wording calme, jamais "FAILURE/ERROR/ALERTE".
 *   - Empty state rassurant : "Toutes vos photos sont synchronisées".
 *   - "Vos photos" — pas "qui a pris quoi" (anonymisation).
 *   - Bouton "Re-essayer maintenant" force un drain immédiat.
 *   - Pas de banner rouge, pas de notif push.
 *   - Une photo en queue avec attempts >= 3 affiche "Re-essai dans X" — pas
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
import { ImageIcon, RotateCw, Clock, CheckCircle2, X } from 'lucide-react'
import {
  useQueueEntries,
} from '@/lib/field/sync-status'
import {
  blobToDataUrl,
  isReadyForRetry,
  markAllReadyForRetry,
  nextRetryDelay,
  type QueuedPhoto,
} from '@/lib/field/photo-queue'

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
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.round(hours / 24)
  return `il y a ${days} j`
}

function formatNextRetry(entry: QueuedPhoto, now = Date.now()): string {
  // Sans tentative encore : "En attente"
  if (entry.lastAttemptAt == null) return 'En attente'

  const delay = nextRetryDelay(entry.attempts)
  const elapsed = now - entry.lastAttemptAt
  const remaining = delay - elapsed

  // Sur le point d'être retentée
  if (remaining <= 0) return 'En attente'

  if (remaining < 60_000) {
    const s = Math.max(1, Math.round(remaining / 1000))
    return `Re-essai dans ${s} s`
  }
  if (remaining < 3_600_000) {
    const m = Math.max(1, Math.round(remaining / 60_000))
    return `Re-essai dans ${m} min`
  }
  const h = Math.max(1, Math.round(remaining / 3_600_000))
  return `Re-essai dans ${h} h`
}

const KIND_LABELS: Record<QueuedPhoto['kind'], string> = {
  before: 'Avant',
  after: 'Après',
  anomaly: 'Anomalie',
  proof: 'Preuve',
  passage: 'Passage', // V5.1 Slice 1 — trace libre déposée hors workflow planifié
}

function QueueRow({ entry }: { entry: QueuedPhoto }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    blobToDataUrl(entry.blob)
      .then((url) => {
        if (!cancelled) setThumbUrl(url)
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [entry.blob])

  const status = formatNextRetry(entry)
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
          Photo {KIND_LABELS[entry.kind].toLowerCase()}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <Clock className="w-3 h-3" aria-hidden />
          <span>capturée {ago}</span>
        </div>
      </div>
      <div className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
        {status}
      </div>
    </li>
  )
}

export function PhotoQueueSheet({
  trigger,
  onRetryNow,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { entries, refresh } = useQueueEntries()
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
        await markAllReadyForRetry()
        await refresh()
        onRetryNow?.()
      } catch (e) {
        console.error('[PhotoQueueSheet] retry', e)
      }
    })
  }, [onRetryNow, refresh])

  const empty = entries.length === 0
  const readyCount = useMemo(
    () => entries.filter((e) => isReadyForRetry(e)).length,
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
          <DrawerTitle>Mes photos en attente</DrawerTitle>
          <DrawerDescription>
            {empty
              ? 'Tout est à jour sur le serveur.'
              : 'Vos photos sont en sécurité sur cet appareil. Elles seront envoyées dès que possible.'}
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
                <QueueRow key={entry.tempId} entry={entry} />
              ))}
            </ul>
          )}
        </div>

        <DrawerFooter className="gap-2">
          {!empty && (
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
              {pending
                ? 'Relance en cours…'
                : readyCount === entries.length
                ? 'Re-essayer maintenant'
                : 'Re-essayer maintenant'}
            </Button>
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
