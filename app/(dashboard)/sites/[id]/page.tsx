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
import { listInterventionsSupervisor } from '@/lib/db/interventions'
import { listCyclesBySite } from '@/lib/db/planning-cycles'
import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import { listTeams } from '@/lib/db/teams'
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
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { getSiteGraph } from '@/lib/knowledge/site-graph'
import { getSiteIntervenantsView, getSiteIntervenantFiche } from '@/lib/knowledge/site-intervenants-view'
import { buildIntervenantsDashboard } from '@/lib/knowledge/intervenants-dashboard-model'
import { IntervenantsLeaderboard } from './views/intervenants/IntervenantsLeaderboard'
import { todayLocalIso } from '@/lib/time/local-date'
import { PersistentFicheSheet } from './views/PersistentFicheSheet'
import { getSiteActionFiche } from '@/lib/knowledge/action-fiche'
import { getSiteDecisionFiche } from '@/lib/knowledge/decision-fiche'
import { getSiteCausalThreads } from '@/lib/knowledge/causal-threads'
import { MemoireCausale } from './views/memoire/MemoireCausale'
import { MemoireSubTabs, type MemoireSubTab } from './views/memoire/MemoireSubTabs'
import { ExplorerWorkspace } from './views/explorer/ExplorerWorkspace'
import { logUsageEvent } from '@/lib/db/usage-events'
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
import { SiteTabsNav, resolveSiteTab, type SiteTabKey } from './SiteTabsNav'
import { TogglePanel } from './TogglePanel'
import { DocumentsWorkspace, type DocumentsQrState, type SiteMediaSummary } from './views/documents/DocumentsWorkspace'
import { MemoireConfirmer } from './views/memoire/MemoireConfirmer'
import { WorkWorkspace } from './views/work/WorkWorkspace'
import { SandboxResetButton } from './SandboxResetButton'
import { getSiteOverview, emptySiteOverview } from '@/lib/knowledge/site-overview'
import { ChronologyWorkspace } from './views/chronology/ChronologyWorkspace'
import { PlanningWorkspace } from './views/planning/PlanningWorkspace'
import { getPlanningTimeline } from '@/lib/db/planning-timeline'
import type { PlanningTimelineEvent } from '@/lib/planning/timeline-contract'
import { SiteOverviewTab } from './views/apercu/SiteOverviewTab'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; person?: string; person_source?: string; action?: string; decision?: string; memtab?: string }>
}

type ChantierViewKey = SiteTabKey

// D'où la fiche a été ouverte — l'instrumentation qui tranchera « onglet vs
// fiche partout » (arbitrage 2026-07-18). Toute NOUVELLE porte ajoute sa source.
const FICHE_SOURCES = new Set(['explorer', 'recherche', 'visite', 'reunion', 'decision', 'apercu', 'memoire'])

export default async function SitePage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { tab: rawTab, person: personId, person_source: personSource, action: actionId, decision: decisionId, memtab: rawMemtab } = await searchParams
  const memtab: MemoireSubTab = rawMemtab === 'confirmer' ? 'confirmer' : 'pourquoi'
  const tab: ChantierViewKey = resolveSiteTab(rawTab)

  // « La fiche est le produit » : un `?person=<id>` ouvre la MÊME fiche par
  // dessus n'importe quel onglet. Chargée ici pour être disponible partout.
  const ficheParam = personId
    ? await getSiteIntervenantFiche(id, { intervenantId: personId }).catch(() => null)
    : null
  if (ficheParam && personSource && FICHE_SOURCES.has(personSource)) {
    void logUsageEvent({ event: `intervenant_fiche_opened:${personSource}`, siteId: id })
  }

  // « Plus jamais une simple ligne » (Lot 4) : un `?action=<id>` ouvre la fiche
  // canonique de l'action par-dessus n'importe quel onglet. Fail-closed en amont.
  const actionFiche = actionId ? await getSiteActionFiche(id, actionId).catch(() => null) : null

  // Le PIVOT du chantier : un `?decision=<id>` ouvre la fiche Décision par-dessus
  // n'importe quel onglet (patron miroir de `?action=`). Fail-closed en amont.
  const decisionFiche = decisionId ? await getSiteDecisionFiche(id, decisionId).catch(() => null) : null

  // ── ÉTAPE 1 « Réactivité perçue » ──────────────────────────────────────────
  // Il n'y a PLUS de chargement global. Auparavant, 13 requêtes partaient avant
  // le premier octet de HTML, quel que soit l'onglet : changer d'onglet (ou
  // ouvrir une fiche) re-jouait TOUT, d'où la sensation de rechargement.
  // Désormais chaque onglet paie SES requêtes, et seulement les siennes.
  // Seule l'identité reste commune : l'en-tête l'affiche et le 404 en dépend.
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

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
                <SiteAddMenu siteId={id} />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <SiteTabsNav active={tab} siteId={id} />
          </div>
        </div>

        {tab === 'apercu' ? (
          <SiteOverviewTab siteId={id} />
        ) : tab === 'travail' ? (
          <TravailView siteId={id} />
        ) : tab === 'chronologie' ? (
          <ChronologieView siteId={id} />
        ) : tab === 'planning' ? (
          <PlanningView siteId={id} />
        ) : tab === 'documents-preuves' ? (
          <DocumentsPreuvesView siteId={id} canExport={user.role === 'admin' || user.role === 'manager'} />
        ) : tab === 'intervenants' ? (
          <IntervenantsView siteId={id} />
        ) : tab === 'memoire' ? (
          <MemoireView siteId={id} siteName={identity.name} memtab={memtab} />
        ) : tab === 'explorer' ? (
          <ExplorerView siteId={id} />
        ) : (
          null
        )}
      </ChantierShell>

      {/* La COQUILLE PERSISTANTE (Lot 2 · PR1) : une seule fiche montée par-dessus
          n'importe quel onglet, quel que soit le maillon (?person= / ?action= /
          ?decision=). Naviguer d'un objet à l'autre change le CONTENU sans détruire
          le Sheet — le navigateur ne recrée plus la fiche à chaque saut. */}
      <PersistentFicheSheet siteId={id} person={ficheParam} action={actionFiche} decision={decisionFiche} />
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

