'use client'

import Link from 'next/link'
import { LayoutDashboard, ListChecks, FileText, MessageSquare, MoreHorizontal, ExternalLink, RefreshCw, Archive, AlertTriangle, BookOpen, Bot, FileSignature, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TenderStatusBadge } from './TenderStatusBadge'
import { TenderScoreBadge } from './TenderScoreBadge'
import { archiveTenderAction, relaunchAnalysisAction as _relaunchAnalysisAction } from './actions'
import { toast } from 'sonner'
import { AGENT_COLORS } from './agents-colors'
import { AGENTS } from './agents-metadata'
import type { DbTender } from '@/types/db'
import type { ActivityItem } from './activity-feed'

export type TenderView = 'synthese' | 'analyse' | 'memoire' | 'atelier'

interface NavItem {
  view: TenderView
  label: string
  icon: React.ComponentType<{ className?: string }>
  count?: number
}

interface TenderSidebarProps {
  tender: DbTender
  currentView: TenderView
  hasAnalysis: boolean
  kpis: {
    risksCount: number
    risksHighCount: number
    constraintsCount: number
    constraintsRequiredCount: number
    checklistCount: number
    chatMessagesCount: number
  }
  sources: {
    pdfSignedUrl: string | null
    pdfFilename: string | null
    libraryItemsCount: number
    provider: string | null
    isMock: boolean
  }
  canRelaunch: boolean
  isInProgress: boolean
  tenderId: string
  activityFeed: ActivityItem[]
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  return `il y a ${d} j`
}

function formatDeadline(deadline: string | null): { label: string; daysLeft: number | null } | null {
  if (!deadline) return null
  const d = new Date(deadline)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  return { label, daysLeft: diffDays }
}

