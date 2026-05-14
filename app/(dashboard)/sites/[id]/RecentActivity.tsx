import { Camera, AlertTriangle, FileText, CheckSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RecentActivityItem } from '@/lib/db/site-cockpit'

/**
 * Activité récente — texte uniquement.
 * Les photos ont leur propre galerie dédiée sur la page Site.
 */

const FR_DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  if (diffDays < 7) return FR_DAYS_SHORT[d.getDay()]
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

const KIND_ICON: Record<RecentActivityItem['kind'], LucideIcon> = {
  photo: Camera,
  anomaly: AlertTriangle,
  intervention: CheckSquare,
  site_note: FileText,
}

const KIND_ICON_COLOR: Record<RecentActivityItem['kind'], string> = {
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  intervention: 'text-emerald-600',
  site_note: 'text-muted-foreground',
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas d&apos;activité ces 7 derniers jours.
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind]
        const iconColor = KIND_ICON_COLOR[item.kind]
        return (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/40"
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-xs leading-snug">{item.primary}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {formatDateLabel(item.occurredAt)}
                </span>
              </div>
              {item.secondary && (
                <p className="text-[10px] text-muted-foreground">{item.secondary}</p>
              )}
              {item.tasks && item.tasks.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {item.tasks.map((t, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
