import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireSiteAccess as requireFieldSiteAccess } from '@/lib/field/site-access'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveVisit } from '@/lib/db/visits'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { listActivePreparationItems } from '@/lib/db/visit-preparation'
import { buildLiveDebrief } from '@/lib/knowledge/live-debrief'
import type { LiveDebriefObjectItem } from '@/lib/knowledge/live-debrief'
import { selectPreparationObjective } from '@/lib/knowledge/visit-preparation'
import { VisitLauncher } from '../VisitLauncher'
import { VisitBriefClient } from './VisitBriefClient'
import type { PrepItemSeed } from './VisitBriefClient'
import { CopilotMobileSheet } from '../CopilotMobileSheet'
import { OverdueDeadlinesSection } from './OverdueDeadlinesSection'
import { PrepareReadSpine } from './PrepareReadSpine'

/**
 * « Préparer ma visite » — le brief décisionnel avant d'aller sur le chantier.
 *
 * Point 11A : colonne de LECTURE convergée sur LiveDebrief (même vérité métier
 * que le desktop) — Objectif → À traiter → À surveiller → Depuis la venue → À
 * retenir. Sobriété : plafond + « Voir plus », zéro agrégat, on NE recrée pas
 * Actions/Réserves/Suivi (on lie).
 *
 * « Mon plan » reste sur sa mécanique P1-A inchangée (VisitBriefClient, source
 * pvAttention/pvToVerify canonical_subject) : la surface de lecture du Brief et
 * la source du plan personnel répondent à deux fonctions distinctes.
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

  const [activeVisit, overview, rawPrepItems, live] = await Promise.all([
    getActiveVisit(siteId).catch(() => null),
    // Conservé UNIQUEMENT pour « Mon plan » (pvAttention/pvToVerify, mécanique P1-A).
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
    listActivePreparationItems(siteId, user.id).catch(() => []),
    buildLiveDebrief(siteId, user.id).catch(() => null),
  ])

  // Objectif « pourquoi j'y vais » — MÊME sélecteur déterministe existant
  // (selectPreparationObjective), nourri par la vérité commune LiveDebrief.
  const objItem = (kind: LiveDebriefObjectItem['kind']) =>
    (live?.toHandle.find((i) => i.kind === kind) as LiveDebriefObjectItem | undefined) ?? null
  const objAction = objItem('action')
  const objDeadline = objItem('deadline')
  const objReserve = objItem('reserve')
  const objWatch = live?.toWatch.find((i) => i.kind === 'informational_signal') ?? null
  const next = live?.confirmedToday.nextEvent ?? null
  const rawObjective = live
    ? selectPreparationObjective({
        scheduled: next ? { kind: 'scheduled', text: 'Préparer le prochain passage prévu', sourceId: null, sourceHref: next.href } : null,
        action: objAction ? { kind: 'action', text: objAction.title, sourceId: objAction.id, sourceHref: objAction.href } : null,
        deadline: objDeadline ? { kind: 'deadline', text: objDeadline.title, sourceId: objDeadline.id, sourceHref: objDeadline.href } : null,
        reserve: objReserve ? { kind: 'reserve', text: `Vérifier la réserve « ${objReserve.title} »`, sourceId: objReserve.id, sourceHref: objReserve.href } : null,
        watchpoint: objWatch ? { kind: 'watchpoint', text: objWatch.title, sourceId: objWatch.canonicalSubjectId, sourceHref: objWatch.href } : null,
        decision: null,
      })
    : null
  const objective = rawObjective ? { text: rawObjective.text, href: rawObjective.sourceHref } : null

  // Sérialisation JSON-safe pour le client component (« Mon plan » inchangé)
  const prepItems: PrepItemSeed[] = rawPrepItems.map((p) => ({
    id: p.id,
    stableKey: p.stableKey,
    label: p.label,
    sourceKind: p.sourceKind as PrepItemSeed['sourceKind'],
    sourceRef: p.sourceRef,
    canonicalSubjectId: p.canonicalSubjectId,
    priority: p.priority,
    reason: p.reason,
  }))
  const planCount = prepItems.length

  return (
    <div className="space-y-6 max-w-md pb-32">
      <header className="space-y-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Préparer ma visite
          {planCount > 0 && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {planCount} sélectionné{planCount > 1 ? 's' : ''}
            </span>
          )}
        </p>
        <h1 className="text-2xl font-bold leading-tight">{site.name}</h1>
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground/70 underline underline-offset-2 active:opacity-70"
        >
          Fiche complète <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      {/* Colonne de lecture (LiveDebrief) — sobre, plafonnée, lecture seule */}
      {live && (
        <PrepareReadSpine
          objective={objective}
          toHandle={live.toHandle}
          toWatch={live.toWatch}
          sinceLastVisit={live.sinceLastVisit}
          confirmedToday={live.confirmedToday}
        />
      )}

      {/* Confrontation échéances ↔ preuve terrain (info unique — conservé, à
          arbitrer en recette : peut recouper « À traiter »). */}
      <OverdueDeadlinesSection siteId={siteId} />

      {/* Copilote — poser une question avant d'arriver sur le chantier */}
      <CopilotMobileSheet siteId={siteId} siteName={site.name} />

      {/* Mon plan — mécanique P1-A INCHANGÉE (source pvAttention/pvToVerify) */}
      {(overview.pvAttention.length > 0 || overview.pvToVerify.length > 0 || planCount > 0) && (
        <VisitBriefClient
          siteId={siteId}
          pvAttention={overview.pvAttention}
          pvToVerify={overview.pvToVerify}
          initialPrepItems={prepItems}
        />
      )}

      {!live && overview.pvAttention.length === 0 && overview.pvToVerify.length === 0 && planCount === 0 && (
        <p className="rounded-2xl border border-dashed border-foreground/10 px-4 py-4 text-[13px] text-muted-foreground">
          Pas encore de données de préparation sur ce chantier.
        </p>
      )}

      {/* CTA — démarrer avec le nombre de points sélectionnés */}
      <VisitLauncher siteId={siteId} activeVisit={activeVisit} planCount={planCount} />
    </div>
  )
}
