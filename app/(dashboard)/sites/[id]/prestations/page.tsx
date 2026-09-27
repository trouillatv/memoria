import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listPlannedEngagementsForSite, getMissionsForEngagements } from '@/lib/db/engagements'
import { getActionsForEngagements } from '@/lib/db/site-action-engagement-links'
import { findPendingEngagementFinalizationForSite } from '@/lib/db/materialize-engagement'
import { KIND_ORDER, kindLabel } from '@/lib/engagements/kind'
import { CATEGORY_LABELS, categoryLabel } from '@/lib/engagements/labels'
import {
  groupPlannedEngagementsBySection,
  computePlannedEngagementSynthesis,
  computePlannedEngagementTabCounts,
  filterPlannedEngagements,
  PLANNED_ENGAGEMENT_TAB_ORDER,
  type PlannedEngagementTabKey,
} from '@/lib/engagements/section'
import { PlannedEngagementSections } from '@/components/engagements/PlannedEngagementSections'
import { PlannedEngagementSynthesisHeader } from '@/components/engagements/PlannedEngagementSynthesisHeader'
import { PlannedEngagementStatusTabs } from '@/components/engagements/PlannedEngagementStatusTabs'
import { AddPlannedEngagementDialog } from '@/components/engagements/AddPlannedEngagementDialog'
import { FiltersBar } from '@/components/ui/filters-bar'
import { FilterSelect } from '@/components/ui/filter-select'
import type { EngagementCategory, EngagementKind } from '@/types/db'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SiteChantierNav } from '../SiteChantierNav'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    tab?: string
    kind?: string
    category?: string
    provenance?: string
    document?: string
    search?: string
  }>
}

/**
 * Prestations prévues d'un chantier (desktop) — miroir de
 * /m/site/[siteId]/prestations (P0-3, réouvert par Vincent 2026-09-25 : ce
 * point de suivi n'existait que côté mobile). Ce que MemorIA sait devoir être
 * vrai/réalisé sur ce chantier (engagements Porte B validés), distinct de
 * l'onglet Documents. Édition/calendrier/occurrence/comparaison terrain
 * restent hors scope. P0-3.2 (même jour) a ouvert l'activation d'un
 * engagement curated ; « Traiter un point » (même jour) ouvre la création
 * d'une Action depuis un engagement actif — jamais automatique, seulement sur
 * confirmation humaine explicite (motif + description), cf.
 * EngagementTreatPointButton.
 *
 * PLAN-UX-1D (mandat Vincent 2026-09-27) — la page devient réellement
 * pilotable : onglets par état de pilotage (Tous / À mettre en vigueur /
 * À organiser / À planifier / Avec action ouverte) + filtres avancés
 * (Nature/Catégorie/Provenance/Document source/Recherche texte). Tab et
 * filtres sont URL-driven (searchParams), même architecture que /preuves —
 * aucun état client, tout est partageable/rechargeable. La synthèse chiffrée
 * et les compteurs d'onglets restent calculés sur l'ensemble COMPLET des
 * engagements du chantier (jamais affectés par les filtres actifs) ; seule la
 * liste de cartes (groupPlannedEngagementsBySection) reflète le sous-ensemble
 * filtré.
 */