// ── LES VUES AUTONOMES ───────────────────────────────────────────────────────
// Chacune charge SES données, et rien d'autre. Un clic sur Intervenants ne paie
// plus les requêtes du Planning. Aucun changement d'affichage : mêmes composants,
// mêmes props — seule la provenance des données a bougé.

async function TravailView({ siteId }: { siteId: string }) {
  // Le cycle de vie d'une action (proposée → ouverte → terminée) vient du MÊME
  // read model que l'Aperçu : une action proposée est la même sur les deux
  // onglets, ou le chantier se contredit.
  const [actions, blocages, missions, interventions, deadlines, overview] = await Promise.all([
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    listBlocagesBySite(siteId).catch(() => []),
    listMissionsBySite(siteId).catch(() => []),
    listInterventionsSupervisor({ siteId, dateRange: 'all', limit: 80 }).catch(() => ({ items: [], total: 0 })),
    listSiteDeadlines(siteId).catch(() => []),
    getSiteOverview(siteId).catch(() => emptySiteOverview(siteId)),
  ])
  return (
    <WorkWorkspace
      siteId={siteId}
      actions={actions}
      blocages={blocages.filter((b) => b.dateEnd === null)}
      missions={missions}
      interventions={interventions.items}
      proposed={overview.actions.proposed}
      proposedTotal={overview.actions.summary.proposed}
      deadlines={deadlines}
      deadlinesProposed={overview.deadlines.summary.proposed}
      completedRecent={overview.actions.completedRecent}
      synthesisHref={overview.activity.lastVisit ? `/m/visite/${overview.activity.lastVisit.reportId}/cr` : undefined}
    />
  )
}

async function ChronologieView({ siteId }: { siteId: string }) {
  const [recentActivity, lastVisit, deadlines, visits, actions, blocages, interventions] = await Promise.all([
    getSiteRecentActivity(siteId, 12).catch(() => []),
    getLastEndedVisitForSite(siteId).catch(() => null),
    listSiteDeadlines(siteId).catch(() => []),
    listSiteVisitsWithCounts(siteId, 8).catch(() => []),
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    listBlocagesBySite(siteId).catch(() => []),
    listInterventionsSupervisor({ siteId, dateRange: 'all', limit: 80 }).catch(() => ({ items: [], total: 0 })),
  ])
  const sinceIso = lastVisit?.endedAt ?? lastVisit?.startedAt ?? null
  const changes = selectRecentChanges(toOverviewChanges(recentActivity), { sinceIso, limit: 5 })
  return (
    <ChronologyWorkspace
      siteId={siteId}
      changes={changes}
      deadlines={deadlines}
      visits={visits}
      actions={actions}
      blocages={blocages}
      interventions={interventions.items}
    />
  )
}

