import Link from 'next/link'
import { LayoutDashboard, ListChecks, FileText, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TenderStatusBadge } from './TenderStatusBadge'
import { TenderScoreBadge } from './TenderScoreBadge'
import type { DbTender } from '@/types/db'

export type TenderView = 'synthese' | 'analyse' | 'memoire' | 'atelier'

interface NavItem {
  view: TenderView
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { view: 'synthese', label: 'Synthèse',          icon: LayoutDashboard },
  { view: 'analyse',  label: 'Analyse détaillée', icon: ListChecks      },
  { view: 'memoire',  label: 'Mémoire technique', icon: FileText        },
  { view: 'atelier',  label: 'Atelier IA',        icon: MessageSquare   },
]

export function TenderSidebar({
  tender,
  currentView,
  hasAnalysis,
}: {
  tender: DbTender
  currentView: TenderView
  hasAnalysis: boolean
}) {
  return (
    <aside className="md:sticky md:top-6 md:self-start space-y-4 md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:pr-2">
      {/* AO header */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold leading-snug line-clamp-3">{tender.title}</h2>
        {tender.client_name && (
          <p className="text-xs text-muted-foreground line-clamp-2">{tender.client_name}</p>
        )}
      </div>

      {/* Status + score */}
      <div className="flex flex-wrap gap-2 items-center">
        <TenderStatusBadge status={tender.status} />
        {tender.opportunity_score !== null && (
          <TenderScoreBadge score={tender.opportunity_score} />
        )}
      </div>

      <div className="hidden md:block border-t" />

      {/* Nav — vertical desktop, horizontal scroll mobile */}
      <nav
        aria-label="Navigation appel d'offres"
        className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1 md:mx-0 md:px-0 scrollbar-hide"
      >
        {NAV.map((item) => {
          const Icon = item.icon
          const isActive = currentView === item.view
          // Atelier IA est accessible meme si pas d'analyse complete
          // Les autres onglets necessitent une analyse — sinon disable
          const requiresAnalysis = item.view !== 'atelier'
          const disabled = requiresAnalysis && !hasAnalysis
          const className = cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap shrink-0',
            isActive
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            disabled && 'opacity-40 pointer-events-none'
          )

          if (disabled) {
            return (
              <span key={item.view} className={className} aria-disabled="true">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
            )
          }

          return (
            <Link
              key={item.view}
              href={`?view=${item.view}`}
              className={className}
              aria-current={isActive ? 'page' : undefined}
              scroll={false}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
