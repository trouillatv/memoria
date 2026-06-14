import Link from 'next/link'
import { ClipboardList, MapPin, AlertTriangle, CalendarCheck, CircleSlash, Clock } from 'lucide-react'
import { AnomalyTooltipBadge } from '@/components/ui/AnomalyTooltipBadge'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamBadge } from '@/components/ui/team-badge'
import { listMissionsCockpit } from '@/lib/db/missions-cockpit'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { NewMissionDialog } from './NewMissionDialog'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

const CADENCE_FR: Record<string, string> = {
  daily:     'Quotidienne',
  weekly:    'Hebdomadaire',
  biweekly:  'Bihebdomadaire',
  monthly:   'Mensuelle',
  on_demand: 'À la demande',
}

// Seuil de retard par cadence (jours sans réalisation au-delà desquels une
// mission récurrente est « hors-rythme »). Inclut une marge (week-ends, aléas).
// Déterministe — pas d'IA, pas de jugement, juste « ça aurait dû être refait ».
const OVERDUE_THRESHOLD_DAYS: Record<string, number> = {
  daily: 3, weekly: 10, biweekly: 18, monthly: 38, on_demand: Infinity,
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

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime()
  const b = new Date(toIso + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

interface MissionRisk {
  overdue: boolean
  overdueDays: number
  never: boolean
  anomalies: boolean
  atRisk: boolean
}

/** Évalue le risque d'une mission, purement déterministe (cadence + dates). */
function evalMissionRisk(m: {
  active: boolean
  cadence: string
  lastInterventionDate: string | null
  nextInterventionDate: string | null
  openAnomalyCount: number
}, todayIso: string): MissionRisk {
  const recurring = m.cadence !== 'on_demand'
  const hasFutureNext = !!m.nextInterventionDate && m.nextInterventionDate >= todayIso
  const threshold = OVERDUE_THRESHOLD_DAYS[m.cadence] ?? Infinity

  const never = m.active && recurring && !m.lastInterventionDate && !hasFutureNext
  let overdue = false
  let overdueDays = 0
  if (m.active && recurring && m.lastInterventionDate && !hasFutureNext) {
    overdueDays = daysBetweenIso(m.lastInterventionDate, todayIso)
    overdue = overdueDays > threshold
  }
  const anomalies = m.openAnomalyCount > 0
  return { overdue, overdueDays, never, anomalies, atRisk: overdue || never || anomalies }
}

export default async function MissionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const [{ missions, stats }, sitesForDialog] = await Promise.all([
    listMissionsCockpit(),
    (async () => {
      const supabase = createAdminClient()
      const orgId = await getOrgId()
      let q = supabase
        .from('sites')
        .select('id, name, contract:contracts(id, name)')
        .is('deleted_at', null)
        .order('name')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data } = await q
      type ContractRow = { id: string; name: string }
      return ((data ?? []) as Array<{ id: string; name: string; contract: ContractRow | ContractRow[] | null }>).map((s) => {
        const contract = Array.isArray(s.contract) ? (s.contract[0] ?? null) : s.contract
        return { id: s.id, name: s.name, contractName: contract?.name ?? null }
      })
    })(),
  ])

  const active = missions.filter((m) => m.active)
  const inactive = missions.filter((m) => !m.active)

  // ── Couche d'attention : « qu'est-ce qui va me péter à la figure ? » ──────
  // Déterministe, depuis les données existantes. Pas un dashboard historique.
  const todayIso = todayLocalIso()
  const riskByMission = new Map(missions.map((m) => [m.id, evalMissionRisk(m, todayIso)]))
  const atRiskMissions = active
    .filter((m) => riskByMission.get(m.id)?.atRisk)
    .sort((a, b) => {
      const ra = riskByMission.get(a.id)!, rb = riskByMission.get(b.id)!
      // Tri par sévérité : retard (jours) > jamais > anomalies seules
      const score = (r: MissionRisk) => (r.overdue ? 1000 + r.overdueDays : 0) + (r.never ? 500 : 0) + (r.anomalies ? 100 : 0)
      return score(rb) - score(ra)
    })
  const riskStats = {
    overdue: active.filter((m) => riskByMission.get(m.id)?.overdue).length,
    never: active.filter((m) => riskByMission.get(m.id)?.never).length,
    anomalies: active.filter((m) => riskByMission.get(m.id)?.anomalies).length,
  }

  // Regroupement par site
  const groupBySite = (list: typeof missions) => {
    const order: string[] = []
    const map = new Map<string, { siteName: string; missions: typeof missions }>()
    for (const m of list) {
      if (!map.has(m.siteId)) {
        order.push(m.siteId)
        map.set(m.siteId, { siteName: m.siteName, missions: [] })
      }
      map.get(m.siteId)!.missions.push(m)
    }
    return order.map((id) => ({ siteId: id, ...map.get(id)! }))
  }

  return (
    <div className="space-y-6 w-full">
      <header className="flex items-start justify-between gap-4">
        <div>
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
        </div>
        <NewMissionDialog sites={sitesForDialog} />
      </header>

      {/* KPIs — « qu'est-ce qui va me péter à la figure ? » (pas administratif) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Missions actives"
          value={stats.total}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <KpiCard
          label="En retard (hors-rythme)"
          value={riskStats.overdue}
          icon={<Clock className="h-4 w-4" />}
          danger={riskStats.overdue > 0}
        />
        <KpiCard
          label="Jamais réalisées"
          value={riskStats.never}
          icon={<CircleSlash className="h-4 w-4" />}
          danger={riskStats.never > 0}
        />
        <KpiCard
          label="Avec anomalies ouvertes"
          value={riskStats.anomalies}
          icon={<AlertTriangle className="h-4 w-4" />}
          danger={riskStats.anomalies > 0}
        />
      </div>

      {/* ── À RISQUE — ce qui demande attention en premier ─────────────────── */}
      {atRiskMissions.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50/40 p-4 space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-red-700 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            À risque ({atRiskMissions.length})
          </h2>
          <ul className="divide-y divide-red-100">
            {atRiskMissions.map((m) => {
              const r = riskByMission.get(m.id)!
              const href = m.contractId
                ? `/contracts/${m.contractId}/missions/${m.id}/edit`
                : `/sites/${m.siteId}`
              return (
                <li key={m.id}>
                  <Link href={href} className="flex items-center gap-2 py-2 hover:opacity-80 transition-opacity">
                    <span className="text-sm font-medium truncate">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">· {m.siteName}</span>
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      {r.overdue && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          <Clock className="h-3 w-3" />hors-rythme · {r.overdueDays} j
                        </span>
                      )}
                      {r.never && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          <CircleSlash className="h-3 w-3" />jamais réalisée
                        </span>
                      )}
                      {r.anomalies && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          <AlertTriangle className="h-3 w-3" />{m.openAnomalyCount} anomalie{m.openAnomalyCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Liste missions */}
      {active.length === 0 && inactive.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Aucune mission"
          description="Créez une mission ou rattachez-en une depuis la fiche d'un contrat."
        />
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Actives ({active.length})
              </h2>
              {groupBySite(active).map((group) => (
                <div key={group.siteId} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">{group.siteName}</span>
                  </div>
                  <MissionTable missions={group.missions} todayIso={todayIso} />
                </div>
              ))}
            </section>
          )}

          {inactive.length > 0 && (
            <section className="space-y-4 mt-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Inactives ({inactive.length})
              </h2>
              {groupBySite(inactive).map((group) => (
                <div key={group.siteId} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <MapPin className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground/60">{group.siteName}</span>
                  </div>
                  <MissionTable missions={group.missions} todayIso={todayIso} muted />
                </div>
              ))}
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
  danger = false,
}: {
  label: string
  value: number
  icon: React.ReactNode
  warn?: boolean
  danger?: boolean
}) {
  const hot = value > 0 && (warn || danger)
  const tone = danger ? 'red' : 'amber'
  return (
    <div
      className={`rounded-lg border p-4 space-y-1 bg-card ${
        hot ? (tone === 'red' ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60') : ''
      }`}
    >
      <div className={hot ? (tone === 'red' ? 'text-red-600' : 'text-amber-600') : 'text-muted-foreground'}>{icon}</div>
      <div className={`text-2xl font-bold tabular-nums ${hot ? (tone === 'red' ? 'text-red-800' : 'text-amber-800') : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  )
}

function MissionTable({
  missions,
  todayIso,
  muted = false,
}: {
  missions: Array<{
    id: string
    name: string
    cadence: string
    active: boolean
    siteId: string
    siteName: string
    contractId: string | null
    contractName: string | null
    assignedTeam: { id: string; name: string; color: string | null } | null
    lastInterventionDate: string | null
    nextInterventionDate: string | null
    openAnomalyCount: number
    anomalyDetails: Array<{ label: string; date: string }>
  }>
  todayIso: string
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      {/* En-têtes — masqués sur mobile */}
      <div className="hidden sm:grid grid-cols-[1fr_160px_160px_160px] gap-x-4 px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <span>Mission</span>
        <span>Équipe</span>
        <span>Dernière</span>
        <span>Prochaine</span>
      </div>

      <ul className="divide-y">
        {missions.map((m) => {
          const lastLabel = formatDateShort(m.lastInterventionDate)
          const nextLabel = formatDateShort(m.nextInterventionDate)
          const hasAnomaly = m.openAnomalyCount > 0
          const missingNext = m.active && !m.nextInterventionDate
          const risk = evalMissionRisk(m, todayIso)
          const href = m.contractId
            ? `/contracts/${m.contractId}/missions/${m.id}/edit`
            : `/sites/${m.siteId}`

          return (
            <li key={m.id} className={muted ? 'opacity-60' : ''}>
              <Link
                href={href}
                className="grid sm:grid-cols-[1fr_160px_160px_160px] gap-x-4 gap-y-1 px-4 py-3 items-center hover:bg-muted/20 transition-colors block"
              >
                {/* Mission */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium truncate ${muted ? 'text-muted-foreground' : ''}`}>
                      {m.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                      {CADENCE_FR[m.cadence] ?? m.cadence}
                    </span>
                    {hasAnomaly && (
                      <AnomalyTooltipBadge count={m.openAnomalyCount} details={m.anomalyDetails} />
                    )}
                  </div>
                  {m.contractName && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">{m.contractName}</p>
                  )}
                </div>

                {/* Équipe */}
                <div className="sm:block">
                  {m.assignedTeam ? (
                    <TeamBadge name={m.assignedTeam.name} color={m.assignedTeam.color} size="sm" />
                  ) : (
                    <span className="text-xs text-muted-foreground/60 italic">Non affectée</span>
                  )}
                </div>

                {/* Dernière — rythme réel : rouge si hors-rythme */}
                <div className="text-xs text-muted-foreground">
                  {lastLabel ? (
                    risk.overdue ? (
                      <span className="inline-flex items-center gap-1 text-red-600 font-medium" title={`Hors-rythme : dernière réalisation il y a ${risk.overdueDays} jours`}>
                        <Clock className="h-3 w-3" />
                        il y a {risk.overdueDays} j
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <CalendarCheck className="h-3 w-3 text-emerald-500" />
                        {lastLabel}
                      </span>
                    )
                  ) : risk.never ? (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <CircleSlash className="h-3 w-3" />
                      jamais
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
                    <span className={`italic ${missingNext ? 'text-amber-600' : 'text-muted-foreground/50'}`}>
                      {missingNext ? 'Aucune planifiée' : 'Aucune'}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
