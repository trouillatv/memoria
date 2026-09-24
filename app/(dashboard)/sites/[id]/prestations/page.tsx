import { redirect, notFound } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listPlannedEngagementsForSite, type PlannedEngagement } from '@/lib/db/engagements'
import { findPendingEngagementFinalizationForSite } from '@/lib/db/materialize-engagement'
import { categoryLabel, plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { KIND_META, KIND_ORDER, kindLabel } from '@/lib/engagements/kind'
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
  const pendingFinalization = sorted.length === 0 ? await findPendingEngagementFinalizationForSite(id) : null

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
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
          Prestations prévues
        </h1>
        <p className="text-sm text-muted-foreground">
          Ce que MemorIA sait devoir être vrai sur ce chantier — engagements contractuels validés (CCTP/CCAP).
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
            <p className="text-sm text-muted-foreground">Aucun engagement contractuel validé pour ce chantier.</p>
          </div>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sorted.map((e) => (
            <PlannedEngagementCard key={e.id} engagement={e} />
          ))}
        </ul>
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

function PlannedEngagementCard({ engagement: e }: { engagement: PlannedEngagement }) {
  const statusBadge = e.status === 'active'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  const kindBadge = e.kind ? KIND_META[e.kind].badge : 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

  return (
    <li className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{e.shortLabel}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
          {plannedEngagementStatusLabel(e.status)}
        </span>
      </div>

      {e.primaryProvenance.frequencyRaw && (
        <p className="text-sm font-medium text-foreground">{e.primaryProvenance.frequencyRaw}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindBadge}`}>
          {kindLabel(e.kind)}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {categoryLabel(e.category)}
        </span>
        {e.measurable && (
          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            Mesurable
          </span>
        )}
      </div>

      <ProvenanceLine provenance={e.primaryProvenance} />

      {e.additionalProvenance.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            + {e.additionalProvenance.length} autre{e.additionalProvenance.length > 1 ? 's' : ''} preuve{e.additionalProvenance.length > 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-2 border-t border-border pt-2">
            {e.additionalProvenance.map((p, i) => (
              <li key={i}>
                <ProvenanceLine provenance={p} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function ProvenanceLine({ provenance: p }: { provenance: PlannedEngagement['primaryProvenance'] }) {
  const source = [p.documentFilename ?? 'Document', p.pageNumber ? `p.${p.pageNumber}` : null].filter(Boolean).join(' · ')
  return (
    <div className="space-y-0.5">
      <p className="truncate text-xs text-muted-foreground">{source}</p>
      {p.excerpt && <p className="text-xs italic text-muted-foreground/80 line-clamp-2">« {p.excerpt} »</p>}
    </div>
  )
}
