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

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { getSiteMemoryTimeline } from '@/lib/db/site-memory'
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
import { SiteReadingsList } from './SiteReadingsList'
import { SitePhotoGallery } from './SitePhotoGallery'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SitePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params

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
  ])

  // Transmission (IA de continuité) — dépend de la continuity déjà chargée.
  // Vincent 2026-05-15 : "Quand Moana reprend un site, on lui montre les
  // bribes de mémoire laissées par Anaïs."
  const transmissions = await getSiteTransmissionReadings(id, continuity)
  // V5.1.4 — Plafond 6 fragments max (Vincent 2026-05-15) :
  // "L'IA qui parle tout le temps devient du bruit."
  const enrichedReadings = {
    readings: [...transmissions, ...readings.readings].slice(0, 6),
  }

  if (!identity) notFound()

  return (
    <div className="space-y-6 max-w-4xl">
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

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <MapPin className="h-5 w-5 text-sky-600" />
          {identity.name}
        </h1>
        <IdentityHeader site={identity} />
      </header>

      {aSavoirActive.length > 0 && (
        <ASavoirManager siteId={id} active={aSavoirActive} />
      )}

      {/* COUCHE 1 — Cockpit opérationnel : 4 stats inline, sans carte. */}
      {/* Suppression du Card wrapper → les lectures remontent à l'écran.  */}
      <div className="pb-2 border-b border-border/40">
        <CurrentState state={currentState} />
      </div>

      {/* COUCHE 3 — Lectures du lieu (IA perceptive) — toujours visible */}
      <Card className="bg-[#fafaf7] border-foreground/10">
        <CardHeader>
          <CardTitle className="text-base font-medium">Lectures du lieu</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 pb-6">
          <SiteReadingsList data={enrichedReadings} />
        </CardContent>
      </Card>

      {/* Mémoire du lieu — remontée */}
      <Card>
        <CardHeader>
          <CardTitle>Mémoire du lieu</CardTitle>
        </CardHeader>
        <CardContent>
          <TraceStream events={timeline} meta={memoryMeta} />
        </CardContent>
      </Card>

      {/* COUCHE 2 — Rythme | Équipes & photos (fusionnés) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rythme du lieu</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteRhythm days={rhythm} />
          </CardContent>
        </Card>

        <Card>
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

      <Card>
        <CardHeader>
          <CardTitle>Anomalies</CardTitle>
        </CardHeader>
        <CardContent>
          <AnomaliesList anomalies={anomalies} meta={memoryMeta} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <CardTitle>Ce qui revient</CardTitle>
            </CardHeader>
            <CardContent>
              <WhatReturnsHere data={whatReturns} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Activité récente — bas, compact */}
      <Card>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentActivity items={recentActivity} />
        </CardContent>
      </Card>
    </div>
  )
}