export function TenderSidebar({
  tender,
  currentView,
  hasAnalysis,
  kpis,
  sources,
  canRelaunch,
  isInProgress,
  tenderId,
  activityFeed,
}: TenderSidebarProps) {
  const deadline = formatDeadline(tender.deadline)

  const NAV: NavItem[] = [
    { view: 'synthese', label: 'Synthèse',          icon: LayoutDashboard },
    { view: 'analyse',  label: 'Analyse détaillée', icon: ListChecks      },
    { view: 'memoire',  label: 'Mémoire technique', icon: FileText        },
    { view: 'atelier',  label: 'Copilote AO',        icon: MessageSquare,  count: kpis.chatMessagesCount > 0 ? kpis.chatMessagesCount : undefined },
  ]

  async function handleArchive() {
    if (!confirm('Archiver cet appel d\'offres ? Il disparaîtra de la liste mais reste en base (soft delete).')) return
    const fd = new FormData()
    fd.set('id', tenderId)
    const r = await archiveTenderAction(fd)
    if (r && 'error' in r) toast.error(r.error)
  }

  async function handleRelaunch() {
    const fd = new FormData()
    fd.set('id', tenderId)
    const r = await _relaunchAnalysisAction(fd)
    if (r && 'error' in r) toast.error(r.error)
  }

  return (
    <aside className="md:sticky md:top-6 md:self-start space-y-4 md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:pr-2">

      {/* AO header */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold leading-snug line-clamp-3">{tender.title}</h2>
        {tender.client_name && (
          <p className="text-xs text-muted-foreground line-clamp-2">{tender.client_name}</p>
        )}
      </div>

      <div className="hidden md:block border-t" />

      {/* ÉTAT */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">État</p>
        <div className="flex flex-wrap gap-2 items-center">
          <TenderStatusBadge status={tender.status} />
          {tender.opportunity_score !== null && (
            <TenderScoreBadge score={tender.opportunity_score} />
          )}
        </div>
        {deadline && (
          <div className="text-xs text-muted-foreground">
            <span>Échéance : {deadline.label}</span>
            {deadline.daysLeft !== null && (
              <span className={cn('ml-1 font-medium', deadline.daysLeft <= 7 ? 'text-rose-600' : deadline.daysLeft <= 30 ? 'text-amber-600' : 'text-muted-foreground')}>
                {deadline.daysLeft > 0
                  ? `(J-${deadline.daysLeft})`
                  : deadline.daysLeft === 0
                    ? "(aujourd'hui)"
                    : `(dépassé)`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* MÉTRIQUES — seulement si analyse dispo */}
      {hasAnalysis && (
        <>
          <div className="hidden md:block border-t" />
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Métriques</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {kpis.risksCount > 0 && (
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                  <span>
                    {kpis.risksCount} risque{kpis.risksCount > 1 ? 's' : ''}
                    {kpis.risksHighCount > 0 && (
                      <span className="text-rose-600 font-medium ml-1">({kpis.risksHighCount} élevé{kpis.risksHighCount > 1 ? 's' : ''})</span>
                    )}
                  </span>
                </li>
              )}
              {kpis.constraintsCount > 0 && (
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>
                    {kpis.constraintsCount} contrainte{kpis.constraintsCount > 1 ? 's' : ''}
                    {kpis.constraintsRequiredCount > 0 && (
                      <span className="text-amber-700 font-medium ml-1">({kpis.constraintsRequiredCount} obligatoire{kpis.constraintsRequiredCount > 1 ? 's' : ''})</span>
                    )}
                  </span>
                </li>
              )}
              {kpis.checklistCount > 0 && (
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span>{kpis.checklistCount} item{kpis.checklistCount > 1 ? 's' : ''} checklist</span>
                </li>
              )}
              {kpis.chatMessagesCount > 0 && (
                <li className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                  <span>{kpis.chatMessagesCount} msg{kpis.chatMessagesCount > 1 ? 's' : ''} atelier</span>
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      {/* ACTIVITÉ RÉCENTE */}
      {activityFeed.length > 0 && (
        <>
          <div className="hidden md:block border-t" />
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Activité récente</p>
            <ul className="space-y-2 text-xs">
              {activityFeed.map((item) => {
                const colors = item.agentName ? AGENT_COLORS[item.agentName] : null
                const meta = item.agentName ? AGENTS[item.agentName] : null
                return (
                  <li key={item.id} className="flex items-start gap-2">
                    <span
                      className={cn(
                        'shrink-0 w-1.5 h-1.5 rounded-full mt-1.5',
                        colors?.dotClass ?? 'bg-muted-foreground/50'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground/90">
                        {meta && <span className={cn('font-medium', colors?.textClass)}>{meta.label}</span>}
                        {meta ? ' ' : ''}
                        <span className="text-muted-foreground">{item.description}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/80">{timeAgo(item.timestamp)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {/* SOURCES */}
      {(sources.pdfSignedUrl || sources.libraryItemsCount > 0 || sources.provider) && (
        <>
          <div className="hidden md:block border-t" />
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sources</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {sources.pdfSignedUrl && (
                <li>
                  <a
                    href={sources.pdfSignedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{sources.pdfFilename ?? 'PDF source'}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                  </a>
                </li>
              )}
              {sources.libraryItemsCount > 0 && (
                <li className="flex items-center gap-1.5">
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span>{sources.libraryItemsCount} item{sources.libraryItemsCount > 1 ? 's' : ''} bibliothèque</span>
                </li>
              )}
              {sources.provider && (
                <li className="flex items-center gap-1.5">
                  <Bot className="h-3 w-3 shrink-0" />
                  <span className="capitalize">{sources.provider}</span>
                  {sources.isMock && (
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] px-1 py-0 h-4 ml-0.5">Démo</Badge>
                  )}
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      <div className="hidden md:block border-t" />

      {/* NAVIGATION */}
      <nav
        aria-label="Navigation appel d'offres"
        className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1 md:mx-0 md:px-0 scrollbar-hide"
      >
        {NAV.map((item) => {
          const Icon = item.icon
          const isActive = currentView === item.view
          const requiresAnalysis = item.view !== 'atelier'
          const disabled = requiresAnalysis && !hasAnalysis

          const baseClass = cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap shrink-0',
            isActive
              ? 'border-l-2 border-brand-600 bg-accent/60 text-accent-foreground font-medium pl-[10px]'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            disabled && 'opacity-40 pointer-events-none'
          )

          const content = (
            <>
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="ml-auto text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-mono leading-none">
                  {item.count}
                </span>
              )}
            </>
          )

          if (disabled) {
            return (
              <span key={item.view} className={baseClass} aria-disabled="true">
                {content}
              </span>
            )
          }

          return (
            <Link
              key={item.view}
              href={`?view=${item.view}`}
              className={baseClass}
              aria-current={isActive ? 'page' : undefined}
              scroll={false}
            >
              {content}
            </Link>
          )
        })}
      </nav>

      {/* Engagements — sub-link vers la page extraction/curation */}
      {(tender.status === 'ready' || tender.status === 'submitted' || tender.status === 'archived') && (
        <>
          <div className="hidden md:block border-t" />
          <Link
            href={`/tenders/${tenderId}/engagements`}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <Target className="h-4 w-4 text-muted-foreground" />
            Engagements extraits
          </Link>
        </>
      )}

      {/* CTA — Convertir en contrat (status finalisé uniquement) */}
      {(tender.status === 'ready' || tender.status === 'submitted') && (
        <>
          <div className="hidden md:block border-t" />
          <Link
            href={`/tenders/${tenderId}/convert`}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700 text-sm font-medium transition-colors"
          >
            <FileSignature className="h-4 w-4" />
            Convertir en contrat
          </Link>
        </>
      )}

      {/* ACTIONS — kebab natif <details> pour éviter les bugs overlay shadcn */}
      {(canRelaunch || (!isInProgress && tender.status !== 'archived') || sources.pdfSignedUrl) && (
        <>
          <div className="hidden md:block border-t" />
          <details className="group relative">
            <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer list-none hover:text-foreground transition-colors select-none py-1">
              <MoreHorizontal className="h-4 w-4" />
              <span>Actions</span>
            </summary>
            <div className="mt-1 space-y-0.5 pl-1">
              {canRelaunch && (
                <button
                  type="button"
                  onClick={handleRelaunch}
                  disabled={isInProgress}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="h-3 w-3 shrink-0" />
                  Relancer l&apos;analyse
                </button>
              )}
              {!isInProgress && tender.status !== 'archived' && (
                <button
                  type="button"
                  onClick={handleArchive}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                >
                  <Archive className="h-3 w-3 shrink-0" />
                  Archiver
                </button>
              )}
              {sources.pdfSignedUrl && (
                <a
                  href={sources.pdfSignedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  Voir le PDF source
                </a>
              )}
            </div>
          </details>
        </>
      )}
    </aside>
  )
}
