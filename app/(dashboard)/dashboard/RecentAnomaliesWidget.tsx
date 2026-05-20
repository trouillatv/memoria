import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { RecentAnomalyItem } from '@/lib/db/dashboard'
import { anomalyLabel } from '@/lib/anomaly-labels'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `il y a ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `il y a ${hrs}h`
  return `il y a ${Math.floor(hrs / 24)}j`
}

export function RecentAnomaliesWidget({ anomalies }: { anomalies: RecentAnomalyItem[] }) {
  if (anomalies.length === 0) return null

  // V6.2 (Vincent 2026-05-20) : signal terrain → bandeau ROUGE bordeaux en haut.
  // Sobre mais voyant. Ne déclenche pas si silence positif (anomalies.length 0).
  return (
    <Card
      data-slot="recent-anomalies"
      className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40"
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 text-red-700 dark:text-red-300 shrink-0"
            strokeWidth={2}
          />
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">
            {anomalies.length === 1
              ? '1 signalement terrain ces dernières 24h'
              : `${anomalies.length} signalements terrain ces dernières 24h`}
          </h3>
        </div>
        <ul className="space-y-2">
          {anomalies.map((a) => (
            <li key={a.id}>
              <Link
                href={`/interventions/${a.interventionId}`}
                className="flex items-start justify-between gap-3 rounded-lg hover:bg-red-100/60 dark:hover:bg-red-950/40 px-2 py-1.5 -mx-2 transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium block truncate text-red-950 dark:text-red-50">
                    {anomalyLabel(a.description, a.categoryOther, a.category)}
                  </span>
                  {a.siteName && (
                    <span className="text-xs text-red-900/70 dark:text-red-200/70">{a.siteName}</span>
                  )}
                </div>
                <span className="text-xs text-red-900/60 dark:text-red-200/60 shrink-0 mt-0.5 tabular-nums">
                  {timeAgo(a.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
