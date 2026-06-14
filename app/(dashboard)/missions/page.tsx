import Link from 'next/link'
import { ClipboardList, MapPin, Users, AlertTriangle, CalendarCheck, CalendarX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamBadge } from '@/components/ui/team-badge'
import { listMissionsCockpit } from '@/lib/db/missions-cockpit'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const CADENCE_FR: Record<string, string> = {
  daily:     'Quotidienne',
  weekly:    'Hebdomadaire',
  biweekly:  'Bihebdomadaire',
  monthly:   'Mensuelle',
  on_demand: 'À la demande',
}

const FR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const FR_DAYS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.']

function formatDateShort(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const utc = new Date(Date.UTC(y, m - 1, d))
  return `${FR_DAYS[utc.getUTCDay()]} ${d} ${FR_MONTHS[m - 1]}`
}

export default async function MissionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { missions, stats } = await listMissionsCockpit()

  const active = missions.filter((m) => m.active)
  const inactive = missions.filter((m) => !m.active)

  return (
    <div className="space-y-6 w-full">
      <header>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
          Missions
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Modèles de travail récurrents · Le{' '}
          <Link href="/planning" className="underline underline-offset-2 hover:text-foreground">
            planning des interventions
          </Link>{' '}
          liste les occurrences datées.
        </p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Missions actives"
          value={stats.total}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <KpiCard
          label="Sans prochaine intervention"
          value={stats.withoutNextIntervention}
          icon={<CalendarX className="h-4 w-4" />}
          warn={stats.withoutNextIntervention > 0}
        />
        <KpiCard
          label="Sans équipe affectée"
          value={stats.withoutTeam}
          icon={<Users className="h-4 w-4" />}
          warn={stats.withoutTeam > 0}
        />
        <KpiCard
          label="Avec anomalies ouvertes"
          value={stats.withAnomalies}
          icon={<AlertTriangle className="h-4 w-4" />}
          warn={stats.withAnomalies > 0}
        />
      </div>

      {/* Liste missions actives */}
      {active.length === 0 && inactive.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Aucune mission"
          description="Les missions sont créées depuis la fiche d'un contrat."
          primaryAction={
            <Link
              href="/contracts"
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              Voir les contrats
            </Link>
          }
        />
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Actives ({active.length})
              </h2>
              <MissionTable missions={active} />
            </section>
          )}

          {inactive.length > 0 && (
            <section className="space-y-2 mt-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Inactives ({inactive.length})
              </h2>
              <MissionTable missions={inactive} muted />
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ── Composants ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  warn = false,
}: {
  label: string
  value: number
  icon: React.ReactNode
  warn?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-1 bg-card ${
        warn && value > 0 ? 'border-amber-200 bg-amber-50/60' : ''
      }`}
    >
      <div className={warn && value > 0 ? 'text-amber-600' : 'text-muted-foreground'}>{icon}</div>
      <div className={`text-2xl font-bold tabular-nums ${warn && value > 0 ? 'text-amber-800' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  )
}

function MissionTable({
  missions,
  muted = false,
}: {
  missions: Array<{
    id: string
    name: string
    cadence: string
    active: boolean
    siteName: string
    contractId: string | null
    contractName: string | null
    assignedTeam: { id: string; name: string; color: string | null } | null
    lastInterventionDate: string | null
    nextInterventionDate: string | null
    openAnomalyCount: number
  }>
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      {/* En-têtes — masqués sur mobile */}
      <div className="hidden sm:grid grid-cols-[1fr_160px_160px_160px_40px] gap-x-4 px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <span>Mission · Site</span>
        <span>Équipe</span>
        <span>Dernière</span>
        <span>Prochaine</span>
        <span />
      </div>

      <ul className="divide-y">
        {missions.map((m) => {
          const lastLabel = formatDateShort(m.lastInterventionDate)
          const nextLabel = formatDateShort(m.nextInterventionDate)
          const hasAnomaly = m.openAnomalyCount > 0
          const missingNext = m.active && !m.nextInterventionDate

          return (
            <li
              key={m.id}
              className={`grid sm:grid-cols-[1fr_160px_160px_160px_40px] gap-x-4 gap-y-1 px-4 py-3 items-center hover:bg-muted/20 transition-colors ${
                muted ? 'opacity-60' : ''
              }`}
            >
              {/* Mission + site */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium truncate ${muted ? 'text-muted-foreground' : ''}`}>
                    {m.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                    {CADENCE_FR[m.cadence] ?? m.cadence}
                  </span>
                  {hasAnomaly && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      {m.openAnomalyCount}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                  {m.siteName}
                  {m.contractName && <span className="opacity-60">· {m.contractName}</span>}
                </p>
              </div>

              {/* Équipe */}
              <div className="sm:block">
                {m.assignedTeam ? (
                  <TeamBadge name={m.assignedTeam.name} color={m.assignedTeam.color} size="sm" />
                ) : (
                  <span className="text-xs text-muted-foreground/60 italic">Non affectée</span>
                )}
              </div>

              {/* Dernière */}
              <div className="text-xs text-muted-foreground">
                {lastLabel ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarCheck className="h-3 w-3 text-emerald-500" />
                    {lastLabel}
                  </span>
                ) : (
                  <span className="italic opacity-50">Aucune</span>
                )}
              </div>

              {/* Prochaine */}
              <div className="text-xs">
                {nextLabel ? (
                  <span className="inline-flex items-center gap-1 text-foreground/80">
                    <CalendarCheck className="h-3 w-3 text-sky-500" />
                    {nextLabel}
                  </span>
                ) : (
                  <span
                    className={`italic ${missingNext ? 'text-amber-600' : 'text-muted-foreground/50'}`}
                  >
                    {missingNext ? 'Aucune planifiée' : 'Aucune'}
                  </span>
                )}
              </div>

              {/* Lien édition */}
              <div className="flex justify-end">
                {m.contractId && (
                  <Link
                    href={`/contracts/${m.contractId}/missions/${m.id}/edit`}
                    className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    title="Modifier la mission"
                  >
                    ···
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
