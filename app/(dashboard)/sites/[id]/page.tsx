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
  Clock,
  Filter,
  History,
  Layers,
  ListTodo,
  MoreHorizontal,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import {
  buildSiteStatusSummary,
  getLastEndedVisitForSite,
  listSiteVisitsWithCounts,
  type VisitWithCounts,
} from '@/lib/db/visits'
import {
  getSiteCurrentState,
  getSiteIdentity,
  getSiteRecentActivity,
  type RecentActivityItem,
} from '@/lib/db/site-cockpit'
import { buildSiteMemorySignals, type MemorySignal } from '@/lib/db/site-memory-signals'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { listSiteProofDossiers } from '@/lib/db/proof-dossier'
import { getSiteQrHistory, getSiteQrInfo } from '@/lib/db/site-qr'
import { listSubjectsBySite } from '@/lib/db/subjects'
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
import { SiteBriefButton } from './SiteBriefButton'
import { SiteAddMenu } from './SiteAddMenu'
import { SiteMemoryQuery } from './SiteMemoryQuery'
import { SiteTabsNav, SITE_TAB_KEYS, type SiteTabKey } from './SiteTabsNav'
import { TogglePanel } from './TogglePanel'
import {
  SiteChronologyComposition,
} from './SiteViewComposition'
import { DocumentsWorkspace, type DocumentsQrState } from './views/documents/DocumentsWorkspace'
import { MemoryWorkspace } from './views/memory/MemoryWorkspace'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

