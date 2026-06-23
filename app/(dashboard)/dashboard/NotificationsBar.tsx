'use client'

// Bandeau « Notifications » au chargement (socle mig 159, Vincent 2026-06-23).
//
// L'utilisateur ouvre MemorIA tous les jours → on surface l'info ICI plutôt que
// d'attendre qu'il ouvre une inbox. Sobre & repliable (doctrine collapse
// éditorial) : n'apparaît que s'il y a du non-lu, chaque carte se retire au clic.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { MessageSquare, Bell, X, ArrowRight } from 'lucide-react'
import type { UserNotification, NotificationType } from '@/lib/db/notifications'
import { dismissNotificationAction } from './notifications-actions'

const TYPE_META: Record<NotificationType, { icon: React.ComponentType<{ className?: string }> }> = {
  feedback_reply: { icon: MessageSquare },
}

export function NotificationsBar({ notifications }: { notifications: UserNotification[] }) {
  const [items, setItems] = useState(notifications)
  const [, startTransition] = useTransition()

  if (items.length === 0) return null

  function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id)) // optimiste
    startTransition(() => { dismissNotificationAction(id).catch(() => {}) })
  }

  return (
    <section aria-label="Notifications" className="space-y-2">
      {items.map((n) => {
        const Icon = TYPE_META[n.type]?.icon ?? Bell
        return (
          <div
            key={n.id}
            className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50/60 px-4 py-3 dark:border-brand-900/40 dark:bg-brand-950/20"
          >
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{n.title}</p>
              {n.body && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground leading-snug">
                  {n.body}
                </p>
              )}
              {n.link && (
                <Link
                  href={n.link}
                  onClick={() => dismiss(n.id)}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Voir <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label="Marquer comme lu"
              title="Marquer comme lu"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </section>
  )
}
