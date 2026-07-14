import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Calendar, AlertTriangle, Users } from 'lucide-react'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { getContract } from '@/lib/db/contracts'
import { listInterventionsByContract } from '@/lib/db/interventions'
import { listMissionsByContract } from '@/lib/db/missions'
import { listSitesByContract } from '@/lib/db/sites'
import { listTeams } from '@/lib/db/teams'
import { todayLocalIso } from '@/lib/time/local-date'
import { StatusBadge } from '@/components/ui/status-badge'
import { ContractTabs } from '../contract-tabs'
import { CreateInterventionInline } from './create-intervention-inline'
import { DynamicCrumb } from '@/components/layout/BreadcrumbProvider'

// Reçoit une date civile pure (YYYY-MM-DD), JAMAIS un `scheduled_at`.
// Parsé + formaté en UTC pour rester stable quel que soit le fuseau serveur.
function formatDate(civil: string): string {
  const d = new Date(civil + 'T00:00:00.000Z')
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
}

const SLOT_BADGE: Record<string, { label: string; class: string }> = {
  morning: { label: 'matin', class: 'bg-amber-50 border-amber-200 text-amber-900' },
  afternoon: { label: 'après-midi', class: 'bg-sky-50 border-sky-200 text-sky-900' },
  evening: { label: 'soir', class: 'bg-indigo-50 border-indigo-200 text-indigo-900' },
}

function hexToPale(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * 0.12 + 255 * 0.88)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export default async function ContractInterventionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeskUser()
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()

  const [interventions, missions, sites, teams] = await Promise.all([
    listInterventionsByContract(id),
    listMissionsByContract(id),
    listSitesByContract(id),
    listTeams(),
  ])

  const missionById = new Map(missions.map((m) => [m.id, m]))
  const siteById = new Map(sites.map((s) => [s.id, s]))
  const teamById = new Map(teams.map((t) => [t.id, t]))

  // Split À venir / Historique sur la date civile `scheduled_for`, JAMAIS sur
  // `scheduled_at` : ce dernier est un timestamp UTC dérivé du créneau (soir →
  // 18:00 UTC). En Nouméa (UTC+11), dimanche 18:00 UTC = lundi 05:00 → une
  // intervention du dimanche soir basculait à tort dans "À venir". `today`
  // doit aussi être local (todayLocalIso), pas UTC.
  const today = todayLocalIso()
  const civilDate = (i: { scheduled_for: string | null; scheduled_at: string }) =>
    i.scheduled_for ?? i.scheduled_at.slice(0, 10)
  const upcoming = interventions.filter((i) => civilDate(i) >= today)
  const past = interventions.filter((i) => civilDate(i) < today)

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId={contract.id} label={contract.name} />
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
              {upcoming.map((i) => (
                <InterventionRow
                  key={i.id}
                  intervention={i}
                  missionById={missionById}
                  siteById={siteById}
                  teamById={teamById}
                />
              ))}
            </ul>
          </div>
        )}

        {past.length > 0 && (
          <div className="space-y-2 mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Historique ({past.length})
            </h3>
            <ul className="space-y-2">
              {past.slice(0, 30).map((i) => (
                <InterventionRow
                  key={i.id}
                  intervention={i}
                  missionById={missionById}
                  siteById={siteById}
                  teamById={teamById}
                  muted
                />
              ))}
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

interface InterventionRowProps {
  intervention: {
    id: string
    scheduled_at: string
    scheduled_for: string | null
    slot: 'morning' | 'afternoon' | 'evening' | null
    status: string
    mission_id: string
    assigned_team_id: string | null
  }
  missionById: Map<string, { id: string; name: string; site_id: string }>
  siteById: Map<string, { id: string; name: string }>
  teamById: Map<string, { id: string; name: string; color: string | null }>
  muted?: boolean
}

function InterventionRow({
  intervention: i,
  missionById,
  siteById,
  teamById,
  muted,
}: InterventionRowProps) {
  const mission = missionById.get(i.mission_id)
  const site = mission ? siteById.get(mission.site_id) : null
  const team = i.assigned_team_id ? teamById.get(i.assigned_team_id) : null
  const slotInfo = i.slot ? SLOT_BADGE[i.slot] : null
  const isPlanned = i.status === 'planned'
  const showNoTeamWarning = isPlanned && !i.assigned_team_id

  return (
    <li className={`rounded-lg border p-3 bg-card ${muted ? 'opacity-90' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <Calendar className="h-3 w-3 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">{formatDate(i.scheduled_for ?? i.scheduled_at.slice(0, 10))}</span>
            {slotInfo && (
              <span
                className={`inline-flex items-center text-[10px] uppercase tracking-wider rounded-full border px-1.5 py-0.5 ${slotInfo.class}`}
                title="Créneau"
              >
                {slotInfo.label}
              </span>
            )}
          </div>
          <div className="text-sm font-medium">{site?.name ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{mission?.name ?? '—'}</div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {team ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border"
                style={{
                  backgroundColor: hexToPale(team.color),
                  borderColor: team.color ?? undefined,
                }}
                title="Équipe affectée"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: team.color ?? '#94a3b8' }}
                  aria-hidden
                />
                <Users className="h-2.5 w-2.5" aria-hidden />
                {team.name}
              </span>
            ) : showNoTeamWarning ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                title="Aucune équipe affectée à cette intervention"
              >
                <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                Sans équipe
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={i.status} />
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
}
