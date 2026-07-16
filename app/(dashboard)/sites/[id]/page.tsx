import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, CalendarPlus, Search } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { listMissionsBySite } from '@/lib/db/missions'
import { listInterventionsSupervisor, type SupervisorInterventionRow } from '@/lib/db/interventions'
import { listCyclesBySite } from '@/lib/db/planning-cycles'
import { listTeams } from '@/lib/db/teams'
import { listHandoverBriefsBySite } from '@/lib/db/handover'
import type { DbTeam } from '@/types/db'
import {
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
import {
  selectNextEvent,
  selectRecentChanges,
  type OverviewChangeInput,
  type OverviewEventInput,
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
import { SandboxResetButton } from './SandboxResetButton'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { ChronologyWorkspace } from './views/chronology/ChronologyWorkspace'
import { PlanningWorkspace } from './views/planning/PlanningWorkspace'
import { SiteOverviewTab } from './views/apercu/SiteOverviewTab'

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

  // L'onglet Aperçu ne figure PAS ici : il lit son propre read model (SiteOverview).
  // Ces chargeurs servent les autres onglets, qui recevront le leur à leur tour.
  const [
    identity,
    openActions,
    blocages,
    currentState,
    recentActivity,
    lastVisit,
    memorySignals,
    visits,
    missions,
    interventionsResult,
    cycles,
    teams,
  ] = await Promise.all([
    getSiteIdentity(id),
    listOpenSiteActions({ siteIds: [id] }).catch(() => []),
    listBlocagesBySite(id).catch(() => []),
    getSiteCurrentState(id).catch(() => null),
    getSiteRecentActivity(id, 12).catch(() => []),
    getLastEndedVisitForSite(id).catch(() => null),
    buildSiteMemorySignals(id).catch(() => []),
    listSiteVisitsWithCounts(id, 8).catch(() => []),
    listMissionsBySite(id).catch(() => []),
    listInterventionsSupervisor({ siteId: id, dateRange: 'all', limit: 80 }).catch(() => ({ items: [], total: 0 })),
    listCyclesBySite(id).catch(() => []),
    listTeams().catch(() => []),
  ])

  if (!identity) notFound()

  // L'onglet Travail montre le cycle de vie d'une action (proposée → ouverte →
  // terminée). Ces titres viennent du MÊME read model que l'Aperçu : une action
  // proposée est la même sur les deux onglets, ou le chantier se contredit.
  const workOverview = tab === 'travail'
    ? await getSiteOverview(id).catch(() => emptySiteOverview(id))
    : emptySiteOverview(id)

  const openBlocages = blocages.filter((b) => b.dateEnd === null)
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
              {/* Le bac à sable dit ce qu'il est, et donne le geste qui le vide.
                  Nulle part ailleurs : un chantier client n'a pas de bouton qui efface. */}
              {identity.isSandbox && (
                <div className="flex justify-start lg:justify-end">
                  <SandboxResetButton siteId={id} />
                </div>
              )}
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
          <SiteOverviewTab siteId={id} />
        ) : tab === 'travail' ? (
          <WorkWorkspace
            siteId={id}
            actions={openActions}
            blocages={openBlocages}
            missions={missions}
            interventions={interventionsResult.items}
            proposed={workOverview.actions.proposed}
            proposedTotal={workOverview.actions.summary.proposed}
            completedRecent={workOverview.actions.completedRecent}
            synthesisHref={workOverview.activity.lastVisit ? `/m/visite/${workOverview.activity.lastVisit.reportId}/cr` : undefined}
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