export default async function SitePrestationsPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const sp = await searchParams
  // Même frontière d'organisation que le reste de l'espace chantier
  // (getSiteIdentity → resolveResourceAccess) : un chantier d'une autre
  // organisation reste indiscernable d'un chantier inexistant.
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const engagements = await listPlannedEngagementsForSite(id)
  const sorted = [...engagements].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.createdAt.localeCompare(a.createdAt))
  // ENG-UX-1 LOT D (mandat Vincent 2026-09-26) — Organisation (Missions) + Actions
  // liées, batchées (LOT B/C), pour que la carte Engagement montre ce qui a déjà
  // été traité sans jamais griser/labelliser « Traité » l'Engagement lui-même.
  const engagementIds = sorted.map((e) => e.id)
  const [missionsByEngagement, actionsByEngagement, pendingFinalization] = await Promise.all([
    getMissionsForEngagements(engagementIds),
    getActionsForEngagements(engagementIds),
    sorted.length === 0 ? findPendingEngagementFinalizationForSite(id) : Promise.resolve(null),
  ])
  // P0-3.2 FIX (mandat Vincent 2026-09-25) — le gating d'affichage doit parler
  // le même langage que la mutation autoritaire : le rôle DANS l'organisation
  // du chantier (requireSiteWriteAccess), pas users.role (rôle plateforme,
  // qui peut diverger en multi-org). La garde autoritaire reste côté serveur
  // dans activatePlannedEngagementAction ; ceci n'évite qu'un bouton voué à
  // échouer ou, symétriquement, caché à tort.
  const activationAccess = await requireSiteWriteAccess(id, 'managerOrAdmin')
  const canActivate = activationAccess.ok

  const activeTab: PlannedEngagementTabKey = (PLANNED_ENGAGEMENT_TAB_ORDER as string[]).includes(sp.tab ?? '')
    ? (sp.tab as PlannedEngagementTabKey)
    : 'all'
  const kindFilter: EngagementKind | null | undefined =
    !sp.kind ? undefined : sp.kind === 'none' ? null : (sp.kind as EngagementKind)
  const categoryFilter = (sp.category as EngagementCategory | undefined) || undefined
  const provenanceFilter = sp.provenance === 'manual' || sp.provenance === 'document' ? sp.provenance : undefined
  const documentFilter = sp.document || undefined
  const searchFilter = sp.search || undefined

  const tabCounts = computePlannedEngagementTabCounts(sorted, missionsByEngagement, actionsByEngagement)
  const filtered = filterPlannedEngagements(sorted, missionsByEngagement, actionsByEngagement, {
    tab: activeTab,
    kind: kindFilter,
    category: categoryFilter,
    provenance: provenanceFilter,
    documentFilename: documentFilter,
    search: searchFilter,
  })
  const sections = groupPlannedEngagementsBySection(filtered)

  const kindsPresent = new Set(sorted.map((e) => e.kind))
  const kindOptions: Array<{ value: string; label: string }> = KIND_ORDER.filter((k) => kindsPresent.has(k)).map((k) => ({ value: k, label: kindLabel(k) }))
  if (kindsPresent.has(null)) kindOptions.push({ value: 'none', label: 'Non typé' })

  const categoriesPresent = new Set(sorted.map((e) => e.category))
  const categoryOptions = (Object.keys(CATEGORY_LABELS) as EngagementCategory[])
    .filter((c) => categoriesPresent.has(c))
    .map((c) => ({ value: c, label: categoryLabel(c) }))

  const hasManualProvenance = sorted.some((e) => e.primaryProvenance.documentId === null)
  const hasDocumentProvenance = sorted.some((e) => e.primaryProvenance.documentId !== null)
  const provenanceOptions: Array<{ value: string; label: string }> = []
  if (hasManualProvenance) provenanceOptions.push({ value: 'manual', label: 'Créé manuellement' })
  if (hasDocumentProvenance) provenanceOptions.push({ value: 'document', label: 'Issu d’un document' })

  const documentOptions = Array.from(
    new Set(sorted.map((e) => e.primaryProvenance.documentFilename).filter((f): f is string => !!f)),
  )
    .sort()
    .map((f) => ({ value: f, label: f }))

  const hasActiveFilters = Boolean(sp.kind || sp.category || sp.provenance || sp.document || sp.search)
  const otherTabParams = {
    kind: sp.kind,
    category: sp.category,
    provenance: sp.provenance,
    document: sp.document,
    search: sp.search,
  }

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
        <>
          <PlannedEngagementSynthesisHeader synthesis={computePlannedEngagementSynthesis(sorted, missionsByEngagement, actionsByEngagement)} />

          <PlannedEngagementStatusTabs
            active={activeTab}
            counts={tabCounts}
            siteId={id}
            otherParams={otherTabParams}
          />

          <FiltersBar
            searchPlaceholder="Rechercher un engagement…"
            hasActiveFilters={hasActiveFilters}
            resetParams={['kind', 'category', 'provenance', 'document', 'search']}
          >
            <FilterSelect paramName="kind" label="Nature" options={kindOptions} />
            <FilterSelect paramName="category" label="Catégorie" options={categoryOptions} />
            {provenanceOptions.length > 1 && (
              <FilterSelect paramName="provenance" label="Provenance" options={provenanceOptions} />
            )}
            {documentOptions.length > 0 && (
              <FilterSelect paramName="document" label="Document source" options={documentOptions} />
            )}
          </FiltersBar>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">Aucun engagement ne correspond à ces filtres.</p>
              <Link
                href={`/sites/${id}/prestations`}
                className="text-sm text-foreground underline underline-offset-4"
              >
                Réinitialiser les filtres
              </Link>
            </div>
          ) : (
            <PlannedEngagementSections groups={sections} gridClassName="grid gap-3 md:grid-cols-2" siteId={id} canActivate={canActivate} canPlan={canActivate} canTreatPoint={canActivate} missionsByEngagement={missionsByEngagement} actionsByEngagement={actionsByEngagement} />
          )}
        </>
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
