import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, HelpCircle } from 'lucide-react'
import { requireSiteAccess as requireFieldSiteAccess } from '@/lib/field/site-access'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getActiveVisit,
  buildSiteStatusSummary,
  buildSinceLastVisitSummary,
  getSiteMemorySnapshot,
  prepareVisitBriefing,
} from '@/lib/db/visits'
import { getSiteNextSteps } from '@/lib/db/site-next-steps'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { SiteStatusCard } from '../SiteStatusCard'
import { SinceLastVisitCard } from '../SinceLastVisitCard'
import { SiteMemoryCard } from '../SiteMemoryCard'
import { NextStepCard } from '../NextStepCard'
import { VisitKnowledgeCard } from '../VisitKnowledgeCard'
import { VisitLauncher } from '../VisitLauncher'

/**
 * « Préparer ma visite » — le briefing avant d'aller sur le chantier.
 * RÉARRANGEMENT du cockpit chantier (mêmes composants, mêmes read models),
 * ordonné pour la préparation : état → ce qui a changé → questions à poser
 * sur place → agenda → connaissance — puis démarrer la visite.
 *
 * La seule brique nouvelle est « Points à vérifier sur place » : le moteur
 * déterministe prepareVisitBriefing (signaux mémoire → questions + pourquoi),
 * qui existait sans être branché sur aucune surface.
 */
export default async function PrepareVisitPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireFieldSiteAccess(siteId)
  await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [status, since, snapshot, steps, briefing, activeVisit, overview] = await Promise.all([
    buildSiteStatusSummary(siteId).catch(() => []),
    buildSinceLastVisitSummary(siteId, user.id).catch(() => null),
    getSiteMemorySnapshot(siteId).catch(() => null),
    getSiteNextSteps(siteId).catch(() => []),
    prepareVisitBriefing(siteId).catch(() => ({ signals: [], questions: [] })),
    getActiveVisit(siteId).catch(() => null),
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
  ])

  const questions = briefing.questions.slice(0, 5)

  return (
    <div className="space-y-6 max-w-md pb-32">
      <header className="space-y-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Préparer ma visite
        </p>
        <h1 className="text-2xl font-bold leading-tight">{site.name}</h1>
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground/70 underline underline-offset-2 active:opacity-70"
        >
          Fiche complète <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* 1 — État du chantier : où on en est avant de partir. */}
      <SiteStatusCard cells={status} />

      {/* 2 — Ce qui a bougé depuis le dernier passage : reprendre le fil. */}
      {since && <SinceLastVisitCard summary={since} siteId={siteId} />}

      {/* 3 — Questions à poser sur place : le fait, puis son POURQUOI. */}
      {questions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Points à vérifier sur place
          </h2>
          <ul className="space-y-2">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl border border-foreground/[0.08] bg-card px-4 py-3">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" strokeWidth={2} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium leading-snug">{q.question}</span>
                  {q.why && (
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">{q.why}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4 — Agenda du chantier : ce qui arrive. */}
      <NextStepCard steps={steps} />

      {/* 5 — Ce que MemorIA a retenu : échéances, à savoir, vigilances. */}
      <VisitKnowledgeCard overview={overview} synthesisHref={`/m/site/${siteId}`} />

      {/* 6 — Mémoire longue du chantier. */}
      {snapshot && <SiteMemoryCard snapshot={snapshot} />}

      {/* Démarrer (ou reprendre) la visite — l'aboutissement du briefing. */}
      <VisitLauncher siteId={siteId} activeVisit={activeVisit} />
    </div>
  )
}
