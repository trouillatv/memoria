import Link from 'next/link'
import {
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  FileText,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RecentActivityEvent, RecentActivityType } from '@/lib/db/dashboard'

const ICON_MAP: Record<RecentActivityType, LucideIcon> = {
  intervention_executed: Activity,
  intervention_validated: CheckCircle2,
  anomaly_resolved: AlertTriangle,
  tender_ready: FileText,
  contract_activated: FileCheck,
  evidence_inserted: Sparkles,
}

interface Props {
  events: RecentActivityEvent[]
}

/**
 * Widget « Activité récente » (Slice 11.3).
 *
 * Timeline cross-domaine — 5 à 10 derniers événements anonymes.
 * Format relatif FR ("À l'instant", "Il y a 2h", "Hier", "Il y a 3 jours").
 *
 * Doctrine V3 absolue : aucun prénom/nom d'agent — uniquement événements
 * factuels (interventions, anomalies, tenders, contrats, engagements).
 */
export function RecentActivityWidget({ events }: Props) {
  if (events.length === 0) return null

  return (
    <Card data-slot="recent-activity">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          <span>Activité récente</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {events.map((e, i) => {
            const Icon = ICON_MAP[e.type] ?? Activity
            const timeLabel = formatRelative(e.occurredAt)
            return (
              <li key={`${e.type}-${i}-${e.occurredAt}`} className="px-6 py-2.5">
                <RowWrapper href={e.href}>
                  <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{e.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {timeLabel}
                      {e.contextLabel ? ` · ${e.contextLabel}` : ''}
                    </div>
                  </div>
                </RowWrapper>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function RowWrapper({ href, children }: { href?: string; children: React.ReactNode }) {
  const className = 'flex items-start gap-3 -mx-6 px-6 py-1 -my-1'
  if (href) {
    return (
      <Link href={href} className={`${className} hover:bg-muted/30 transition-colors`}>
        {children}
      </Link>
    )
  }
  return <div className={className}>{children}</div>
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMin < 1) return "À l'instant"
  if (diffMin < 60) return `Il y a ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Il y a ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'Hier'
  if (diffD < 7) return `Il y a ${diffD} jours`
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