type ChantierViewKey = SiteTabKey | 'organisation'
const CHANTIER_VIEW_KEYS = [...SITE_TAB_KEYS, 'organisation'] as const

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
                <SiteAddMenu siteId={id} />
                <OrganizationMenu siteId={id} />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <SiteTabsNav active={tab === 'organisation' ? 'apercu' : tab} siteId={id} />
          </div>
        </div>

        {tab === 'apercu' ? (
          <ChantierOverview
            siteId={id}
            openActionsCount={openActions.length}
            openReservesCount={openReserves}
            openBlocagesCount={openBlocages.length}
            nextEvent={nextEvent}
            attention={attention}
            priorityActions={priorityActions}
            recentChanges={recentChanges}
          />
        ) : tab === 'travail' ? (
          <TravailView siteId={id} actions={actions} attention={attention} />
        ) : tab === 'chronologie' ? (
          <ChronologieView siteId={id} changes={recentChanges} visits={visits} />
        ) : tab === 'planning' ? (
          <PlanningView siteId={id} nextEvent={nextEvent} />
        ) : tab === 'documents-preuves' ? (
          <DocumentsPreuvesView siteId={id} canExport={user.role === 'admin' || user.role === 'manager'} />
        ) : tab === 'memoire' ? (
          <MemoireView siteId={id} signals={memorySignals} />
        ) : tab === 'organisation' ? (
          <OrganisationView />
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
  openReservesCount,
  openBlocagesCount,
  nextEvent,
  attention,
  priorityActions,
  recentChanges,
}: {
  siteId: string
  openActionsCount: number
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

function TravailView({
  siteId,
  actions,
  attention,
}: {
  siteId: string
  actions: OverviewActionInput[]
  attention: OverviewSignalInput[]
}) {
  const todayIso = todayLocalIso()
  const todo = selectPriorityActions(actions, { todayIso, limit: 8 })

  return (
    <main className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <ViewIntro
          icon={ListTodo}
          title="Travail"
          question="Que dois-je faire, suivre ou lever sur ce chantier ?"
          detail="Actions, réserves, blocages et échéances à traiter."
        />
        <FilterPanel
          title="Filtres de suivi"
          items={['Tout', 'En retard', "Aujourd'hui", 'Cette semaine', 'Sans échéance']}
        />
      </aside>
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">À traiter</h2>
            <p className="text-sm text-muted-foreground">Les éléments les plus actionnables remontent en premier.</p>
          </div>
          <Link href={`/sites/${siteId}/actions`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
            Ouvrir les actions
          </Link>
        </div>
        {todo.length > 0 ? (
          <div className="divide-y rounded-2xl border">
            {todo.map((action) => (
              <Link key={action.id} href={action.href ?? `/sites/${siteId}/actions`} className="grid gap-2 p-4 hover:bg-muted/40 md:grid-cols-[1fr_150px_110px] md:items-center">
                <span className="font-medium">{action.title}</span>
                <span className={cn('text-sm', toneClass[getActionDueTone(action, todayIso)].icon)}>{getActionDueLabel(action, todayIso)}</span>
                <span className="text-sm text-muted-foreground">{action.status === 'planned' ? 'Planifiée' : 'Ouverte'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyLine>Aucun travail ouvert pour ce chantier.</EmptyLine>
        )}
        {attention.length > 0 && (
          <div className="mt-5 rounded-2xl border bg-orange-50/40 p-4 dark:bg-orange-950/15">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">À surveiller</h3>
            <div className="grid gap-2 md:grid-cols-3">
              {attention.map((signal) => (
                <OverviewRow key={signal.id} href={signal.href} icon={attentionIcon(signal.kind)} tone={attentionTone(signal.kind)} title={signal.title} detail={signal.detail} />
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

function ChronologieView({
  siteId,
  changes,
  visits,
}: {
  siteId: string
  changes: OverviewChangeInput[]
  visits: VisitWithCounts[]
}) {
  const flux = visits.length > 0 ? (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Visites terrain</h2>
            <p className="text-sm text-muted-foreground">Les dernières visites capturées sur ce chantier.</p>
          </div>
          <Link href={`/sites/${siteId}/visites`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
            Voir toutes les visites
          </Link>
        </div>
        <VisitTimeline visits={visits} siteId={siteId} />
      </div>
      {changes.length > 0 && (
        <div className="border-t pt-5">
          <h2 className="mb-4 text-lg font-semibold">Autres changements</h2>
          <TimelineList changes={changes} />
        </div>
      )}
    </div>
  ) : changes.length > 0 ? (
    <TimelineList changes={changes} />
  ) : (
    <SmartEmptyState
      icon={History}
      title="Aucun événement significatif récemment."
      detail="Les visites, réunions, interventions, réserves, blocages, décisions et preuves apparaîtront ici."
    />
  )

  return <SiteChronologyComposition siteId={siteId}>{flux}</SiteChronologyComposition>
}

function PlanningView({ siteId, nextEvent }: { siteId: string; nextEvent: OverviewEventInput | null }) {
  return (
    <main className="grid gap-5 xl:grid-cols-[1fr_300px]">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Planning du chantier</h2>
            <p className="text-sm text-muted-foreground">Qui vient quand, et pour quoi faire.</p>
          </div>
          <Link href={`/semaine?site=${siteId}`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
            Ouvrir la semaine
          </Link>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.'].map((day) => (
            <div key={day} className="min-h-[260px] rounded-2xl border bg-muted/20 p-3">
              <p className="text-sm font-semibold">{day}</p>
              {nextEvent && day === 'Mar.' ? (
                <div className="mt-4 rounded-xl border bg-sky-50 p-3 text-sm dark:bg-sky-950/20">
                  <p className="font-medium">{nextEvent.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatLongEventDate(nextEvent.startsAt)}</p>
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">Rien de planifié.</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-4">
        <SideSummary
          title="Cette semaine"
          rows={[
            ['Interventions', nextEvent?.kind === 'intervention' ? '1' : '0'],
            ['Visites', nextEvent?.kind === 'visit' ? '1' : '0'],
            ['Réunions', nextEvent?.kind === 'meeting' ? '1' : '0'],
            ['Équipe prévue', 'Non affectée'],
          ]}
        />
        <OverviewPanel title="Contraintes">
          <EmptyLine>Aucune contrainte planifiée.</EmptyLine>
        </OverviewPanel>
      </aside>
    </main>
  )
}

async function DocumentsPreuvesView({ siteId, canExport }: { siteId: string; canExport: boolean }) {
  const [documents, proofDossiers, qr] = await Promise.all([
    listDocumentsForTarget('site', siteId).catch(() => []),
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
      proofDossiers={proofDossiers}
      qr={qr}
    />
  )
}

async function MemoireView({ siteId, signals }: { siteId: string; signals: MemorySignal[] }) {
  const subjects = await listSubjectsBySite(siteId).catch(() => [])

  return <MemoryWorkspace siteId={siteId} signals={signals} subjects={subjects} />
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

function OrganisationView() {
  return (
    <main className="space-y-5">
      <ViewHeader
        icon={Layers}
        title="Organisation"
        description="Comment ce chantier est structuré, exploité et transmis."
        actions={<InlineFilters items={['Identité', 'Zones', 'Équipes', 'Missions', 'Cycles']} />}
      />
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="divide-y">
          {[
            ['Identité et structure', 'Client, adresse, statut, zones et sous-périmètres.'],
            ['Acteurs', 'Équipes, intervenants, entreprises et référents.'],
            ['Missions et cycles', 'Missions récurrentes, cycles, fermetures et habitudes.'],
            ['Droits et paramètres', 'Droits, rattachements et configuration du chantier.'],
          ].map(([title, detail]) => (
            <div key={title} className="grid gap-2 py-5 first:pt-0 last:pb-0 md:grid-cols-[220px_1fr_auto] md:items-center">
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{detail}</p>
              <span className="text-sm text-muted-foreground">À compléter</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function ViewIntro({
  icon: Icon,
  title,
  question,
  detail,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  question: string
  detail: string
}) {
  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
        <Icon className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm font-medium">{question}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </section>
  )
}

function ViewHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[22px] border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </section>
  )
}

function InlineFilters({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={item}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm',
            index === 0 ? 'bg-foreground text-background' : 'text-muted-foreground',
          )}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function FilterPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Filter className="h-4 w-4" />
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <span
            key={item}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              index === 0 ? 'bg-foreground text-background' : 'text-muted-foreground',
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  )
}

function SmartEmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  detail: string
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function SideSummary({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function TimelineList({ changes }: { changes: OverviewChangeInput[] }) {
  return (
    <ol className="relative space-y-5 border-l border-border pl-5">
      {changes.map((change) => (
        <li key={change.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
          {change.href ? (
            <Link href={change.href} className="block rounded-xl p-2 hover:bg-muted/50">
              <TimelineContent change={change} />
            </Link>
          ) : (
            <div className="rounded-xl p-2">
              <TimelineContent change={change} />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

function VisitTimeline({ visits, siteId }: { visits: VisitWithCounts[]; siteId: string }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {visits.map(({ visit, photos, notes, reserves, actions }) => (
        <li key={visit.id} className="relative">
          <span className="absolute -left-[25px] top-4 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-background" />
          <Link
            href={`/sites/${siteId}/visites/${visit.id}`}
            className="block rounded-2xl border p-4 transition hover:border-foreground/30 hover:bg-muted/30"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{formatVisitDate(visit.started_at ?? visit.created_at)}</p>
                  {!visit.ended_at && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                      En cours
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {visit.objective?.trim() || 'Visite terrain'}
                  {visit.started_at && visit.ended_at ? ` · ${formatDuration(visit.started_at, visit.ended_at)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{photos} photo{photos > 1 ? 's' : ''}</span>
                <span>{notes} note{notes > 1 ? 's' : ''}</span>
                <span>{reserves} réserve{reserves > 1 ? 's' : ''}</span>
                <span>{actions} action{actions > 1 ? 's' : ''}</span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function TimelineContent({ change }: { change: OverviewChangeInput }) {
  return (
    <>
      <p className="text-sm font-semibold">{change.title}</p>
      {change.detail && <p className="mt-1 text-sm text-muted-foreground">{change.detail}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{formatRelativeDate(change.occurredAt)}</p>
    </>
  )
}

function OrganizationMenu({ siteId }: { siteId: string }) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-4 w-4" /> Organisation
      </button>
      <div className="invisible absolute right-0 z-20 mt-2 w-64 rounded-xl border bg-popover p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <MenuLink href={`/sites/${siteId}?tab=organisation`} icon={Layers} label="Ouvrir l'organisation" />
      </div>
    </div>
  )
}

function MenuLink({ href, icon: Icon, label }: { href: string; icon: ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </Link>
  )
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

function formatVisitDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(start: string, end: string): string {
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function formatRelativeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
