// V5.1.3 — Page Site = cerveau perceptif du produit.
//
// Doctrine Vincent 2026-05-14 :
//   "Un lieu lisible plutôt qu'un lieu monitoré."
//
// Architecture en 7 sections, lecture progressive descendante :
//   1. IDENTITÉ            — le lieu avant les données
//   2. ÉTAT ACTUEL         — 4 chiffres typographiques (glance 3 sec)
//   3. ACTIVITÉ RÉCENTE    — colonne respirante ● / · (vivant)
//   4. ANOMALIES           — bordure-gauche cicatrice persistante
//   5. CONTINUITÉ HUMAINE  — succession nominale, jamais qualifiée
//   6. CE QUI REVIENT      — motifs faibles humains (extraction, pas IA bavarde)
//   7. MÉMOIRE DU LIEU     — substrat fading (lecture lente)
//
// ============================================================
// DOCTRINE WORDING V5.1 — Page Site
// ============================================================
//
// PIÈGE 1 — Empty states félicitants
//   ❌ "Aucune anomalie active." / "Tout va bien sur ce site."
//   ✅ "Aucune anomalie ouverte sur ce site." (statut technique)
//   Règle : un empty state décrit une absence factuelle, jamais positive.
//
// PIÈGE 2 — Modalisateurs et qualifieurs IA
//   ❌ "Mois calme", "Saison agitée", "Site bien tenu"
//   ✅ Compte brut + fenêtre : "3 anomalies ouvertes", "12 passages ce mois"
//   Règle : l'IA sélectionne dans le dépôt humain, jamais qualifieur.
//
// PIÈGE 3 — Qualifications humaines
//   ❌ "Hervé connaissait parfaitement ce lieu."
//   ❌ "Joseph suit ce site avec attention."
//   ✅ "Hervé a tenu ce site 4 ans." (temporel, contextuel)
//   Règle V5.1.3 : les humains peuvent être nommés, jamais qualifiés.
//
// ============================================================

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
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
} from '@/lib/db/site-cockpit'
import { ASavoirManager } from './ASavoirManager'
import { TraceStream } from './TraceStream'
import { IdentityHeader } from './IdentityHeader'
import { CurrentState } from './CurrentState'
import { RecentActivity } from './RecentActivity'
import { AnomaliesList } from './AnomaliesList'
import { HumanContinuityList } from './HumanContinuity'
import { WhatReturnsHere } from './WhatReturnsHere'
import { SectionTitle } from './SectionTitle'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SitePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params

  // Toutes les données chargées en parallèle
  const [identity, currentState, recentActivity, anomalies, continuity, whatReturns, aSavoirActive, timeline] =
    await Promise.all([
      getSiteIdentity(id),
      getSiteCurrentState(id),
      getSiteRecentActivity(id, 10),
      getSiteAnomalies(id),
      getSiteHumanContinuity(id),
      getSiteWhatReturns(id),
      listSiteASavoirActive(id),
      getSiteMemoryTimeline(id, { limit: 200 }),
    ])

  if (!identity) notFound()

  return (
    <div
      className="min-h-screen"
      style={{ background: '#fafafa' }}
    >
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-16">
        <Link
          href="/sites"
          className="text-xs hover:underline inline-flex items-center gap-1"
          style={{ color: '#888' }}
        >
          ← Sites
        </Link>

        <div className="space-y-20 mt-8">
          {/* Section 1 — IDENTITÉ */}
          <IdentityHeader site={identity} />

          {/* À savoir actifs — bloc consigne, juste après l'identité */}
          {aSavoirActive.length > 0 && (
            <ASavoirManager siteId={id} active={aSavoirActive} />
          )}

          {/* Section 2 — ÉTAT ACTUEL */}
          <CurrentState state={currentState} />

          {/* Section 3 — ACTIVITÉ RÉCENTE */}
          <RecentActivity items={recentActivity} />

          {/* Section 4 — ANOMALIES / CICATRICES */}
          <AnomaliesList anomalies={anomalies} />

          {/* Section 5 — CONTINUITÉ HUMAINE */}
          <HumanContinuityList continuity={continuity} />

          {/* Section 6 — CE QUI REVIENT */}
          <WhatReturnsHere data={whatReturns} />

          {/* Section 7 — MÉMOIRE DU LIEU (substrat) */}
          <section className="space-y-4">
            <SectionTitle>Mémoire du lieu</SectionTitle>
            <div className="pt-2">
              <TraceStream events={timeline} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
