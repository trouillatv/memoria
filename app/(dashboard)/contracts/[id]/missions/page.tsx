import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { getContract } from '@/lib/db/contracts'
import { listSitesByContract } from '@/lib/db/sites'
import { listMissionsByContract } from '@/lib/db/missions'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { ContractTabs } from '../contract-tabs'
import { DynamicCrumb } from '@/components/layout/BreadcrumbProvider'

const CADENCE_LABELS: Record<string, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  biweekly: 'Bimensuelle',
  monthly: 'Mensuelle',
  on_demand: 'À la demande',
}

export default async function ContractMissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ site?: string }>
}) {
  await requireDeskUser()
  const { id } = await params
  const { site: filterSiteId } = await searchParams
  const contract = await getContract(id)
  if (!contract) notFound()

  const [sites, allMissions, engagements] = await Promise.all([
    listSitesByContract(id),
    listMissionsByContract(id),
    listEngagementsByContract(id),
  ])

  const siteById = new Map(sites.map((s) => [s.id, s]))
  const engagementById = new Map(engagements.map((e) => [e.id, e]))

  const missions = filterSiteId
    ? allMissions.filter((m) => m.site_id === filterSiteId)
    : allMissions

  const filterSite = filterSiteId ? siteById.get(filterSiteId) : null

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId={contract.id} label={contract.name} />
      <header>
        <h1 className="text-2xl font-semibold">{contract.name}</h1>
        <p className="text-sm text-muted-foreground">{contract.client_name}</p>
      </header>

      <ContractTabs contractId={id} active="missions" />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Missions ({missions.length})
            {filterSite && (
              <span className="text-xs font-normal normal-case ml-2 text-muted-foreground">
                · filtrées sur {filterSite.name}{' '}
                <Link href={`/contracts/${id}/missions`} className="underline">(reset)</Link>
              </span>
            )}
          </h2>
          {sites.length > 0 && (
            <Link
              href={`/contracts/${id}/missions/new${filterSiteId ? `?site=${filterSiteId}` : ''}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle mission
            </Link>
          )}
        </div>

        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Ajoutez d&apos;abord un chantier dans l&apos;onglet <Link href={`/contracts/${id}/sites`} className="underline">Chantiers</Link>.
          </p>
        ) : missions.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucune mission. Créez-en une pour commencer à organiser le travail terrain.
          </p>
        ) : (
          <ul className="space-y-2">
            {missions.map((m) => {
              const site = siteById.get(m.site_id)
              const linkedEngagements = m.engagement_ids
                .map((eid) => engagementById.get(eid))
                .filter((e): e is NonNullable<typeof e> => !!e)
              return (
                <li key={m.id} className="rounded-lg border p-4 bg-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {site?.name ?? '—'} · {CADENCE_LABELS[m.cadence] ?? m.cadence}
                      </div>
                    </div>
                    <Link
                      href={`/contracts/${id}/missions/${m.id}/edit`}
                      className="text-xs text-foreground hover:underline whitespace-nowrap shrink-0"
                    >
                      Éditer →
                    </Link>
                  </div>
                  {m.description && <p className="text-xs text-muted-foreground mb-2">{m.description}</p>}
                  {linkedEngagements.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Engagements couverts :</span>
                      {linkedEngagements.map((e) => (
                        <span key={e.id} className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium bg-emerald-50 border-emerald-200 text-emerald-700">
                          {e.short_label}
                        </span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(m.default_checklist) && m.default_checklist.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {m.default_checklist.length} item{m.default_checklist.length > 1 ? 's' : ''} dans la checklist
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
