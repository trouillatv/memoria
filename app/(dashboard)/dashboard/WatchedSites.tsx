import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { SiteDashboardItem, SiteStatus } from '@/lib/db/sites-dashboard'

const STATUS_DOT: Record<SiteStatus, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-400',
  normal: 'bg-emerald-500',
}

const STATUS_LABEL: Record<SiteStatus, string> = {
  critical: 'Attention requise',
  warning: 'Actions en cours',
  normal: 'Situation normale',
}

function relDate(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return "Aujourd'hui"
  if (days === 1) return 'Hier'
  if (days < 7) return `il y a ${days} j`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `il y a ${weeks} sem`
  return `il y a ${Math.floor(days / 30)} mois`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

interface WatchedSitesProps {
  sites: SiteDashboardItem[]
}

export function WatchedSites({ sites }: WatchedSitesProps) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Sites à surveiller
        </h2>
      </div>

      {sites.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground italic">
          Aucun site actif à surveiller pour le moment.{' '}
          <Link href="/sites" className="not-italic underline underline-offset-2 hover:text-foreground">
            Voir les sites
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={site.href}
                className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <span
                  title={STATUS_LABEL[site.status]}
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[site.status]}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug truncate">{site.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {site.clientName ? `${site.clientName} · ` : ''}
                    {site.overdueActionCount > 0 && (
                      <span className="text-red-600">
                        {site.overdueActionCount} en retard ·{' '}
                      </span>
                    )}
                    {site.openReserveCount > 0 && (
                      <span>
                        {site.openReserveCount} réserve{site.openReserveCount > 1 ? 's' : ''} ·{' '}
                      </span>
                    )}
                    {site.activeActionCount > 0 && (
                      <span>
                        {site.activeActionCount} action{site.activeActionCount > 1 ? 's' : ''} ·{' '}
                      </span>
                    )}
                    {site.nextPassageAt
                      ? `prochain ${formatDate(site.nextPassageAt)}`
                      : site.lastActivityAt
                        ? `dernière visite ${relDate(site.lastActivityAt)}`
                        : 'aucune visite'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
