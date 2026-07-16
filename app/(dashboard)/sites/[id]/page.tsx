import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import type { ComponentType, ReactNode } from 'react'
import QRCode from 'qrcode'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CalendarPlus,
  ChevronRight,
  Clock,
  ListTodo,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { getSiteOverview, emptySiteOverview, type SiteOverview } from '@/lib/knowledge/site-overview'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { listMissionsBySite } from '@/lib/db/missions'
import { listInterventionsSupervisor, type SupervisorInterventionRow } from '@/lib/db/interventions'
import { listCyclesBySite } from '@/lib/db/planning-cycles'
import { listTeams } from '@/lib/db/teams'
import { listHandoverBriefsBySite } from '@/lib/db/handover'
import type { DbTeam } from '@/types/db'
import {
  buildSiteStatusSummary,
  getLastEndedVisitForSite,
  listSiteVisitsWithCounts,
} from '@/lib/db/visits'
import {
  getSiteCurrentState,
  getSiteIdentity,
  getSiteRecentActivity,
  type RecentActivityItem,
} from '@/lib/db/site-cockpit'
import { buildSiteMemorySignals, type MemorySignal } from '@/lib/db/site-memory-signals'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { listSitePhotos } from '@/lib/db/site-photos'
import { getVisitCapturePreviewUrls, listVisitCapturesBySite } from '@/lib/db/visit-captures'
import { listSiteProofDossiers } from '@/lib/db/proof-dossier'
import { getSiteQrHistory, getSiteQrInfo } from '@/lib/db/site-qr'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { todayLocalIso } from '@/lib/time/local-date'
import {
  buildOverviewAttention,
  getActionDueLabel,
  getActionDueTone,
  selectNextEvent,
  selectPriorityActions,
  selectRecentChanges,
  type OverviewActionInput,
  type OverviewChangeInput,
  type OverviewEventInput,
  type OverviewSignalInput,
} from '@/lib/chantier/overview-projections'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { QuickActionButton } from '@/components/actions/QuickActionButton'
import { SiteReportLauncher } from '@/app/(field)/m/site/[siteId]/SiteReportLauncher'
import { IdentityHeader } from './IdentityHeader'
import { AttachClientButton } from './AttachClientButton'
import { listClients } from '@/lib/db/sites'
import { SiteBriefButton } from './SiteBriefButton'
import { SiteAddMenu } from './SiteAddMenu'
import { SiteMemoryQuery } from './SiteMemoryQuery'
import { SiteTabsNav, SITE_TAB_KEYS, type SiteTabKey } from './SiteTabsNav'
import { TogglePanel } from './TogglePanel'
import { DocumentsWorkspace, type DocumentsQrState, type SiteMediaSummary } from './views/documents/DocumentsWorkspace'
import { MemoryWorkspace, type SiteRelay } from './views/memory/MemoryWorkspace'
import { WorkWorkspace } from './views/work/WorkWorkspace'
import { ChronologyWorkspace } from './views/chronology/ChronologyWorkspace'
import { PlanningWorkspace } from './views/planning/PlanningWorkspace'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

type ChantierViewKey = SiteTabKey
const CHANTIER_VIEW_KEYS = SITE_TAB_KEYS

