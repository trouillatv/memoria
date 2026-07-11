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
import { ImageIcon, RotateCw, Clock, CheckCircle2, X, Check, Trash2 } from 'lucide-react'
import {
  useQueueEntries,
  type UnifiedQueueEntry,
  type QueueSource,
} from '@/lib/field/sync-status'
import {
  blobToDataUrl,
  isReadyForRetry,
  markAllReadyForRetry,
  nextRetryDelay,
  removeQueuedPhoto,
} from '@/lib/field/photo-queue'
import {
  markAllQueuedVisitCapturesReadyForRetry,
  removeQueuedVisitCapture,
} from '@/lib/field/visit-capture-queue'

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

function formatNextRetry(entry: UnifiedQueueEntry, now = Date.now()): string {
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

function QueueRow({ entry, uploading, onDelete }: { entry: UnifiedQueueEntry; uploading: boolean; onDelete: () => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    // Geste léger (note / vérification / position) : pas de média → icône seule.
    if (!entry.blob) { setThumbUrl(null); return }
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

  // « envoi… » prime sur le compte à rebours : c'est ce qui se passe LÀ.
  const status = uploading ? 'envoi…' : formatNextRetry(entry)
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
          {/* « Photo — Cuisine Petratiti » : le chantier rend la ligne
              immédiatement identifiable sans ouvrir quoi que ce soit. */}
          {entry.kindLabel}
          {entry.siteName ? ` — ${entry.siteName}` : ''}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <Clock className="w-3 h-3" aria-hidden />
          <span>capturée {ago}</span>
        </div>
        {/* En échec répété : montrer le fichier + la cause, pour que l'utilisateur
            sache exactement QUOI n'est pas parti (et quoi renvoyer). */}
        {entry.attempts >= 3 && (
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {entry.filename ? `${entry.filename} · ` : ''}
            {entry.attempts} tentatives
            {entry.lastError ? ` · ${entry.lastError}` : ''}
          </div>
        )}
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
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Supprimer cette photo"
            data-testid="photo-queue-delete"
            className="p-1 text-muted-foreground hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
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
  const { entries, activity, refresh } = useQueueEntries()
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
        // Relancer les DEUX files : photos (intervention/spontané) ET captures
        // de visite. Sinon le bouton ne débloquerait qu'une moitié de la file.
        await Promise.all([
          markAllReadyForRetry(),
          markAllQueuedVisitCapturesReadyForRetry(),
        ])
        await refresh()
        onRetryNow?.()
      } catch (e) {
        console.error('[PhotoQueueSheet] retry', e)
      }
    })
  }, [onRetryNow, refresh])

  // Abandon manuel d'une capture (filet de sécurité pour une entry qui ne
  // partira jamais — ex. cause structurelle). Destructif : la capture est
  // perdue, d'où la confirmation 2 temps côté ligne. La file ne supprime JAMAIS
  // d'elle-même. On route vers la bonne file selon la source de l'entry.
  const handleDelete = useCallback((source: QueueSource, tempId: string) => {
    startTransition(async () => {
      try {
        if (source === 'visit') await removeQueuedVisitCapture(tempId)
        else await removeQueuedPhoto(tempId)
        await refresh()
      } catch (e) {
        console.error('[PhotoQueueSheet] delete', e)
      }
    })
  }, [refresh])

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
          {/* Aucun mot de développeur ici : l'utilisateur ne « regarde pas la
              synchronisation », il vérifie que ses photos sont bien arrivées. */}
          <DrawerTitle>{empty ? 'Tout est arrivé' : 'En route'}</DrawerTitle>
          <DrawerDescription>
            {empty
              ? 'Vos captures sont à l’abri dans la mémoire du chantier.'
              : `${entries.length} élément${entries.length > 1 ? 's' : ''} — à l’abri sur ce téléphone, ils partent dès que possible.`}
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
                Tout est arrivé.
              </p>
              <p className="text-xs text-muted-foreground">
                À l&apos;abri dans la mémoire du chantier.
              </p>
            </div>
          ) : (
            <ul className="divide-y" data-testid="photo-queue-list">
              {entries.map((entry) => (
                <QueueRow
                  key={entry.tempId}
                  entry={entry}
                  uploading={activity.uploadingKey === entry.tempId}
                  onDelete={() => handleDelete(entry.source, entry.tempId)}
                />
              ))}
            </ul>
          )}

          {/* Ce qui vient de PARTIR — la file raconte, elle ne fait pas que compter.
              Éphémère (45 s) : juste le temps de voir que ça marche. */}
          {activity.recentlySent.length > 0 && (
            <div className="border-t px-4 py-2.5">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Bien arrivé
              </p>
              <ul className="space-y-1">
                {activity.recentlySent.map((r, i) => (
                  <li key={i} data-testid="recently-sent-row" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                    {/* « Photo arrivée » — un fait accompli, pas un état à interpréter. */}
                    <span className="truncate">
                      {r.kindLabel} {r.kindLabel === 'Vocal' ? 'arrivé' : 'arrivée'}
                      {r.siteName ? ` — ${r.siteName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
