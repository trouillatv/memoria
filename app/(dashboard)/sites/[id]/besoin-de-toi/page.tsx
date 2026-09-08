import { redirect, notFound } from 'next/navigation'
import { HelpCircle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SiteChantierNav } from '../SiteChantierNav'
import { loadMemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { NeedsYouClient } from './NeedsYouClient'

export const dynamic = 'force-dynamic'

// 6E.4A — page dédiée "MemorIA a besoin de toi". Route indépendante (pas un onglet de premier
// niveau, cf. mandat) : même précédent que /actions et /reserves. activeTab="apercu" (aucun
// SiteTabKey dédié n'existe pour cette page — ajouter une entrée SITE_TABS serait une extension
// hors périmètre de ce lot) — SiteTabsNav.resolveSiteTab retombe déjà sur 'apercu' pour toute
// valeur non reconnue, ce choix suit la même doctrine de repli.
export default async function SiteBesoinDeToiPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Aucune des 5 actions de ce lot n'est accessible en 'operator' (managerOrAdmin partout) —
  // même exclusion que /actions pour un chef d'équipe.
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const [summary, pointReadModel] = await Promise.all([
    loadMemoriaNeedsYouSummary(id),
    loadTrackedPointReadModel(id).catch(() => ({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] })),
  ])

  // Liste pour la recherche de suivi du chantier (carte "Quel suivi cette preuve vient-elle
  // résoudre ?") — réutilise le read-model déjà chargé par la file de résolution elle-même,
  // aucune nouvelle requête métier. Seuls les Points actifs sont des cibles valides.
  const sitePoints = pointReadModel.points
    .filter((p) => p.status === 'active')
    .map((p) => ({ id: p.id, label: p.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="besoin-de-toi" label="MemorIA a besoin de toi" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="apercu" />

      <header className="space-y-3">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <HelpCircle className="h-5 w-5" /> MemorIA a besoin de toi
        </h1>
        <p className="text-sm text-muted-foreground">
          {summary.totalCount > 0
            ? `${summary.totalCount} question${summary.totalCount > 1 ? 's' : ''} à clarifier pour garder la mémoire du chantier fiable.`
            : 'Rien à clarifier pour le moment — la mémoire du chantier est à jour.'}
        </p>
      </header>

      <NeedsYouClient siteId={id} questions={summary.questions} categories={summary.categories} sitePoints={sitePoints} />
    </div>
  )
}
