import { redirect, notFound } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listPlannedEngagementsForSite } from '@/lib/db/engagements'
import { findPendingEngagementFinalizationForSite } from '@/lib/db/materialize-engagement'
import { KIND_ORDER } from '@/lib/engagements/kind'
import { groupPlannedEngagementsBySection } from '@/lib/engagements/section'
import { PlannedEngagementSections } from '@/components/engagements/PlannedEngagementSections'
import { AddPlannedEngagementDialog } from '@/components/engagements/AddPlannedEngagementDialog'
import type { EngagementKind } from '@/types/db'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SiteChantierNav } from '../SiteChantierNav'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Prestations prévues d'un chantier (desktop) — miroir de
 * /m/site/[siteId]/prestations (P0-3, réouvert par Vincent 2026-09-25 : ce
 * point de suivi n'existait que côté mobile). Ce que MemorIA sait devoir être
 * vrai/réalisé sur ce chantier (engagements Porte B validés), distinct de
 * l'onglet Documents. Lecture seule : aucune activation, édition, calendrier,
 * occurrence, comparaison terrain ou Action n'est proposée depuis cette vue.
 */
export default async function SitePrestationsPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  // Même frontière d'organisation que le reste de l'espace chantier
  // (getSiteIdentity → resolveResourceAccess) : un chantier d'une autre
  // organisation reste indiscernable d'un chantier inexistant.
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const engagements = await listPlannedEngagementsForSite(id)
  const sorted = [...engagements].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.createdAt.localeCompare(a.createdAt))
  const sections = groupPlannedEngagementsBySection(sorted)
  const pendingFinalization = sorted.length === 0 ? await findPendingEngagementFinalizationForSite(id) : null
  // P0-3.2 FIX (mandat Vincent 2026-09-25) — le gating d'affichage doit parler
  // le même langage que la mutation autoritaire : le rôle DANS l'organisation
  // du chantier (requireSiteWriteAccess), pas users.role (rôle plateforme,
  // qui peut diverger en multi-org). La garde autoritaire reste côté serveur
  // dans activatePlannedEngagementAction ; ceci n'évite qu'un bouton voué à
  // échouer ou, symétriquement, caché à tort.
  const activationAccess = await requireSiteWriteAccess(id, 'managerOrAdmin')
  const canActivate = activationAccess.ok

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 px-1 pb-10">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="prestations" label="Prestations prévues" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="prestations" />

      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
            Prestations prévues
          </h1>
          <AddPlannedEngagementDialog siteId={id} />
        </div>
        <p className="text-sm text-muted-foreground">
          Ce que MemorIA sait devoir être vrai sur ce chantier — engagements validés, issus des documents contractuels ou ajoutés manuellement.
        </p>
      </header>

      {sorted.length === 0 ? (
        pendingFinalization ? (
          <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingFinalizationMessage(pendingFinalization.count)}
            </p>
            <a
              href={`/documents/${pendingFinalization.documentId}/extraction/${pendingFinalization.runId}`}
              className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              {`Finaliser les ${pendingFinalization.count} Engagement${pendingFinalization.count > 1 ? 's' : ''}`}
            </a>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Aucun engagement validé pour ce chantier.</p>
          </div>
        )
      ) : (
        <PlannedEngagementSections groups={sections} gridClassName="grid gap-3 md:grid-cols-2" canActivate={canActivate} />
      )}
    </div>
  )
}

function pendingFinalizationMessage(count: number): string {
  const s = count > 1 ? 's' : ''
  const avoir = count > 1 ? 'ont' : 'a'
  return `${count} proposition${s} contractuelle${s} ${avoir} été acceptée${s} mais n'${avoir} pas encore été créée${s} comme Engagement${s}.`
}

function kindRank(kind: EngagementKind | null): number {
  if (!kind) return KIND_ORDER.length
  const idx = KIND_ORDER.indexOf(kind)
  return idx === -1 ? KIND_ORDER.length : idx
}