export default async function SitePage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { tab: rawTab } = await searchParams
  const tab: ChantierViewKey = (CHANTIER_VIEW_KEYS as ReadonlyArray<string>).includes(rawTab ?? '')
    ? (rawTab as ChantierViewKey)
    : 'apercu'

  const [
    identity,
    openActions,
    blocages,
    statusSummary,
    currentState,
    recentActivity,
    lastVisit,
    memorySignals,
    visits,
    missions,
    interventionsResult,
    cycles,
    teams,
    overview,
  ] = await Promise.all([
    getSiteIdentity(id),
    listOpenSiteActions({ siteIds: [id] }).catch(() => []),
    listBlocagesBySite(id).catch(() => []),
    buildSiteStatusSummary(id).catch(() => []),
    getSiteCurrentState(id).catch(() => null),
    getSiteRecentActivity(id, 12).catch(() => []),
    getLastEndedVisitForSite(id).catch(() => null),
    buildSiteMemorySignals(id).catch(() => []),
    listSiteVisitsWithCounts(id, 8).catch(() => []),
    listMissionsBySite(id).catch(() => []),
    listInterventionsSupervisor({ siteId: id, dateRange: 'all', limit: 80 }).catch(() => ({ items: [], total: 0 })),
    listCyclesBySite(id).catch(() => []),
    listTeams().catch(() => []),
    getSiteOverview(id).catch(() => emptySiteOverview(id)),
  ])

  if (!identity) notFound()

  const todayIso = todayLocalIso()
  const openBlocages = blocages.filter((b) => b.dateEnd === null)
  const openReserves = numberStatus(statusSummary.find((s) => s.key === 'reserves')?.value)
  const actions = toOverviewActions(openActions, id)
  const attention = buildOverviewAttention([
    ...toBlocageSignals(openBlocages, id),
    ...toMemorySignals(memorySignals, id),
    ...toActionSignals(openActions, todayIso, id),
  ])
  const priorityActions = selectPriorityActions(actions, { todayIso, limit: 5 })
  const sinceIso = lastVisit?.endedAt ?? lastVisit?.startedAt ?? null
  const recentChanges = selectRecentChanges(toOverviewChanges(recentActivity), { sinceIso, limit: 5 })
  const nextEvent = selectNextEvent(toOverviewEvents(currentState, id), new Date().toISOString())

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-1 pb-10">
      <DynamicCrumb segmentId={id} label={identity.name} />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <ChantierShell>
        <div className="rounded-[22px] border bg-card/90 p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <Link
                href="/sites"
                className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
                aria-label="Retour aux chantiers"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Chantiers</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground">{identity.name}</h1>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
                    Chantier
                  </span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  <IdentityHeader site={identity} />
                </div>
                {/* Le « sans client » ne doit jamais être une impasse (mig 210). */}
                {!identity.clientName && (
                  <div className="mt-2">
                    <AttachClientButton siteId={id} clients={await listClients().catch(() => [])} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 lg:min-w-[360px] lg:items-end">
              <div className="w-full lg:max-w-[320px]">
                <TogglePanel label="Rechercher dans ce chantier" icon={<Search className="h-4 w-4" />}>
                  <SiteMemoryQuery siteId={id} />
                </TogglePanel>
              </div>
              <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                <SiteBriefButton siteId={id} mode="visit" variant="desktop" />
                <SiteReportLauncher siteId={id} siteName={identity.name} variant="desktop" label="Faire une réunion" />
                <QuickActionButton source="desktop_site" siteId={id} variant="desktop" />
                <Link href={`/semaine?site=${id}`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
                  <CalendarPlus className="h-4 w-4" /> Planifier
                </Link>
                <SiteAddMenu siteId={id} />              </div>
            </div>
          </div>

          <div className="mt-5">
            <SiteTabsNav active={tab} siteId={id} />
          </div>
        </div>

        {tab === 'apercu' ? (
          <ChantierOverview
            siteId={id}
            openActionsCount={openActions.length}
            overview={overview}
            proposedActionsHref={lastVisit?.reportId ? `/m/visite/${lastVisit.reportId}/cr` : undefined}
            openReservesCount={openReserves}
            openBlocagesCount={openBlocages.length}
            nextEvent={nextEvent}
            attention={attention}
            priorityActions={priorityActions}
            recentChanges={recentChanges}
          />
        ) : tab === 'travail' ? (
          <WorkWorkspace
            siteId={id}
            actions={openActions}
            blocages={openBlocages}
            missions={missions}
            interventions={interventionsResult.items}
          />
        ) : tab === 'chronologie' ? (
          <ChronologyWorkspace
            siteId={id}
            changes={recentChanges}
            visits={visits}
            actions={openActions}
            blocages={blocages}
            interventions={interventionsResult.items}
          />
        ) : tab === 'planning' ? (
          <PlanningWorkspace
            siteId={id}
            nextEvent={nextEvent}
            interventions={interventionsResult.items}
            missions={missions}
            blocages={openBlocages}
            cycles={cycles}
            teams={teams}
          />
        ) : tab === 'documents-preuves' ? (
          <DocumentsPreuvesView siteId={id} canExport={user.role === 'admin' || user.role === 'manager'} />
        ) : tab === 'memoire' ? (
          <MemoireView
            siteId={id}
            siteName={identity.name}
            signals={memorySignals}
            interventions={interventionsResult.items}
            teams={teams}
            traceCount={visits.length}
          />
        ) : (
          null
        )}
      </ChantierShell>
    </div>
  )
}

function ChantierShell({
  children,
}: {
  children: ReactNode
}) {
  return <div className="space-y-5">{children}</div>
}

function ChantierOverview({
  siteId,
  openActionsCount,
  overview,
  proposedActionsHref,
  openReservesCount,
  openBlocagesCount,
  nextEvent,
  attention,
  priorityActions,
  recentChanges,
}: {
  siteId: string
  openActionsCount: number
  overview: SiteOverview
  proposedActionsHref?: string
  openReservesCount: number
  openBlocagesCount: number
  nextEvent: OverviewEventInput | null
  attention: OverviewSignalInput[]
  priorityActions: OverviewActionInput[]
  recentChanges: OverviewChangeInput[]
}) {
  return (
    <main className="space-y-4">
      <section aria-labelledby="etat-du-chantier" className="space-y-3">
        <h2 id="etat-du-chantier" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          État du chantier
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StateCard
            href={`/sites/${siteId}/actions`}
            icon={ListTodo}
            tone="orange"
            value={openActionsCount}
            title="Actions ouvertes"
            detail={openActionsCount > 0 ? 'À traiter ou suivre' : 'Aucune action ouverte'}
          />
          <StateCard
            href={`/sites/${siteId}/reserves`}
            icon={AlertTriangle}
            tone={openReservesCount > 0 ? 'orange' : 'green'}
            value={openReservesCount}
            title="Réserves ouvertes"
            detail={openReservesCount > 0 ? 'À lever' : 'Aucune réserve ouverte'}
          />
          <StateCard
            icon={ShieldAlert}
            tone={openBlocagesCount > 0 ? 'red' : 'green'}
            value={openBlocagesCount}
            title="Blocages en cours"
            detail={openBlocagesCount > 0 ? 'Peut ralentir le chantier' : 'Aucun blocage déclaré'}
          />
          <StateCard
            href={`/semaine?site=${siteId}`}
            icon={Calendar}
            tone="blue"
            value={nextEvent ? formatShortEventDate(nextEvent.startsAt) : 'Aucune'}
            title="Prochaine étape"
            detail={nextEvent?.title ?? 'Rien de planifié'}
          />
        </div>
      </section>

      {/* Connaissance de la dernière visite : les propositions d'action pas encore
          promues, avec leurs PREMIERS titres (pas seulement un compte). Distinctes du
          métier (actions ouvertes) ; « Confirmer » se fait sur la synthèse. Silence
          total tant qu'il n'y en a pas. Même projection que toutes les autres vues. */}
      {overview.actions.summary.proposed > 0 && (
        <section className="rounded-[18px] border border-sky-200 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/20">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
              {overview.actions.summary.proposed} action{overview.actions.summary.proposed > 1 ? 's' : ''} proposée{overview.actions.summary.proposed > 1 ? 's' : ''}
            </h2>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">à confirmer</span>
          </div>
          <ul className="mt-2 space-y-1">
            {overview.actions.proposed.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-sky-500" />
                <span className="min-w-0">{p.title}</span>
              </li>
            ))}
          </ul>
          {proposedActionsHref && (
            <Link href={proposedActionsHref} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-sky-700 hover:underline dark:text-sky-300">
              Voir la synthèse et confirmer <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[0.9fr_1.2fr_0.9fr]">
        <OverviewPanel title="Ce qui réclame mon attention">
          {attention.length > 0 ? (
            <ul className="space-y-3">
              {attention.map((signal) => (
                <li key={signal.id}>
                  <OverviewRow
                    href={signal.href}
                    icon={attentionIcon(signal.kind)}
                    tone={attentionTone(signal.kind)}
                    title={signal.title}
                    detail={signal.detail}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Rien ne réclame votre attention pour l'instant.</EmptyLine>
          )}
        </OverviewPanel>

        <OverviewPanel title="Que reste-t-il à faire ?">
          {priorityActions.length > 0 ? (
            <ul className="space-y-2.5">
              {priorityActions.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <OverviewRow
                    href={action.href}
                    icon={ListTodo}
                    tone={getActionDueTone(action, todayLocalIso())}
                    title={action.title}
                    detail={getActionDueLabel(action, todayLocalIso())}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>Aucune action prioritaire ouverte.</EmptyLine>
          )}
          <div className="pt-2">
            <Link href={`/sites/${siteId}/actions`} className="text-sm font-medium text-primary hover:underline">
              Voir toutes les actions ouvertes
            </Link>
          </div>
        </OverviewPanel>

        <OverviewPanel title="Depuis ma dernière venue">
          {recentChanges.length > 0 ? (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {recentChanges.map((change) => (
                <li key={change.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm font-medium">{change.title}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeDate(change.occurredAt)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyLine>Aucun changement significatif à afficher.</EmptyLine>
          )}
        </OverviewPanel>
      </div>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
              <Calendar className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Prochaine étape</h2>
              {nextEvent ? (
                <>
                  <p className="mt-1 text-lg font-semibold">{nextEvent.title}</p>
                  <p className="text-sm text-muted-foreground">{formatLongEventDate(nextEvent.startsAt)}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold">Aucune prochaine étape planifiée.</p>
                  <p className="text-sm text-muted-foreground">Planifiez la suite lorsque le chantier en a besoin.</p>
                </>
              )}
            </div>
          </div>
          {nextEvent?.kind === 'visit' ? (
            <SiteBriefButton siteId={siteId} mode="visit" variant="desktop" />
          ) : nextEvent?.kind === 'meeting' ? (
            <Link href={nextEvent.href ?? `/sites/${siteId}`} className="inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90">
              Préparer ma réunion
            </Link>
          ) : (
            <Link href={`/semaine?site=${siteId}`} className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              {nextEvent ? 'Voir le planning' : 'Planifier'}
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}

async function DocumentsPreuvesView({ siteId, canExport }: { siteId: string; canExport: boolean }) {
  const [documents, sitePhotos, visitCaptures, proofDossiers, qr] = await Promise.all([
    listDocumentsForTarget('site', siteId).catch(() => []),
    listSitePhotos(siteId).catch(() => []),
    listVisitCapturesBySite(siteId, 200).catch(() => []),
    listSiteProofDossiers(siteId).catch(() => []),
    buildDocumentsQrState(siteId).catch((): DocumentsQrState => ({
      siteName: 'Chantier',
      status: 'none',
      publicUrl: null,
      qrDataUrl: null,
      accessCount: 0,
      generatedAt: null,
      lastAccessedAt: null,
      history: [],
      })),
  ])
  const [photoThumbs, visitPreviews] = await Promise.all([
    getSignedPhotoUrlsThumb(sitePhotos.map((photo) => photo.storagePath)).catch(() => new Map<string, string>()),
    getVisitCapturePreviewUrls(visitCaptures).catch(() => ({} as Record<string, { url: string; mime: string | null }>)),
  ])
  const visitMediaKinds = new Set(['photo', 'video', 'vocal', 'note'])
  const media: SiteMediaSummary[] = [
    ...sitePhotos.map((photo) => ({
      id: `site-photo-${photo.id}`,
      kind: 'photo' as const,
      title: photo.legende || 'Photo chantier',
      detail: photo.source === 'intervention'
        ? 'Photo issue d’une intervention'
        : photo.source === 'action'
          ? 'Photo issue d’une action'
          : 'Photo issue d’une réunion',
      occurredAt: photo.takenAt,
      source: photo.source,
      href: photo.interventionId
        ? `/interventions/${photo.interventionId}`
        : photo.actionId
          ? `/sites/${siteId}/actions`
          : `/sites/${siteId}`,
      thumbUrl: photoThumbs.get(photo.storagePath) ?? null,
    })),
    ...visitCaptures
      .filter((capture): capture is typeof capture & { kind: 'photo' | 'video' | 'vocal' | 'note' } => visitMediaKinds.has(capture.kind))
      .map((capture) => {
        const preview = visitPreviews[capture.id]
        return {
          id: `visit-${capture.id}`,
          kind: capture.kind as SiteMediaSummary['kind'],
          title: capture.body?.trim() || captureKindLabel(capture.kind),
          detail: `Capture de visite${capture.status === 'processed' ? ' traitée' : ''}`,
          occurredAt: capture.captured_at ?? capture.created_at,
          source: 'visit' as const,
          href: `/sites/${siteId}/visites/${capture.report_id}`,
          thumbUrl: capture.kind === 'photo' ? preview?.url ?? null : null,
          previewUrl: preview?.url ?? null,
        }
      }),
  ].sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))

  return (
    <DocumentsWorkspace
      siteId={siteId}
      canExport={canExport}
      documents={documents.map((document) => ({
        id: document.id,
        filename: document.filename,
        document_type: document.document_type,
        created_at: document.created_at,
      }))}
      media={media}
      proofDossiers={proofDossiers}
      qr={qr}
    />
  )
}

function captureKindLabel(kind: string): string {
  if (kind === 'photo') return 'Photo de visite'
  if (kind === 'video') return 'Vidéo de visite'
  if (kind === 'vocal') return 'Mémo vocal de visite'
  if (kind === 'note') return 'Note de visite'
  return 'Capture de visite'
}

async function MemoireView({
  siteId,
  siteName,
  signals,
  interventions,
  teams,
  traceCount,
}: {
  siteId: string
  siteName: string
  signals: MemorySignal[]
  interventions: SupervisorInterventionRow[]
  teams: DbTeam[]
  traceCount: number
}) {
  const [subjects, passations] = await Promise.all([
    listSubjectsBySite(siteId).catch(() => []),
    listHandoverBriefsBySite(siteId).catch(() => []),
  ])

  return (
    <MemoryWorkspace
      siteId={siteId}
      siteName={siteName}
      signals={signals}
      subjects={subjects}
      relays={toSiteRelays(interventions)}
      teams={teams}
      passations={passations}
      traceCount={traceCount}
    />
  )
}

/** Qui connaît ce chantier : uniquement les équipes réellement venues (intervention
 *  terminée ou validée). Une intervention planifiée ne prouve aucune présence. */
function toSiteRelays(interventions: SupervisorInterventionRow[]): SiteRelay[] {
  const byTeam = new Map<string, SiteRelay>()

  for (const intervention of interventions) {
    if (intervention.status !== 'completed' && intervention.status !== 'validated') continue
    const teamId = intervention.assigned_team_id ?? intervention.team?.id
    if (!teamId) continue

    const passage = (intervention.scheduled_for ?? intervention.scheduled_at).slice(0, 10)
    const existing = byTeam.get(teamId)
    if (existing) {
      existing.interventions += 1
      if (!existing.lastPassage || passage > existing.lastPassage) existing.lastPassage = passage
    } else {
      byTeam.set(teamId, {
        id: teamId,
        name: intervention.team?.name ?? 'Équipe',
        lastPassage: passage,
        interventions: 1,
      })
    }
  }

  return [...byTeam.values()].sort((a, b) => (b.lastPassage ?? '').localeCompare(a.lastPassage ?? ''))
}

async function buildDocumentsQrState(siteId: string): Promise<DocumentsQrState> {
  const [info, history] = await Promise.all([
    getSiteQrInfo(siteId),
    getSiteQrHistory(siteId),
  ])

  if (!info) {
    return {
      siteName: 'Chantier',
      status: 'none',
      publicUrl: null,
      qrDataUrl: null,
      accessCount: 0,
      generatedAt: null,
      lastAccessedAt: null,
      history,
    }
  }

  const token = info.token
  const hasRevokedToken = history.some((event) => event.type === 'revoked')
  if (!token) {
    return {
      siteName: info.name,
      status: hasRevokedToken ? 'revoked' : 'none',
      publicUrl: null,
      qrDataUrl: null,
      accessCount: 0,
      generatedAt: null,
      lastAccessedAt: null,
      history,
    }
  }

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const proto = headersList.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_BASE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001'))
  const publicUrl = `${baseUrl}/qr/${token.token}`

  let qrDataUrl: string | null = null
  try {
    qrDataUrl = await QRCode.toDataURL(publicUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  } catch {
    qrDataUrl = null
  }

  return {
    siteName: info.name,
    status: 'active',
    publicUrl,
    qrDataUrl,
    accessCount: token.access_count,
    generatedAt: token.created_at,
    lastAccessedAt: token.last_accessed_at,
    history,
  }
}

function StateCard({
  href,
  icon: Icon,
  tone,
  value,
  title,
  detail,
}: {
  href?: string
  icon: ComponentType<{ className?: string }>
  tone: 'green' | 'orange' | 'red' | 'blue'
  value: number | string
  title: string
  detail: string
}) {
  const content = (
    <>
      <Icon className={cn('h-5 w-5', toneClass[tone].icon)} />
      <div className="mt-5 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </>
  )
  const className = cn('min-h-[128px] rounded-[18px] border p-4 shadow-sm transition', toneClass[tone].bg)
  return href ? (
    <Link href={href} className={cn(className, 'block hover:brightness-[0.98]')}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  )
}

function OverviewPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-h-[232px] rounded-[18px] border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function OverviewRow({
  href,
  icon: Icon,
  tone,
  title,
  detail,
}: {
  href?: string | null
  icon: ComponentType<{ className?: string }>
  tone: 'green' | 'orange' | 'red' | 'blue'
  title: string
  detail?: string | null
}) {
  const inner = (
    <span className="flex items-start gap-3">
      <span className={cn('mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full', toneClass[tone].soft)}>
        <Icon className={cn('h-4 w-4', toneClass[tone].icon)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {detail && <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>}
      </span>
    </span>
  )
  return href ? (
    <Link href={href} className="block rounded-xl p-1.5 hover:bg-muted/60">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl p-1.5">{inner}</div>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

const toneClass = {
  green: {
    bg: 'bg-emerald-50/55 dark:bg-emerald-950/20',
    soft: 'bg-emerald-50 dark:bg-emerald-950/30',
    icon: 'text-emerald-600 dark:text-emerald-300',
  },
  orange: {
    bg: 'bg-orange-50/55 dark:bg-orange-950/20',
    soft: 'bg-orange-50 dark:bg-orange-950/30',
    icon: 'text-orange-600 dark:text-orange-300',
  },
  red: {
    bg: 'bg-red-50/55 dark:bg-red-950/20',
    soft: 'bg-red-50 dark:bg-red-950/30',
    icon: 'text-red-600 dark:text-red-300',
  },
  blue: {
    bg: 'bg-sky-50/55 dark:bg-sky-950/20',
    soft: 'bg-sky-50 dark:bg-sky-950/30',
    icon: 'text-sky-600 dark:text-sky-300',
  },
} as const

function numberStatus(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toOverviewActions(actions: SiteActionRow[], siteId: string): OverviewActionInput[] {
  return actions.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    dueDate: a.due_date,
    createdAt: a.created_at,
    href: `/sites/${siteId}/actions`,
  }))
}

function toBlocageSignals(blocages: Awaited<ReturnType<typeof listBlocagesBySite>>, siteId: string): OverviewSignalInput[] {
  return blocages.map((b) => ({
    id: `blocage-${b.id}`,
    kind: 'blocage_active',
    title: b.title,
    detail: b.impact ?? b.description ?? 'Blocage en cours',
    href: `/sites/${siteId}/reserves`,
  }))
}

function toMemorySignals(signals: MemorySignal[], siteId: string): OverviewSignalInput[] {
  return signals.flatMap((signal) => {
    if (signal.kind === 'action_overdue') {
      return signal.items.slice(0, 2).map<OverviewSignalInput>((item) => ({
        id: `action-${item.id}`,
        kind: 'action_overdue' as const,
        title: item.label,
        detail: item.meta ?? signal.title,
        href: `/sites/${siteId}/actions`,
      }))
    }
    if (signal.kind === 'reserve_open') {
      return signal.items.slice(0, 2).map<OverviewSignalInput>((item) => ({
        id: `reserve-${item.id}`,
        kind: 'reserve_old' as const,
        title: item.label,
        detail: item.meta ?? signal.title,
        href: `/sites/${siteId}/reserves`,
      }))
    }
    if (signal.kind === 'proof_window_closing' || signal.kind === 'obligation_neglected') {
      return [{
        id: `${signal.kind}-${signal.items[0]?.id ?? signal.title}`,
        kind: 'deadline_imminent' as const,
        title: signal.title,
        detail: signal.items[0]?.label ?? null,
        href: null,
      }] satisfies OverviewSignalInput[]
    }
    return []
  })
}

function toActionSignals(actions: SiteActionRow[], todayIso: string, siteId: string): OverviewSignalInput[] {
  return actions
    .filter((a) => a.due_date && a.due_date < todayIso)
    .slice(0, 2)
    .map((a) => ({
      id: `late-${a.id}`,
      kind: 'action_overdue' as const,
      title: a.title,
      detail: getActionDueLabel({ dueDate: a.due_date, status: a.status }, todayIso),
      href: `/sites/${siteId}/actions`,
    }))
}

function toOverviewEvents(currentState: Awaited<ReturnType<typeof getSiteCurrentState>> | null, siteId: string): OverviewEventInput[] {
  if (!currentState?.nextScheduledAt) return []
  return [{
    id: currentState.nextScheduledAt,
    kind: 'intervention',
    title: 'Intervention planifiée',
    startsAt: currentState.nextScheduledAt,
    detail: currentState.nextScheduledSlot,
    href: `/semaine?site=${siteId}`,
  }]
}

function toOverviewChanges(items: RecentActivityItem[]): OverviewChangeInput[] {
  return items.map((item) => {
    const kind = item.kind === 'anomaly'
      ? 'reserve_created'
      : item.kind === 'intervention'
        ? 'intervention_done'
        : item.kind === 'photo'
          ? 'important_document_added'
          : item.kind === 'voice_note'
            ? 'important_document_added'
            : 'note_added'
    return {
      id: `${item.kind}-${item.id}`,
      kind,
      title: item.primary,
      detail: item.secondary,
      occurredAt: item.occurredAt,
      href: item.interventionId ? `/interventions/${item.interventionId}` : null,
    }
  })
}

function attentionIcon(kind: OverviewSignalInput['kind']) {
  if (kind === 'blocage_active') return ShieldAlert
  if (kind === 'action_overdue') return Clock
  if (kind === 'event_upcoming') return Calendar
  return AlertTriangle
}

function attentionTone(kind: OverviewSignalInput['kind']): 'green' | 'orange' | 'red' | 'blue' {
  if (kind === 'blocage_active') return 'red'
  if (kind === 'event_upcoming') return 'blue'
  return 'orange'
}

function formatShortEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatLongEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
