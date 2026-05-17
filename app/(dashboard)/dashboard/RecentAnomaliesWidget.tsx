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

  return (
    <Card data-slot="recent-anomalies">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold">
            {anomalies.length === 1
              ? '1 signalement ces dernières 24h'
              : `${anomalies.length} signalements ces dernières 24h`}
          </h3>
        </div>
        <ul className="space-y-2">
          {anomalies.map((a) => (
            <li key={a.id}>
              <Link
                href={`/interventions/${a.interventionId}`}
                className="flex items-start justify-between gap-3 rounded-lg hover:bg-muted/40 px-2 py-1.5 -mx-2 transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium block truncate">
                    {anomalyLabel(a.description, a.categoryOther, a.category)}
                  </span>
                  {a.siteName && (
                    <span className="text-xs text-muted-foreground">{a.siteName}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
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
