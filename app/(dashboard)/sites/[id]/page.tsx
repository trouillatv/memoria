// Page Mémoire du lieu — V5.1 Slice 3 (refonte substrat stratifié).
//
// Doctrine Vincent 2026-05-14 :
//   - Substrat sédimentaire, pas timeline ERP.
//   - Opacity calculée par salience × age decay (côté serveur, pas en DB).
//   - Vides verticaux proportionnels au gap temporel (max 220px).
//   - Cicatrices d'anomalies persistantes (bordure-gauche jamais disparaître).
//   - Aucun titre de section temporelle, aucun chiffre saillant, aucune
//     couleur sémantique alarmiste.
//
// Cf. plan V5.1.2 § Slice 3 + lib/perception/{salience,fading,gaps}.ts.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { MapPin, Building2 } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteById, listSiteASavoirActive } from '@/lib/db/sites'
import { getSiteMemoryTimeline } from '@/lib/db/site-memory'
import { ASavoirManager } from './ASavoirManager'
import { TraceStream } from './TraceStream'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SitePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const site = await getSiteById(id)
  if (!site) notFound()

  // V5.1 — limite remontée à 200 pour donner de la profondeur au substrat.
  // Le compactage visuel (opacity dégradée + gaps) rend la lecture lisible
  // même avec beaucoup d'events. Cf. lib/perception/fading.ts.
  const [aSavoirActive, timeline] = await Promise.all([
    listSiteASavoirActive(id),
    getSiteMemoryTimeline(id, { limit: 200 }),
  ])

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <Link
          href="/sites"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          ← Sites
        </Link>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Building2 className="h-6 w-6 text-brand-600" />
          {site.name}
        </h1>
        {site.address && (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {site.address}
          </p>
        )}
      </header>

      <ASavoirManager siteId={id} active={aSavoirActive} />

      <section>
        {/* V5.1 — pas de compteur (X) dans le titre : la mémoire n'est pas
            un KPI. Le titre reste descriptif. */}
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Mémoire du lieu
        </h2>
        <TraceStream events={timeline} />
      </section>
    </div>
  )
}
