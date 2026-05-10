import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { getContract } from '@/lib/db/contracts'
import { listInterventionsByContract } from '@/lib/db/interventions'
import { listMissionsByContract } from '@/lib/db/missions'
import { listSitesByContract } from '@/lib/db/sites'
import { ContractTabs } from '../contract-tabs'
import { CreateInterventionInline } from './create-intervention-inline'

const STATUS_COLORS: Record<string, string> = {
  planned:     'bg-slate-50 border-slate-200 text-slate-700',
  in_progress: 'bg-sky-50 border-sky-200 text-sky-700',
  completed:   'bg-indigo-50 border-indigo-200 text-indigo-700',
  validated:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  skipped:     'bg-muted border-border text-muted-foreground',
}

const STATUS_LABELS: Record<string, string> = {
  planned:     'Planifiée',
  in_progress: 'En cours',
  completed:   'Terminée',
  validated:   'Validée',
  skipped:     'Annulée',
}

function formatScheduledAt(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }),
    time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }
}

export default async function ContractInterventionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()

  const [interventions, missions, sites] = await Promise.all([
    listInterventionsByContract(id),
    listMissionsByContract(id),
    listSitesByContract(id),
  ])

  const missionById = new Map(missions.map((m) => [m.id, m]))
  const siteById = new Map(sites.map((s) => [s.id, s]))

  // Group by date (YYYY-MM-DD) for visual grouping
  const today = new Date().toISOString().split('T')[0]
  const upcoming = interventions.filter((i) => i.scheduled_at.split('T')[0] >= today)
  const past = interventions.filter((i) => i.scheduled_at.split('T')[0] < today)

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">{contract.name}</h1>
        <p className="text-sm text-muted-foreground">{contract.client_name}</p>
      </header>

      <ContractTabs contractId={id} active="interventions" />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Interventions ({interventions.length})
          </h2>
        </div>

        {missions.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Créez d&apos;abord une mission dans l&apos;onglet <Link href={`/contracts/${id}/missions`} className="underline">Missions</Link>.
          </p>
        ) : (
          <CreateInterventionInline contractId={id} missions={missions} sites={sites} />
        )}

        {upcoming.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
              À venir ({upcoming.length})
            </h3>
            <ul className="space-y-2">
              {upcoming.map((i) => {
                const mission = missionById.get(i.mission_id)
                const site = mission ? siteById.get(mission.site_id) : null
                const { date, time } = formatScheduledAt(i.scheduled_at)
                return (
                  <li key={i.id} className="rounded-lg border p-3 bg-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm font-medium">{date}</span>
                          <span className="text-xs text-muted-foreground">{time}</span>
                        </div>
                        <div className="text-sm">{mission?.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {site?.name ?? '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] uppercase font-semibold tracking-widest ${STATUS_COLORS[i.status] ?? STATUS_COLORS.planned}`}>
                          {STATUS_LABELS[i.status] ?? i.status}
                        </span>
                        <Link
                          href={`/interventions/${i.id}`}
                          className="text-xs hover:underline whitespace-nowrap"
                        >
                          Ouvrir →
                        </Link>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {past.length > 0 && (
          <div className="space-y-2 mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Historique ({past.length})
            </h3>
            <ul className="space-y-2">
              {past.slice(0, 30).map((i) => {
                const mission = missionById.get(i.mission_id)
                const site = mission ? siteById.get(mission.site_id) : null
                const { date, time } = formatScheduledAt(i.scheduled_at)
                return (
                  <li key={i.id} className="rounded-lg border p-3 bg-card opacity-90">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm">{date}</span>
                          <span className="text-xs text-muted-foreground">{time}</span>
                        </div>
                        <div className="text-sm">{mission?.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{site?.name ?? '—'}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] uppercase font-semibold tracking-widest ${STATUS_COLORS[i.status] ?? STATUS_COLORS.planned}`}>
                          {STATUS_LABELS[i.status] ?? i.status}
                        </span>
                        <Link
                          href={`/interventions/${i.id}`}
                          className="text-xs hover:underline whitespace-nowrap"
                        >
                          Ouvrir →
                        </Link>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            {past.length > 30 && (
              <p className="text-xs text-muted-foreground italic">+{past.length - 30} interventions plus anciennes</p>
            )}
          </div>
        )}

        {interventions.length === 0 && missions.length > 0 && (
          <p className="text-sm text-muted-foreground rounded-lg border p-4 mt-2">
            Aucune intervention planifiée. Utilisez le formulaire ci-dessus pour en créer une.
          </p>
        )}
      </section>
    </div>
  )
}
