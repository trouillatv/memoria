// V5.1.4 — Page Site refondue en style cohérent avec le reste de l'app
// (pattern shadcn, cards, icônes Lucide, palette sémantique sky/emerald/amber).
//
// Doctrine Vincent 2026-05-14 : "toutes les pages sont jolies type Missions —
// celle-ci doit l'être aussi". Le style éditorial paper-crème V5.1.3 était
// une expérimentation qui rompait avec l'app. On revient à la cohérence visuelle.
//
// Les RÈGLES PRODUIT restent strictes (descriptif jamais juge, humains nommés
// jamais qualifiés, pas de KPI humains, pas de scoring agent, pas de
// reverse-lookup individuel). Seul le STYLE s'aligne sur l'app.
//
// Navigation mobile : onglets par ?tab= (search param serveur, 0 JS client).
// Sur desktop (md+), tous les blocs sont toujours visibles — expérience inchangée.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { MapPin, BookOpen, QrCode, Sparkles, ListTodo, ArrowRightLeft, Truck, ClipboardCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import { getSiteMemoryTimeline } from '@/lib/db/site-memory'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { canViewDocument } from '@/lib/documents/access'
import { LinkedDocumentsList } from '@/components/documents/LinkedDocumentsList'
import {
  getSiteIdentity,
  getSiteCurrentState,
  getSiteRecentActivity,
  getSiteAnomalies,
  getSiteHumanContinuity,
  getSiteWhatReturns,
  getSiteRecentRhythm,
  getSiteTeamPresences,
  getSiteReadings,
  getSiteMemoryMeta,
  getSiteTransmissionReadings,
  getSiteRecentPhotos,
} from '@/lib/db/site-cockpit'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { ASavoirManager } from './ASavoirManager'
import { TraceStream } from './TraceStream'
import { IdentityHeader } from './IdentityHeader'
import { CurrentState } from './CurrentState'
import { RecentActivity } from './RecentActivity'
import { AnomaliesList } from './AnomaliesList'
import { HumanContinuityList } from './HumanContinuity'
import { WhatReturnsHere } from './WhatReturnsHere'
import { SiteRhythm } from './SiteRhythm'
import { TeamPresencesList } from './TeamPresencesList'
import { SiteTeamsKnowledgeSection } from './SiteTeamsKnowledgeSection'
import { getSiteTeamsKnowledge } from '@/lib/db/site-team-knowledge'
import { SiteReadingsList } from './SiteReadingsList'
import { SitePhotoGallery } from './SitePhotoGallery'
import { SiteTabsNav, SITE_TAB_KEYS, type SiteTabKey } from './SiteTabsNav'
import { SiteHeatmapCalendar } from './SiteHeatmapCalendar'
import { SiteReportLauncher } from '@/app/(field)/m/site/[siteId]/SiteReportLauncher'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function SitePage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { tab: rawTab } = await searchParams
  const tab: SiteTabKey = (SITE_TAB_KEYS as ReadonlyArray<string>).includes(rawTab ?? '')
    ? (rawTab as SiteTabKey)
    : 'apercu'

  const [
    identity,
    currentState,
    recentActivity,
    anomalies,
    continuity,
    whatReturns,
    aSavoirActive,
    timeline,
    rhythm,
    teamPresences,
    readings,
    memoryMeta,
    sitePhotos,
    siteDocs,
    rhythm90,
  ] = await Promise.all([
    getSiteIdentity(id),
    getSiteCurrentState(id),
    getSiteRecentActivity(id, 10),
    getSiteAnomalies(id),
    getSiteHumanContinuity(id),
    getSiteWhatReturns(id),
    listSiteASavoirActive(id),
    getSiteMemoryTimeline(id, { limit: 200 }),
    getSiteRecentRhythm(id, 14),
    getSiteTeamPresences(id, 14),
    getSiteReadings(id),
    getSiteMemoryMeta(id),
    getSiteRecentPhotos(id, 9),
    listDocumentsForTarget('site', id),
    getSiteRecentRhythm(id, 90),
  ])

  // Actions ouvertes du site (issues des réunions) — « ce qui reste à faire ».
  const openActions = await listOpenSiteActions({ siteIds: [id] }).catch(() => [])

  // CT-2 (Vincent 2026-05-21) — équipes all-time qui ont travaillé sur ce site.
  const teamsKnowledge = await getSiteTeamsKnowledge(id)

  // « Si j'envoyais quelqu'un ici demain » — transmission actionnable. Recompose
  // à savoir + équipes qui connaissent + dernier intervenant (données déjà chargées).
  const transmitItems = aSavoirActive.slice(0, 3).map((n) => n.body)
  const knownTeams = teamsKnowledge
    .filter((t) => t.interventionsDocumentedCount > 0)
    .slice(0, 4)
    .map((t) => t.team_name)
  const lastIntervenant = [...continuity.predecessors]
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))[0]?.firstName ?? null
  const showSendBlock = transmitItems.length > 0 || knownTeams.length > 0 || !!lastIntervenant

  // Transmission (IA de continuité) — dépend de la continuity déjà chargée.
  const transmissions = await getSiteTransmissionReadings(id, continuity)
  const enrichedReadings = {
    readings: [...transmissions, ...readings.readings].slice(0, 6),
  }

  if (!identity) notFound()

  const visibleSiteDocs = siteDocs.filter((d) =>
    canViewDocument(user.role, d.visibility_level),
  )

  // Helpers de visibilité : sur desktop (md+), tout est toujours visible.
  // Sur mobile, seul l'onglet actif s'affiche.
  // Utilise hidden/md:block (ou md:grid) pour éviter tout JS client.
  function tabClass(thisTab: SiteTabKey, displayClass = 'md:block') {
    return tab !== thisTab ? `hidden ${displayClass}` : ''
  }
  function gridTabClass(thisTab: SiteTabKey) {
    // Wrapper de grille : caché sur mobile si mauvais onglet, grid 2-col sur desktop.
    if (tab !== thisTab) return 'hidden md:grid md:grid-cols-2 md:gap-4'
    return 'grid grid-cols-1 md:grid-cols-2 gap-4'
  }
  // Pour la grille mixte Rythme|Équipes : visible si activite OU equipe.
  function mixedGridClass() {
    if (tab !== 'activite' && tab !== 'equipe') return 'hidden md:grid md:grid-cols-2 md:gap-4'
    return 'grid grid-cols-1 md:grid-cols-2 gap-4'
  }

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId={id} label={identity.name} />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Sites' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}
      <Link
        href="/sites"
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← Sites
      </Link>

      <header className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
          <MapPin className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{identity.name}</h1>
          <IdentityHeader site={identity} />
        </div>
      </header>

      <ASavoirManager siteId={id} active={aSavoirActive} />

      {/* Accès rapide — toujours visible, avant les onglets */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/sites/${id}/journal`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Journal
        </Link>
        <Link
          href={`/sites/${id}/livraisons`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]"
        >
          <Truck className="h-3.5 w-3.5" />
          Livraisons
        </Link>
        <Link
          href={`/sites/${id}/reserves`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          Réserves
        </Link>
        <Link
          href={`/sites/${id}/qr`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]"
        >
          <QrCode className="h-3.5 w-3.5" />
          QR Code
        </Link>
        <Link
          href={`/memoire/${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted/40 transition-[transform,colors] active:scale-[0.97]"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Atelier mémoire
        </Link>
        {/* Compte-rendu multimodal — voix + texte + photos + pièces → décisions */}
        <SiteReportLauncher siteId={id} siteName={identity.name} variant="desktop" />
      </div>

      {/* Navigation onglets — mobile uniquement */}
      <SiteTabsNav active={tab} siteId={id} />

      {/* ── APERÇU ───────────────────────────────────────────────────────── */}
      {/* COUCHE 1 — Cockpit opérationnel */}
      <div className={cn('pb-2 border-b border-border/40', tabClass('apercu'))}>
        <CurrentState state={currentState} />
      </div>

      {/* Actions ouvertes — issues des réunions, « ce qui reste à faire ». */}
      {openActions.length > 0 && (
        <Card className={cn('border-l-2 border-l-sky-400/60', tabClass('apercu'))}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-sky-600" />
              Actions ouvertes
              <span className="text-sm font-normal text-muted-foreground">({openActions.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <OpenActionsList actions={openActions} />
          </CardContent>
        </Card>
      )}

      {/* « Si j'envoyais quelqu'un ici demain » — transmission actionnable. */}
      {showSendBlock && (
        <Card className={cn('border-l-2 border-l-violet-400/60', tabClass('apercu'))}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-violet-600" />
              Si vous envoyez une équipe ici demain
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3 text-sm">
            {transmitItems.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">À transmettre</div>
                <ul className="space-y-0.5">
                  {transmitItems.map((t, i) => (
                    <li key={i} className="flex gap-1.5"><span className="text-amber-600" aria-hidden>⚠</span><span className="min-w-0">{t}</span></li>
                  ))}
                </ul>
              </div>
            )}
            {knownTeams.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Équipes qui connaissent déjà le site</div>
                <div className="flex flex-wrap gap-1.5">
                  {knownTeams.map((name) => (
                    <span key={name} className="inline-flex items-center rounded-full border bg-card px-2.5 py-0.5 text-xs">{name}</span>
                  ))}
                </div>
              </div>
            )}
            {lastIntervenant && (
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dernier intervenant</span>
                <span className="ml-2">{lastIntervenant}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── MÉMOIRE ──────────────────────────────────────────────────────── */}
      {/* COUCHE 3 — Lectures du lieu (IA perceptive) */}
      <Card className={cn('bg-[#fafaf7] border-foreground/10', tabClass('memoire'))}>
        <CardHeader>
          <CardTitle className="text-base font-medium">Lectures du lieu</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 pb-6">
          <SiteReadingsList data={enrichedReadings} />
        </CardContent>
      </Card>

      <Card className={cn(tabClass('memoire'))}>
        <CardHeader>
          <CardTitle>Mémoire du lieu</CardTitle>
        </CardHeader>
        <CardContent>
          <TraceStream events={timeline} meta={memoryMeta} />
        </CardContent>
      </Card>

      {/* ── ACTIVITÉ + ÉQUIPE — grille 2-col sur desktop ─────────────────── */}
      {/* Rythme → onglet activite | Équipes+Photos → onglet equipe          */}
      {/* Le wrapper lui-même est hidden si ni activite ni equipe (mobile).   */}
      <div className={mixedGridClass()}>
        <Card className={cn(tabClass('activite'))}>
          <CardHeader>
            <CardTitle>Rythme du lieu</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteRhythm days={rhythm} />
          </CardContent>
        </Card>

        <Card className={cn(tabClass('equipe'))}>
          <CardHeader>
            <CardTitle>Équipes — 14 derniers jours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TeamPresencesList presences={teamPresences} />
            {sitePhotos.length > 0 && (
              <div className="border-t pt-3">
                <SitePhotoGallery photos={sitePhotos} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ACTIVITÉ — Densité 90 jours (heatmap) ───────────────────────── */}
      <Card className={cn(tabClass('activite'))}>
        <CardHeader>
          <CardTitle>Densité — 90 derniers jours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SiteHeatmapCalendar days={rhythm90} />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Chaque carré = un jour. Une colonne = une semaine (lundi en haut,
            dimanche en bas). Les semaines avancent de gauche (plus ancien) à droite
            (cette semaine). Plus la couleur est foncée, plus il y a eu de traces
            ce jour-là. Aujourd&apos;hui : carré entouré.
          </p>
        </CardContent>
      </Card>

      {/* ── ACTIVITÉ — Anomalies ─────────────────────────────────────────── */}
      <Card className={cn(tabClass('activite'))}>
        <CardHeader>
          <CardTitle>Anomalies</CardTitle>
        </CardHeader>
        <CardContent>
          <AnomaliesList anomalies={anomalies} meta={memoryMeta} />
        </CardContent>
      </Card>

      {/* ── ÉQUIPE — all-time ────────────────────────────────────────────── */}
      <div className={tabClass('equipe')}>
        <SiteTeamsKnowledgeSection teams={teamsKnowledge} />
      </div>

      {/* ── MÉMOIRE — Continuité humaine | Ce qui revient (grille) ───────── */}
      <div className={gridTabClass('memoire')}>
        <Card>
          <CardHeader>
            <CardTitle>Continuité humaine</CardTitle>
          </CardHeader>
          <CardContent>
            <HumanContinuityList continuity={continuity} />
          </CardContent>
        </Card>

        {whatReturns.words.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Le lieu vous rappelle</CardTitle>
            </CardHeader>
            <CardContent>
              <WhatReturnsHere data={whatReturns} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── APERÇU — Activité récente ────────────────────────────────────── */}
      <Card className={cn(tabClass('apercu'))}>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentActivity items={recentActivity} />
        </CardContent>
      </Card>

      {/* ── DOCUMENTS ────────────────────────────────────────────────────── */}
      <div className={tabClass('documents')}>
        {visibleSiteDocs.length > 0 ? (
          <Card data-testid="site-documents">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>Documents ({visibleSiteDocs.length})</CardTitle>
              <Link
                href={`/documents/import?target_type=site&target_id=${id}`}
                className="text-xs font-normal text-muted-foreground hover:text-foreground hover:underline"
              >
                Ajouter un document →
              </Link>
            </CardHeader>
            <CardContent>
              <LinkedDocumentsList documents={visibleSiteDocs} />
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Aucun document rattaché à ce chantier.</p>
            <Link
              href={`/documents/import?target_type=site&target_id=${id}`}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Ajouter un document →
            </Link>
          </div>
        )}
      </div>

    </div>
  )
}
