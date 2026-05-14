import Link from 'next/link'
import { Camera, AlertTriangle, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RecentActivityItem } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Activité récente, pattern shadcn cohérent avec le reste de l'app.
 *
 * Doctrine produit (reste valide) :
 *   ❌ pas de tri "par intervenant" (reverse-lookup interdit)
 *   ❌ pas de filtre "Tout / Passages / Anomalies" (dilue le sens)
 *
 * VIGNETTE PHOTO : couleur native, object-contain, jamais crop.
 * "Photo = mémoire opérationnelle, ni marketing ni preuve juridique."
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
  intervention: FileText,
  site_note: FileText,
}

const KIND_ICON_COLOR: Record<RecentActivityItem['kind'], string> = {
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  intervention: 'text-muted-foreground',
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
    <ul className="space-y-1.5">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind]
        const iconColor = KIND_ICON_COLOR[item.kind]
        return (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-start gap-3 rounded border bg-card p-3"
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />

            {item.photoUrl && item.interventionId ? (
              <Link
                href={`/interventions/${item.interventionId}`}
                className="shrink-0 block"
                aria-label="Voir l'intervention source"
              >
                <img
                  src={item.photoUrl}
                  alt=""
                  className="block h-12 w-12 rounded border bg-muted object-contain"
                />
              </Link>
            ) : null}

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-sm font-medium">{item.primary}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {formatDateLabel(item.occurredAt)}
                </span>
              </div>
              {item.secondary && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.secondary}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
