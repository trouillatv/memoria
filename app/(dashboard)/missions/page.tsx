import Link from 'next/link'
import {
  ClipboardList, MapPin, AlertTriangle, CircleSlash, Clock, CheckCircle2,
  Users, CalendarX, ArrowRight, ChevronRight,
} from 'lucide-react'
import { AnomalyTooltipBadge } from '@/components/ui/AnomalyTooltipBadge'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamBadge } from '@/components/ui/team-badge'
import { HealthRing } from '@/components/ui/health-ring'
import { listMissionsCockpit } from '@/lib/db/missions-cockpit'
import { listTeams } from '@/lib/db/teams'
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
// mission récurrente est « hors-rythme »). Marge incluse (week-ends, aléas).
const OVERDUE_THRESHOLD_DAYS: Record<string, number> = {
  daily: 3, weekly: 10, biweekly: 18, monthly: 38, on_demand: Infinity,
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime()
  const b = new Date(toIso + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

// ── Modèle « Santé » d'une mission ──────────────────────────────────────────
// Doctrine couleur (Vincent) : le ROUGE est rare — réservé au retard RÉEL et
// aux anomalies. L'orange pour les manques (jamais faite, sans prochaine, sans
// équipe). Le vert pour « en rythme ». Si tout est rouge, plus rien n'est rouge.
type Tone = 'red' | 'orange' | 'green'

interface MissionLike {
  active: boolean
  cadence: string
  lastInterventionDate: string | null
  nextInterventionDate: string | null
  openAnomalyCount: number
  assignedTeam: { id: string; name: string; color: string | null } | null
}

interface Health {
  level: Tone
  chips: Array<{ tone: Tone; label: string }>
  overdueDays: number
  never: boolean
  sansProchaine: boolean
  sansEquipe: boolean
  anomalies: boolean
}

function missionHealth(m: MissionLike, todayIso: string): Health {
  const recurring = m.cadence !== 'on_demand'
  const hasFutureNext = !!m.nextInterventionDate && m.nextInterventionDate >= todayIso
  const threshold = OVERDUE_THRESHOLD_DAYS[m.cadence] ?? Infinity

  const never = m.active && recurring && !m.lastInterventionDate && !hasFutureNext
  let overdueDays = 0
  let overdue = false
  if (m.active && recurring && m.lastInterventionDate && !hasFutureNext) {
    overdueDays = daysBetweenIso(m.lastInterventionDate, todayIso)
    overdue = overdueDays > threshold
  }
  const anomalies = m.openAnomalyCount > 0
  const sansProchaine = m.active && recurring && !overdue && !never && !hasFutureNext
  const sansEquipe = m.active && !m.assignedTeam

  const chips: Array<{ tone: Tone; label: string }> = []
  if (overdue) chips.push({ tone: 'red', label: `${overdueDays} j de retard` })
  if (anomalies) chips.push({ tone: 'red', label: `${m.openAnomalyCount} anomalie${m.openAnomalyCount > 1 ? 's' : ''}` })
  if (never) chips.push({ tone: 'orange', label: 'jamais réalisée' })
  if (sansProchaine) chips.push({ tone: 'orange', label: 'sans prochaine' })
  if (sansEquipe) chips.push({ tone: 'orange', label: 'sans équipe' })

  const level: Tone = chips.some((c) => c.tone === 'red') ? 'red'
    : chips.some((c) => c.tone === 'orange') ? 'orange' : 'green'
  if (chips.length === 0) chips.push({ tone: 'green', label: 'en rythme' })

  return { level, chips, overdueDays, never, sansProchaine, sansEquipe, anomalies }
}

/** Sévérité pour trier les missions critiques (rouge). */
function severity(h: Health, openAnomalyCount: number): number {
  return (h.overdueDays > 0 ? 1000 + h.overdueDays : 0) + (h.anomalies ? 300 + openAnomalyCount * 10 : 0)
}

const TONE_DOT: Record<Tone, string> = {
  red: 'bg-red-500', orange: 'bg-amber-500', green: 'bg-emerald-500',
}
const TONE_TEXT: Record<Tone, string> = {
  red: 'text-red-700', orange: 'text-amber-700', green: 'text-emerald-700',
}

export default async function MissionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const [{ missions }, sitesForDialog, teams] = await Promise.all([
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
    listTeams(),
  ])

  const todayIso = todayLocalIso()
  const active = missions.filter((m) => m.active)
  const inactive = missions.filter((m) => !m.active)
  const healthBy = new Map(missions.map((m) => [m.id, missionHealth(m, todayIso)]))

  // Spotlight : missions CRITIQUES (rouge), triées par sévérité.
  const critical = active
    .filter((m) => healthBy.get(m.id)!.level === 'red')
    .sort((a, b) => severity(healthBy.get(b.id)!, b.openAnomalyCount) - severity(healthBy.get(a.id)!, a.openAnomalyCount))
  // Priorité n°1 = la mission la plus critique (« si je ne fais qu'une chose »).
  const priority = critical[0] ?? null
  const restCritical = critical.slice(1)
  const topRest = restCritical.slice(0, 3)
  const moreRest = restCritical.slice(3)

  // « À actionner » — compteurs (rouge rare : retard + anomalies ; orange : manques).
  const counts = {
    overdue: active.filter((m) => healthBy.get(m.id)!.overdueDays > 0).length,
    anomalies: active.filter((m) => healthBy.get(m.id)!.anomalies).length,
    sansProchaine: active.filter((m) => healthBy.get(m.id)!.sansProchaine || healthBy.get(m.id)!.never).length,
    sansEquipe: active.filter((m) => healthBy.get(m.id)!.sansEquipe).length,
  }
  const nothingToAction = counts.overdue + counts.anomalies + counts.sansProchaine + counts.sansEquipe === 0

  // A. Santé du portefeuille (répartition par niveau).
  const portfolio = {
    green: active.filter((m) => healthBy.get(m.id)!.level === 'green').length,
    orange: active.filter((m) => healthBy.get(m.id)!.level === 'orange').length,
    red: active.filter((m) => healthBy.get(m.id)!.level === 'red').length,
  }

  // B. Charge par équipe (nombre de missions actives par équipe). Déterministe,
  // pas le lot roster/planning. « inutilisée » = 0 ; « élevée » = nettement
  // au-dessus de la moyenne des équipes actives.
  const missionsByTeam = new Map<string, number>()
  let sansEquipeCount = 0
  for (const m of active) {
    if (m.assignedTeam) missionsByTeam.set(m.assignedTeam.id, (missionsByTeam.get(m.assignedTeam.id) ?? 0) + 1)
    else sansEquipeCount++
  }
  const teamLoad = teams
    .map((t) => ({ id: t.id, name: t.name, color: t.color, count: missionsByTeam.get(t.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
  const maxTeamCount = Math.max(1, sansEquipeCount, ...teamLoad.map((t) => t.count))
  const activeCounts = teamLoad.map((t) => t.count).filter((n) => n > 0)
  const avgLoad = activeCounts.length > 0 ? activeCounts.reduce((s, n) => s + n, 0) / activeCounts.length : 0

  const groupBySite = (list: typeof missions) => {
    const order: string[] = []
    const map = new Map<string, { siteName: string; missions: typeof missions }>()
    for (const m of list) {
      if (!map.has(m.siteId)) { order.push(m.siteId); map.set(m.siteId, { siteName: m.siteName, missions: [] }) }
      map.get(m.siteId)!.missions.push(m)
    }
    return order.map((id) => ({ siteId: id, ...map.get(id)! }))
  }

  const missionHref = (m: { contractId: string | null; id: string; siteId: string }) =>
    m.contractId ? `/contracts/${m.contractId}/missions/${m.id}/edit` : `/sites/${m.siteId}`

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

      {/* ── À ACTIONNER — poste de pilotage, lecture 3 s ───────────────────── */}
      <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-x-5 gap-y-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          À actionner
        </span>
        {nothingToAction ? (
          <span className="text-sm text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Tout est en rythme
          </span>
        ) : (
          <>
            <ActionStat tone="red" icon={<Clock className="h-3.5 w-3.5" />} value={counts.overdue} label="hors-rythme" />
            <ActionStat tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />} value={counts.anomalies} label="anomalies" />
            <ActionStat tone="orange" icon={<CalendarX className="h-3.5 w-3.5" />} value={counts.sansProchaine} label="sans prochaine" />
            <ActionStat tone="orange" icon={<Users className="h-3.5 w-3.5" />} value={counts.sansEquipe} label="sans équipe" />
          </>
        )}
        {counts.sansProchaine > 0 ? (
          <Link
            href="/planning"
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Planifier les {counts.sansProchaine} sans prochaine <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <Link
            href="/planning"
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Planning <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* ── PRIORITÉ N°1 — « si je ne fais qu'une chose aujourd'hui » ───────── */}
      {priority && (() => {
        const h = healthBy.get(priority.id)!
        return (
          <Link href={missionHref(priority)}
            className="group flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 hover:border-red-400 active:scale-[0.99] transition-[transform,border-color] duration-150 ease-out">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold">#1</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-red-700">Priorité du jour</div>
              <div className="text-base font-semibold leading-tight mt-0.5">{priority.name}</div>
              <div className="text-xs text-muted-foreground">{priority.siteName}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {h.chips.filter((c) => c.tone === 'red').map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">{c.label}</span>
                ))}
              </div>
            </div>
            <span className="shrink-0 self-center inline-flex items-center gap-1 rounded-md bg-red-600 text-white px-3 py-1.5 text-xs font-medium group-hover:bg-red-700">
              Voir <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        )
      })()}

      {/* ── VUE D'ENSEMBLE — anneau santé + charge équipe côte à côte ──────── */}
      {active.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Santé du portefeuille — anneau */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              Santé du portefeuille
            </h2>
            <div className="flex items-center gap-6">
              <HealthRing green={portfolio.green} orange={portfolio.orange} red={portfolio.red} total={active.length} unit="missions" />
              <div className="space-y-2 text-sm">
                <LegendDot tone="green" label="en rythme" value={portfolio.green} />
                <LegendDot tone="orange" label="à surveiller" value={portfolio.orange} />
                <LegendDot tone="red" label="critique" value={portfolio.red} />
              </div>
            </div>
          </div>

          {/* Missions par équipe — barres */}
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4 flex items-baseline gap-1.5">
              Missions par équipe
              <span className="font-normal normal-case tracking-normal text-muted-foreground/60">— les plus sollicitées</span>
            </h2>
            {(teamLoad.length > 0 || sansEquipeCount > 0) ? (
              <div className="space-y-2.5">
                {teamLoad.slice(0, 6).map((t) => {
                  const elevated = t.count > 0 && avgLoad > 0 && t.count >= 4 && t.count > avgLoad * 1.5
                  const idle = t.count === 0
                  return (
                    <div key={t.id} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-xs font-medium" style={{ color: t.color ?? undefined }}>{t.name}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        {t.count > 0 && (
                          <div className="h-full rounded-full" style={{ width: `${Math.max(6, (t.count / maxTeamCount) * 100)}%`, backgroundColor: t.color ?? '#64748b' }} />
                        )}
                      </div>
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums font-semibold">{t.count}</span>
                      <span className="w-[4.5rem] shrink-0 text-right text-[10px]">
                        {elevated ? <span className="text-red-700">élevée</span>
                          : idle ? <span className="text-amber-700">inutilisée</span>
                          : <span className="text-muted-foreground/50">·</span>}
                      </span>
                    </div>
                  )
                })}
                {sansEquipeCount > 0 && (
                  <div className="flex items-center gap-3 pt-1 border-t">
                    <span className="w-32 shrink-0 truncate text-xs italic text-amber-700">Sans équipe</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(6, (sansEquipeCount / maxTeamCount) * 100)}%` }} />
                    </div>
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums font-semibold">{sansEquipeCount}</span>
                    <span className="w-[4.5rem] shrink-0 text-right text-[10px] text-amber-700">à affecter</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Aucune équipe affectée.</p>
            )}
          </div>
        </div>
      )}

      {/* ── AUTRES CRITIQUES (hors priorité n°1) ───────────────────────────── */}
      {topRest.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-red-700 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Autres critiques ({restCritical.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {topRest.map((m) => {
              const h = healthBy.get(m.id)!
              return (
                <Link key={m.id} href={missionHref(m)}
                  className="group rounded-xl border-2 border-red-200 bg-red-50/50 p-3.5 hover:border-red-300 active:scale-[0.99] transition-[transform,border-color] duration-150 ease-out block">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-snug">{m.name}</span>
                    <ChevronRight className="h-4 w-4 text-red-300 group-hover:text-red-500 shrink-0 mt-0.5" />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.siteName}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {h.chips.filter((c) => c.tone === 'red').map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                        {c.label}
                      </span>
                    ))}
                  </div>
                </Link>
              )
            })}
          </div>
          {moreRest.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-red-700 hover:underline list-none inline-flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
                Voir les {moreRest.length} autres
              </summary>
              <ul className="mt-1.5 divide-y rounded-lg border">
                {moreRest.map((m) => {
                  const h = healthBy.get(m.id)!
                  return (
                    <li key={m.id}>
                      <Link href={missionHref(m)} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors">
                        <span className="text-sm truncate">{m.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">· {m.siteName}</span>
                        <span className="ml-auto shrink-0"><SanteBadge health={h} /></span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ── TOUTES LES MISSIONS — tableau avec colonne SANTÉ ───────────────── */}
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
                Toutes les missions ({active.length})
              </h2>
              {groupBySite(active).map((group) => (
                <div key={group.siteId} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">{group.siteName}</span>
                  </div>
                  <MissionTable missions={group.missions} healthBy={healthBy} />
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
                  <MissionTable missions={group.missions} healthBy={healthBy} muted />
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

function ActionStat({ tone, icon, value, label }: { tone: Tone; icon: React.ReactNode; value: number; label: string }) {
  const dim = value === 0
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${dim ? 'text-muted-foreground/40' : TONE_TEXT[tone]}`}>
      {icon}
      <span className="font-bold tabular-nums">{value}</span>
      <span className={dim ? '' : 'text-muted-foreground'}>{label}</span>
    </span>
  )
}

function LegendDot({ tone, label, value }: { tone: Tone; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      <span className={value > 0 ? TONE_TEXT[tone] : 'text-muted-foreground/50'}>
        <span className="font-semibold tabular-nums">{value}</span> {label}
      </span>
    </span>
  )
}

/** Badge Santé : le signal d'un coup d'œil (remplace Dernière/Prochaine). */
function SanteBadge({ health }: { health: Health }) {
  const primary = health.chips[0]
  const extra = health.chips.length - 1
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${TONE_TEXT[health.level]}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${TONE_DOT[primary.tone]}`} />
      <span className="font-medium">{primary.label}</span>
      {extra > 0 && <span className="text-muted-foreground">+{extra}</span>}
    </span>
  )
}

function MissionTable({
  missions,
  healthBy,
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
  healthBy: Map<string, Health>
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1fr_160px_200px] gap-x-4 px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <span>Mission</span>
        <span>Équipe</span>
        <span>Santé</span>
      </div>

      <ul className="divide-y">
        {missions.map((m) => {
          const hasAnomaly = m.openAnomalyCount > 0
          const health = healthBy.get(m.id) ?? missionHealth(m, todayLocalIso())
          const href = m.contractId
            ? `/contracts/${m.contractId}/missions/${m.id}/edit`
            : `/sites/${m.siteId}`

          return (
            <li key={m.id} className={muted ? 'opacity-60' : ''}>
              <Link
                href={href}
                className="grid sm:grid-cols-[1fr_160px_200px] gap-x-4 gap-y-1 px-4 py-3 items-center hover:bg-muted/20 transition-colors block"
              >
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

                <div className="sm:block">
                  {m.assignedTeam ? (
                    <TeamBadge name={m.assignedTeam.name} color={m.assignedTeam.color} size="sm" />
                  ) : (
                    <span className="text-xs text-amber-600 italic inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />Non affectée
                    </span>
                  )}
                </div>

                {/* Santé — un seul signal, pas trois colonnes */}
                <div>
                  {muted ? (
                    <span className="text-xs text-muted-foreground/50 italic">inactive</span>
                  ) : (
                    <SanteBadge health={health} />
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