async function PlanningView({ siteId }: { siteId: string }) {
  // La vie datée du chantier — visites, réunions, échéances, interventions. On
  // charge la semaine courante, pour que la grille et les compteurs lisent la
  // même chose.
  const jour = new Date()
  const lundi = new Date(jour); lundi.setDate(jour.getDate() - ((jour.getDay() === 0 ? 7 : jour.getDay()) - 1))
  const dimanche = new Date(lundi); dimanche.setDate(lundi.getDate() + 6)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [currentState, interventions, missions, blocages, cycles, deadlines, teams, timeline] = await Promise.all([
    getSiteCurrentState(siteId).catch(() => null),
    listInterventionsSupervisor({ siteId, dateRange: 'all', limit: 80 }).catch(() => ({ items: [], total: 0 })),
    listMissionsBySite(siteId).catch(() => []),
    listBlocagesBySite(siteId).catch(() => []),
    listCyclesBySite(siteId).catch(() => []),
    listSiteDeadlines(siteId).catch(() => []),
    listTeams().catch(() => []),
    getPlanningTimeline({ from: iso(lundi), to: iso(dimanche) }, { siteIds: [siteId] }).catch((): PlanningTimelineEvent[] => []),
  ])
  return (
    <PlanningWorkspace
      siteId={siteId}
      nextEvent={selectNextEvent(toOverviewEvents(currentState, siteId), new Date().toISOString())}
      interventions={interventions.items}
      missions={missions}
      blocages={blocages.filter((b) => b.dateEnd === null)}
      cycles={cycles}
      deadlines={deadlines}
      teams={teams}
      timeline={timeline}
    />
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

async function IntervenantsView({ siteId }: { siteId: string }) {
  const view = await getSiteIntervenantsView(siteId)
  if (!view) return null
  // La décision « l'onglet a-t-il sa place ? » se prendra sur l'usage réel
  // (arbitrage 2026-07-18 : en observation) — best-effort, ne retarde rien.
  void logUsageEvent({ event: 'intervenants_opened', siteId })
  // Projection leaderboard depuis la MÊME lecture (pas de second fetch) : mêmes
  // personnes, même vérité que la fiche.
  const dashboard = buildIntervenantsDashboard(siteId, view.groups.flatMap((g) => g.people), view.toIdentifyCount, todayLocalIso())
  return <IntervenantsLeaderboard dashboard={dashboard} toIdentify={view.toIdentify} />
}

async function ExplorerView({ siteId }: { siteId: string }) {
  const graph = await getSiteGraph(siteId)
  if (!graph) return null
  // La mesure, dès le premier jour (cadrage) : l'utilise-t-il ? quand ? —
  // best-effort, ne retarde jamais le rendu.
  void logUsageEvent({ event: 'explorer_opened', siteId })
  return <ExplorerWorkspace graph={graph} />
}

async function MemoireView({
  siteId,
  siteName,
  memtab,
}: {
  siteId: string
  siteName: string
  memtab: MemoireSubTab
}) {
  // « Mémoire du chantier » = l'endroit où l'on COMPREND et où l'on VALIDE — pas
  // l'endroit où l'on range tout. Deux axes : Pourquoi ? (chaînes causales) et
  // À confirmer (inbox des propositions IA). La Chronologie canonique vit dans la
  // navigation principale — un lien y renvoie, jamais un doublon. La recherche
  // reste le bloc commun. Même source que la Mémoire terrain (`getMemoryReview`).
  const review = await getMemoryReview(siteId).catch(() => ({ confirmed: [], toReview: [] }))

  // La recherche : commune aux deux lectures, mais jamais au premier plan dans
  // « À confirmer » (le centre y est l'inbox) — elle y passe en second plan.
  const searchBlock = (
    <section className="rounded-xl border bg-card p-3.5 shadow-sm">
      <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Poser une question sur ce chantier</p>
      <SiteMemoryQuery siteId={siteId} />
    </section>
  )

  let content: ReactNode
  if (memtab === 'confirmer') {
    // Signaux et équipes ne servent QU'ICI : « Pourquoi ? » ne les paie plus.
    const [subjects, signals, teams] = await Promise.all([
      listSubjectsBySite(siteId).catch(() => []),
      buildSiteMemorySignals(siteId).catch((): MemorySignal[] => []),
      listTeams().catch((): DbTeam[] => []),
    ])
    content = (
      <MemoireConfirmer
        siteId={siteId}
        siteName={siteName}
        review={review}
        signals={signals}
        subjectsCount={subjects.length}
        teams={teams}
        searchSlot={searchBlock}
      />
    )
  } else {
    // Pourquoi ? — les chaînes causales validées (fils par engagement).
    content = (
      <div className="space-y-5">
        {searchBlock}
        <MemoireCausale threads={(await getSiteCausalThreads(siteId)) ?? []} siteId={siteId} />
      </div>
    )
  }

  return (
    <div>
      <MemoireSubTabs active={memtab} toConfirmCount={review.toReview.length} />
      {content}
    </div>
  )
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

