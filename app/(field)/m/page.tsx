import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, ArrowRightLeft, ChevronRight, MapPin, Clock, CalendarDays, AlertTriangle, History, Bell, FileText, ListTodo, Users, CalendarClock } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listInterventionsVisibleToUser } from '@/lib/db/interventions'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { listSharedHandoverBriefsForChef } from '@/lib/db/handover'
import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { actionAttentionOf } from '@/lib/actions/health'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { FreePhotoFab, type FreePhotoFabSite } from './FreePhotoFab'
import { ResumeWorkCard } from './ResumeWorkCard'
import { RecentActivityCard } from './RecentActivityCard'
import { listActiveVisitsForUser, listPendingTriageForUser, getRecentActivityForUser } from '@/lib/db/visits'
import { findMissionAbsences } from '@/lib/ai/site-readings'
import { listOrgTodayInterventions } from '@/lib/db/field-today'
import { ManagerTodayView } from './ManagerTodayView'
import { getMorningDigestForSites, getOrgMorningDigest } from '@/lib/db/morning-digest'
import { MorningHero } from '@/app/(dashboard)/dashboard/MorningHero'

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// Reçoit une date civile pure (YYYY-MM-DD = scheduled_for), JAMAIS un
// `scheduled_at` (timestamp UTC dérivé du créneau : "soir" → 18:00 UTC, qui
// en Nouméa UTC+11 bascule au lendemain). Tout est comparé/formaté en civil.
function formatScheduledTime(civilDate: string): { day: string; isToday: boolean; isPast: boolean } {
  const today = todayLocalIso()
  const isToday = civilDate === today
  const isPast = civilDate < today
  const d = new Date(civilDate + 'T00:00:00.000Z')

  return {
    day: isToday
      ? "Aujourd'hui"
      : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    isToday,
    isPast,
  }
}

// V5.1 — Doctrine V2 : créneaux nommés, JAMAIS d'heures précises.

// V5.1 — Badge créneau coloré (signature visuelle descriptive du moment de
// la journée). Teintes douces -100/-900, pas saturées alarmistes.
const SLOT_BADGE_CLASSES: Record<string, string> = {
  morning: 'bg-amber-100 text-amber-900 border-amber-200',
  afternoon: 'bg-sky-100 text-sky-900 border-sky-200',
  evening: 'bg-indigo-100 text-indigo-900 border-indigo-200',
}

// ── Cockpit terrain (maquette Vincent) ──────────────────────────────────────
// /m devient un cockpit : « ce qui demande ton attention » d'abord, puis les
// outils pour agir. Les actions importantes remontent automatiquement — l'agent
// ne va plus les chercher dans /m/actions.

type Severity = 'red' | 'orange' | 'yellow' | 'indigo'

// Une teinte par niveau d'urgence — la couleur EST l'information (cf. santé des
// actions 🔴≥14j / 🟠7-13j / 🟢rythme). Barre latérale + pastille + titre teinté.
const SEVERITY: Record<Severity, { bar: string; chip: string; title: string; rank: number }> = {
  red: {
    bar: 'border-red-500',
    chip: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
    title: 'text-red-700 dark:text-red-300',
    rank: 0,
  },
  orange: {
    bar: 'border-orange-400',
    chip: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300',
    title: 'text-orange-700 dark:text-orange-300',
    rank: 1,
  },
  yellow: {
    bar: 'border-amber-400',
    chip: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
    title: 'text-amber-700 dark:text-amber-300',
    rank: 2,
  },
  indigo: {
    bar: 'border-indigo-400',
    chip: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
    title: 'text-indigo-700 dark:text-indigo-300',
    rank: 3,
  },
}

interface AttentionItem {
  key: string
  severity: Severity
  icon: LucideIcon
  title: string
  subtitle: string | null
  href: string
  urgent?: boolean
  /** CONTEXTE (règle 2026-07-12 : jamais une action hors de son chantier).
   *  Les items sont regroupés sous ce libellé — le chantier, ou la famille
   *  (« Appels d'offres », « Passation »). */
  group: string
  /** Fiche du chantier — l'en-tête du groupe y mène (« Ouvrir → »). */
  groupHref?: string | null
}

/** Un chantier (ou une famille) qui réclame — l'unité du récit « À reprendre ».
 *  Le CONTEXTE avant le détail : nom, pourquoi, origine — puis 2 actions max. */
interface AttentionGroup {
  label: string
  href: string | null
  /** « Réunion du 8 juillet » — l'ORIGINE des actions, quand elle est connue. */
  origin: string | null
  /** La réunion/visite source, cliquable dès l'accueil. */
  originHref: string | null
  /** Tous les éléments qui réclament sur ce chantier (pas seulement montrés). */
  totalCount: number
  /** 2 max visibles ; le reste = « + N autres » vers la fiche. */
  items: AttentionItem[]
  moreCount: number
}

// Écart en JOURS CIVILS purs (anti-bascule fuseau Nouméa, cf. formatScheduledTime).
function civilDaysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

// Carte du cockpit : conteneur arrondi + en-tête (icône + titre + extra à droite).
function CockpitCard({
  icon: Icon,
  iconClass,
  title,
  headerHref,
  headerExtra,
  flat = false,
  children,
}: {
  icon: LucideIcon
  iconClass: string
  title: string
  headerHref?: string
  headerExtra?: React.ReactNode
  /** Carte secondaire (outils, liste vide) : aplatie pour reculer dans la
   *  hiérarchie derrière les cartes « contenu » (attention, aujourd'hui). */
  flat?: boolean
  children: React.ReactNode
}) {
  const header = (
    <div className="flex items-center gap-2.5">
      <Icon className={`h-5 w-5 shrink-0 ${iconClass}`} strokeWidth={2} />
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {headerExtra && <div className="ml-auto flex items-center gap-2">{headerExtra}</div>}
    </div>
  )
  return (
    <section
      className={`rounded-3xl border px-5 py-6 space-y-5 ${
        flat
          ? 'border-foreground/[0.06] bg-muted/20'
          : 'border-foreground/[0.08] bg-card shadow-sm'
      }`}
    >
      {headerHref ? (
        <Link href={headerHref} className="block active:opacity-70">{header}</Link>
      ) : (
        header
      )}
      {children}
    </section>
  )
}

// Ligne « attention » : barre latérale colorée + pastille icône + titre teinté
// (+ pastille URGENT) + sous-titre discret + chevron.
function AttentionRow({ item }: { item: AttentionItem }) {
  const s = SEVERITY[item.severity]
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-4 border-l-2 ${s.bar} rounded-r-lg pl-4 pr-1 py-4 -mx-1 active:bg-muted/40 transition-colors`}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${s.chip}`}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={`min-w-0 text-[15px] font-medium leading-snug ${s.title}`}>{item.title}</span>
          {item.urgent && (
            <span className="mt-px shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-900/50 dark:text-red-300">
              Urgent
            </span>
          )}
        </span>
        {item.subtitle && (
          <span className="mt-1 block truncate text-[13px] text-muted-foreground">{item.subtitle}</span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export default async function FieldHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const params = await searchParams
  const todayIso = todayLocalIso()
  const selectedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : todayIso
  const isToday = selectedDate === todayIso

  const supabase = createAdminClient()

  // Étape 1 — Team IDs de l'agent (source canonique : assigned_team_id).
  // Résolution séquentielle voulue : chefTeamIds est requis pour calculer
  // agentSiteIds via missions.assigned_team_id, ce qui était impossible avec
  // l'ancien calcul basé sur le legacy team[] (vide pour les V2 interventions).
  const chefTeamIds = await listActiveTeamIdsForUser(user.id)

  // Sites dont une des missions de l'agent est responsable (assigned_team_id).
  // Fallback legacy : interventions.team[] pour les comptes antérieurs à V2.
  let agentSiteIds: string[] = []
  if (chefTeamIds.length > 0) {
    const { data: missionSiteRows } = await supabase
      .from('missions')
      .select('site_id')
      .in('assigned_team_id', chefTeamIds)
      .is('deleted_at', null)
    agentSiteIds = Array.from(new Set(
      (missionSiteRows ?? []).map((m) => m.site_id).filter((s): s is string => !!s)
    ))
  }
  if (agentSiteIds.length === 0) {
    const { data: legacyIntRes } = await supabase
      .from('interventions')
      .select('mission:missions(site_id)')
      .contains('team', [user.id])
      .limit(200)
    agentSiteIds = Array.from(new Set(
      (legacyIntRes ?? [])
        .map((r) => {
          const m = r.mission as { site_id?: string } | Array<{ site_id?: string }> | null
          if (!m) return null
          if (Array.isArray(m)) return m[0]?.site_id ?? null
          return m.site_id ?? null
        })
        .filter((s): s is string => !!s)
    ))
  }

  // Étape 2 — Génération paresseuse AVANT le fetch des interventions.
  // Obligation séquentielle : ensure doit inscrire les records récurrents en DB
  // AVANT que listInterventionsVisibleToUser les cherche. Couvre aujourd'hui + J+3
  // (toutes les dates visibles dans le DateNav). Idempotente : UNIQUE constraint.
  if (agentSiteIds.length > 0) {
    await ensureTodayInterventionsForSites(agentSiteIds, 4)

    // Backfill assigned_team_id sur les interventions générées AVANT le fix V2.
    // Les templates généraient sans assigned_team_id ; sans ce champ,
    // listInterventionsVisibleToUser ne les retourne pas. On corrige silencieusement
    // les interventions planifiées dans la fenêtre visible (±1j→+7j) dont le
    // assigned_team_id est manquant mais dont la mission l'a.
    if (chefTeamIds.length > 0) {
      try {
        const fromBackfill = addDaysLocal(todayIso, -1)
        const toBackfill = addDaysLocal(todayIso, 7)
        // 1. Récupère les missions des sites avec leur assigned_team_id
        const { data: missionRows } = await supabase
          .from('missions')
          .select('id, assigned_team_id')
          .in('site_id', agentSiteIds)
          .in('assigned_team_id', chefTeamIds)
          .is('deleted_at', null)
        const missionMap = new Map(
          (missionRows ?? [])
            .filter((m): m is { id: string; assigned_team_id: string } => !!m.assigned_team_id)
            .map((m) => [m.id, m.assigned_team_id])
        )
        if (missionMap.size > 0) {
          // 2. Corrige par batch de missions (1 UPDATE par mission pour éviter
          //    d'écraser les interventions manuellement réaffectées)
          await Promise.all(
            Array.from(missionMap.entries()).map(([mId, teamId]) =>
              supabase
                .from('interventions')
                .update({ assigned_team_id: teamId })
                .eq('mission_id', mId)
                .is('assigned_team_id', null)
                .eq('status', 'planned')
                .gte('scheduled_for', fromBackfill)
                .lte('scheduled_for', toBackfill)
            )
          )
        }
      } catch {
        // Silencieux — le backfill n'est pas critique pour le rendu
      }
    }
  }

  // Manager/admin sans équipe : la vue superviseur a besoin que la DATE CHOISIE
  // soit générée (sinon un jour futur reste vide faute de records).
  // PERF (régression 67b50f3) : avant, on régénérait TOUTE l'org
  // (≈3 requêtes × nb sites) à CHAQUE chargement /m manager. Désormais, gate par
  // un seul COUNT indexé (idx_interventions_org) : si la date affichée a déjà des
  // interventions, les récurrences existent → on saute la génération coûteuse.
  // Les interventions générées portent organization_id (cf. generator), donc ce
  // count les voit dès le 1er passage : les chargements suivants sont gratuits.
  if (agentSiteIds.length === 0 && (user.role === 'admin' || user.role === 'manager') && user.organization_id) {
    const { count: existingForDate } = await supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', user.organization_id)
      .eq('scheduled_for', selectedDate)
    if (!existingForDate) {
      const { data: orgSites } = await supabase
        .from('sites')
        .select('id')
        .eq('organization_id', user.organization_id)
        .is('deleted_at', null)
      const orgSiteIds = (orgSites ?? []).map((s) => s.id as string)
      if (orgSiteIds.length > 0) {
        // Générer juste assez loin pour couvrir la date affichée (today → selectedDate),
        // borné à la fenêtre max du générateur. Vue d'aujourd'hui = 1 jour, pas 4.
        const [sy, sm, sd] = selectedDate.split('-').map(Number)
        const [ty, tm, td] = todayIso.split('-').map(Number)
        const dayDiff = Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
        const daysAhead = Math.min(Math.max(dayDiff + 1, 1), 7)
        await ensureTodayInterventionsForSites(orgSiteIds, daysAhead)
      }
    }
  }

  // Étape 3 — Fetch en parallèle : les records récurrents existent maintenant.
  const fabSitesPromise = agentSiteIds.length > 0
    ? supabase.from('sites').select('id, name').in('id', agentSiteIds).is('deleted_at', null).order('name')
    : Promise.resolve({ data: [] as Array<{ id: string; name: string }> })
  const [interventions, handoverBriefs, fabSitesRes] = await Promise.all([
    listInterventionsVisibleToUser(user.id),
    listSharedHandoverBriefsForChef(user.id, chefTeamIds),
    fabSitesPromise,
  ])

  // Batch unique : toutes les missions + tous les sites en 1 requête.
  // Dépend de interventions.map(mission_id) → 2ème vague de fetch.
  const allMissionIds = Array.from(new Set(interventions.map((i) => i.mission_id)))
  const allMissionsRes = allMissionIds.length === 0
    ? { data: [] as Array<{ id: string; name: string; site_id: string; cadence: string }> }
    : await supabase.from('missions').select('id, name, site_id, cadence').in('id', allMissionIds).is('deleted_at', null)

  const missionById = new Map(
    ((allMissionsRes as { data: Array<{ id: string; name: string; site_id: string; cadence: string }> | null }).data ?? [])
      .map((m) => [m.id, m])
  )

  const allSiteIds = Array.from(new Set(
    ((allMissionsRes as { data: Array<{ id: string; name: string; site_id: string; cadence: string }> | null }).data ?? [])
      .map((m) => m.site_id)
  ))
  const { data: allSitesData } = allSiteIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }> }
    : await supabase.from('sites').select('id, name').in('id', allSiteIds)
  const siteById = new Map((allSitesData ?? []).map((s) => [s.id, s]))

  const fabSites: FreePhotoFabSite[] = (fabSitesRes as { data: FreePhotoFabSite[] | null }).data ?? []

  // KPI chef d'équipe : interventions terminées sur les 7 derniers jours glissants
  // avec tâches obligatoires non cochées. Utilise missionById/siteById déjà chargés.
  type IncompleteKPI = { interventionId: string; missionName: string; siteName: string; missingCount: number; executedAt: string | null }
  const incompleteKPIs: IncompleteKPI[] = []
  if (user.role === 'chef_equipe' || user.role === 'admin' || user.role === 'manager') {
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const completedRecentIds = interventions
      .filter((i) => (i.status === 'completed' || i.status === 'validated') && i.executed_at && i.executed_at >= sevenDaysAgoIso)
      .map((i) => i.id)
    if (completedRecentIds.length > 0) {
      const { data: missingItems } = await supabase
        .from('intervention_checklist_items')
        .select('intervention_id')
        .in('intervention_id', completedRecentIds)
        .eq('required', true)
        .eq('done', false)
      const missingByIntervention = new Map<string, number>()
      for (const row of (missingItems ?? []) as Array<{ intervention_id: string }>) {
        missingByIntervention.set(row.intervention_id, (missingByIntervention.get(row.intervention_id) ?? 0) + 1)
      }
      for (const [intId, count] of missingByIntervention.entries()) {
        const intv = interventions.find((i) => i.id === intId)
        const mission = intv ? missionById.get(intv.mission_id) : null
        const site = mission ? siteById.get(mission.site_id) : null
        incompleteKPIs.push({
          interventionId: intId,
          missionName: mission?.name ?? 'Intervention',
          siteName: site?.name ?? '',
          missingCount: count,
          executedAt: intv?.executed_at ?? null,
        })
      }
      incompleteKPIs.sort((a, b) => (b.executedAt ?? '').localeCompare(a.executedAt ?? ''))
    }
  }

  // À régulariser : interventions des 7 derniers jours (hors aujourd'hui)
  // toujours en 'planned'. Utilise missionById/siteById déjà chargés.
  type OverdueKPI = { interventionId: string; missionName: string; siteName: string; scheduledFor: string; daysAgo: number }
  const overdueKPIs: OverdueKPI[] = []
  if (user.role === 'chef_equipe' || user.role === 'admin' || user.role === 'manager') {
    const sevenAgoIso = addDaysLocal(todayIso, -7)
    const overdueRaw = interventions.filter(
      (i) => i.status === 'planned'
        && i.scheduled_for
        && i.scheduled_for >= sevenAgoIso
        && i.scheduled_for < todayIso,
    )
    const [ty, tm, td] = todayIso.split('-').map(Number)
    const todayUtcMs = Date.UTC(ty, tm - 1, td)
    for (const i of overdueRaw) {
      const mission = missionById.get(i.mission_id)
      const site = mission ? siteById.get(mission.site_id) : null
      const [sy, sm, sd] = (i.scheduled_for ?? '').split('-').map(Number)
      const daysAgo = Math.round((todayUtcMs - Date.UTC(sy, sm - 1, sd)) / 86_400_000)
      overdueKPIs.push({
        interventionId: i.id,
        missionName: mission?.name ?? 'Intervention',
        siteName: site?.name ?? '',
        scheduledFor: i.scheduled_for!,
        daysAgo,
      })
    }
    overdueKPIs.sort((a, b) => b.daysAgo - a.daysAgo)
  }

  // Filtrage par date sélectionnée (par défaut = aujourd'hui Nouméa).
  // On compare scheduled_for (date civile) directement à selectedDate.
  // Les in_progress sont toujours visibles dans la sélection "aujourd'hui"
  // (cohérent UX : si l'agent a démarré, c'est sa mission active).
  const selectedInterventions = interventions.filter((i) => {
    if (isToday && i.status === 'in_progress') return true
    return i.scheduled_for === selectedDate
  })
  const upcomingInterventions = isToday
    ? interventions.filter((i) => {
        if (i.status === 'in_progress') return false
        return (i.scheduled_for ?? '') > todayIso
      })
    : []

  // Lectures du lieu — absences d'exécution pour les sites du jour (mobile only)
  const todaySiteIds = Array.from(new Set(
    selectedInterventions.map((i) => missionById.get(i.mission_id)?.site_id).filter((id): id is string => !!id)
  ))
  // Missions en cours aujourd'hui → exclues de la liste d'absences pour éviter
  // de signaler comme "absent" ce que Joseph est justement en train de faire.
  const todayMissionNames = new Set(
    selectedInterventions.map((i) => missionById.get(i.mission_id)?.name).filter((n): n is string => !!n)
  )
  const mobileAbsences = isToday && todaySiteIds.length > 0
    ? (await Promise.all(todaySiteIds.map((sid) => findMissionAbsences(sid)))).flat()
        .filter((abs) => !todayMissionNames.has(abs.missionName))
        .sort((a, b) => b.weeksSince - a.weeksSince).slice(0, 2)
    : []

  // Vue superviseur : pour les managers/admins sans intervention assignée,
  // afficher toutes les interventions de l'organisation POUR LA DATE CHOISIE
  // (pas seulement aujourd'hui — sinon hier/demain restaient vides côté manager).
  const isManager = user.role === 'admin' || user.role === 'manager'
  const orgTodaySites =
    isManager && interventions.length === 0 && user.organization_id
      ? await listOrgTodayInterventions(user.organization_id, selectedDate)
      : []
  const selectedDayLabel = formatScheduledTime(selectedDate).day.toLowerCase()

  // ── Assemblage du cockpit ────────────────────────────────────────────────
  // « Ce qui demande ton attention » agrège plusieurs sources RÉELLES en une
  // liste priorisée par couleur. Les actions importantes remontent ici
  // automatiquement — l'agent ne va plus les chercher dans /m/actions.
  // Silence positif : carte masquée si rien ne mérite l'œil.
  const attentionItems: AttentionItem[] = []
  // Échéances d'actions DU JOUR → racontées dans l'agenda « Aujourd'hui ».
  const dueTodayActions: Array<{ id: string; title: string; siteId: string; siteName: string }> = []
  // Origine par groupe (« Réunion du 8 juillet », cliquable) — le POURQUOI.
  const originByGroup = new Map<string, { label: string; href: string }>()

  if (isToday) {
    // 1) Échéances AO (tenders) à rendre — la pression réglementaire d'abord.
    //    🔴 J-≤2 (URGENT) · 🟠 J-≤7 · 🟡 J-≤14. Bornée à l'horizon 14 j.
    if (user.organization_id) {
      const horizon = addDaysLocal(todayIso, 14)
      const { data: tenderRows } = await supabase
        .from('tenders')
        .select('id, title, client_name, deadline, status')
        .eq('organization_id', user.organization_id)
        .is('deleted_at', null)
        .not('deadline', 'is', null)
        .gte('deadline', todayIso)
        .lte('deadline', horizon)
        .order('deadline', { ascending: true })
        .limit(5)
      const CLOSED = new Set(['submitted', 'archived', 'won', 'lost', 'withdrawn'])
      for (const t of (tenderRows ?? []) as Array<{ id: string; title: string | null; client_name: string | null; deadline: string; status: string }>) {
        if (CLOSED.has(t.status)) continue
        const dueIso = t.deadline.slice(0, 10)
        const j = civilDaysBetween(todayIso, dueIso)
        const severity: Severity = j <= 2 ? 'red' : j <= 7 ? 'orange' : 'yellow'
        const label = t.title?.trim() || t.client_name?.trim() || 'Appel d’offres'
        const dueLabel = new Date(dueIso + 'T00:00:00.000Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
        attentionItems.push({
          key: `ao-${t.id}`,
          severity,
          icon: FileText,
          title: `Répondre à l’AO — ${label}`,
          subtitle: `Date limite : ${dueLabel} (J-${j})`,
          href: `/tenders/${t.id}`,
          urgent: j <= 2,
          group: 'Appels d’offres',
        })
      }
    }

    // 2) Interventions à régulariser (retard non fait) — 🔴.
    for (const kpi of overdueKPIs) {
      const ageLabel = kpi.daysAgo === 1 ? 'hier' : `il y a ${kpi.daysAgo} j`
      attentionItems.push({
        key: `overdue-${kpi.interventionId}`,
        severity: 'red',
        icon: History,
        title: kpi.missionName,
        subtitle: `non fait — ${ageLabel}`,
        href: `/m/intervention/${kpi.interventionId}?date=${selectedDate}`,
        group: kpi.siteName || 'Interventions',
      })
    }

    // 3) Tâches obligatoires non terminées — 🟠.
    for (const kpi of incompleteKPIs) {
      attentionItems.push({
        key: `incomplete-${kpi.interventionId}`,
        severity: 'orange',
        icon: AlertTriangle,
        title: kpi.missionName,
        subtitle: `${kpi.missingCount} tâche${kpi.missingCount > 1 ? 's' : ''} à finir`,
        href: `/m/intervention/${kpi.interventionId}?date=${selectedDate}`,
        group: kpi.siteName || 'Interventions',
      })
    }

    // 4) Actions ouvertes — MÊME modèle que /m/actions (audit 2026-07-12) :
    //    🔴 échéance dépassée · 🟠 à faire aujourd'hui / suivi décroché (≥7 j
    //    sans avancée) / reportée mais en retard. Une action EN SUIVI vivante
    //    ou reportée avec motif ne sollicite PAS l'accueil — fini le rouge à
    //    vie sur les routines. Icône = l'objet action, plus jamais « ? ».
    const scopedSites = agentSiteIds.length > 0 ? agentSiteIds : undefined
    if (scopedSites || isManager) {
      const openActions = await listOpenSiteActions(scopedSites ? { siteIds: scopedSites } : undefined).catch(() => [] as SiteActionRow[])
      let shown = 0
      const shownReportIds = new Set<string>()
      for (const a of openActions) {
        // Borne large : le CONTEXTE (groupes par chantier) borne l'affichage,
        // mais le COMPTE par chantier doit rester vrai.
        if (shown >= 12) break
        // Échéance du jour → elle vit dans l'agenda « Aujourd'hui », pas ici.
        if (a.due_date && a.due_date.slice(0, 10) === todayIso) {
          dueTodayActions.push({ id: a.id, title: a.title, siteId: a.site_id, siteName: a.site_name })
          continue
        }
        const attention = actionAttentionOf(a, todayIso)
        if (!attention) continue
        if (a.report_id) shownReportIds.add(a.report_id)
        attentionItems.push({
          key: `action-${a.id}`,
          severity: attention.severity,
          icon: ListTodo,
          title: a.title,
          subtitle: attention.note,
          // Le CONTEXTE d'abord : l'action ramène à son chantier, pas à une
          // liste globale (règle : jamais une action hors contexte).
          href: `/m/site/${a.site_id}`,
          group: a.site_name,
          groupHref: `/m/site/${a.site_id}`,
        })
        shown++
      }
      // L'ORIGINE des actions montrées : « Réunion du 8 juillet » (report source).
      if (shownReportIds.size > 0) {
        const { data: srcReports } = await supabase
          .from('site_reports')
          .select('id, created_at, site_id')
          .in('id', [...shownReportIds])
        for (const r of (srcReports ?? []) as Array<{ id: string; created_at: string; site_id: string | null }>) {
          const d = new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea' })
          for (const it of attentionItems) {
            if (it.key.startsWith('action-') && it.groupHref === `/m/site/${r.site_id}` && !originByGroup.has(it.group)) {
              originByGroup.set(it.group, { label: `Réunion du ${d}`, href: `/m/reunion/${r.id}` })
            }
          }
        }
      }
    }

    // 5) Briefs de passation à lire — info 🟦 (retrouvables même si le SMS est perdu).
    for (const b of handoverBriefs) {
      if (b.status === 'acknowledged') continue
      const siteCount = b.payload?.sites?.length ?? 0
      attentionItems.push({
        key: `brief-${b.id}`,
        severity: 'indigo',
        icon: ArrowRightLeft,
        title: b.title,
        subtitle: `${siteCount > 0 ? `${siteCount} site${siteCount > 1 ? 's' : ''} · ` : ''}mémoire transmise`,
        href: `/h/${b.shared_token}`,
        group: 'Passation',
      })
    }
  }

  // Tri par urgence (rouge → orange → jaune → info).
  attentionItems.sort((x, y) => SEVERITY[x.severity].rank - SEVERITY[y.severity].rank)

  // « À reprendre » : le RÉCIT par chantier (règle 2026-07-12 — jamais une
  // action hors contexte). Le chantier est le niveau principal : nom, pourquoi,
  // origine, COMPTE vrai — puis 2 éléments max et « + N autres ». 3 chantiers
  // max sur l'accueil ; les familles (AO, Passation) passent après.
  const attentionGroups: AttentionGroup[] = []
  {
    type G = AttentionGroup & { worst: number }
    const byGroup = new Map<string, G>()
    const ordered: G[] = []
    for (const it of attentionItems) {
      let g = byGroup.get(it.group)
      if (!g) {
        const origin = originByGroup.get(it.group) ?? null
        g = {
          label: it.group,
          href: it.groupHref ?? null,
          origin: origin?.label ?? null,
          originHref: origin?.href ?? null,
          totalCount: 0,
          items: [],
          moreCount: 0,
          worst: 9,
        }
        byGroup.set(it.group, g)
        ordered.push(g)
      }
      if (!g.href && it.groupHref) g.href = it.groupHref
      g.totalCount++
      g.worst = Math.min(g.worst, SEVERITY[it.severity].rank)
      if (g.items.length < 2) g.items.push(it)
    }
    ordered.sort((a, b) => a.worst - b.worst)
    const sites = ordered.filter((g) => g.href).slice(0, 3)
    const familles = ordered.filter((g) => !g.href)
    for (const g of [...sites, ...familles]) {
      g.moreCount = g.totalCount - g.items.length
      attentionGroups.push(g)
    }
  }

  // RÉUNIONS programmées AUJOURD'HUI (next_meeting_at, mig 131 — jour civil) :
  // le rendez-vous le plus structurant de la journée du conducteur.
  let todayMeetings: Array<{ siteId: string; siteName: string }> = []
  if (isToday) {
    let mq = supabase
      .from('site_reports')
      .select('site_id')
      .eq('next_meeting_at', todayIso)
      .not('site_id', 'is', null)
      .limit(6)
    if (agentSiteIds.length > 0) mq = mq.in('site_id', agentSiteIds)
    const { data: meetRows } = await mq
    const meetSiteIds = [...new Set(((meetRows ?? []) as Array<{ site_id: string }>).map((r) => r.site_id))]
    if (meetSiteIds.length > 0) {
      let sq = supabase.from('sites').select('id, name').in('id', meetSiteIds).is('deleted_at', null)
      if (user.organization_id) sq = sq.eq('organization_id', user.organization_id)
      const { data: meetSites } = await sq
      todayMeetings = ((meetSites ?? []) as Array<{ id: string; name: string }>).map((s) => ({ siteId: s.id, siteName: s.name }))
    }
  }

  // « Aujourd'hui » = rendez-vous datés (heure précise = planned_start). Les
  // missions récurrentes (créneau matin/aprèm) tombent dans « Interventions
  // planifiées ». Mutuellement exclusifs → zéro doublon.
  const timedToday = selectedInterventions.filter((i) => !!i.planned_start)
  const recurringToday = selectedInterventions.filter((i) => !i.planned_start)

  // « Reprendre mon travail » — la pile de travail du quotidien : visites en cours
  // (à reprendre) + visites terminées dont le TRI n'est pas fini. Tout en haut.
  const [activeVisits, pendingTriage, recentActivity] = await Promise.all([
    listActiveVisitsForUser(user.id).catch(() => []),
    listPendingTriageForUser(user.id).catch(() => []),
    getRecentActivityForUser(user.id).catch(() => []),
  ])

  // LE MATIN sur /m (la Nuit → une apparition, tranche « mobile » de la fiche
  // Nuit) : le digest nocturne des chantiers de CELUI qui regarde — jamais
  // l'organisation entière, sauf superviseur sans chantier assigné (même repli
  // que le Journal). Aujourd'hui seulement ; pas de digest → rien (aucune
  // régression). Règle validée : sur mobile, le CTA mène au Journal.
  const morningDigest = isToday
    ? agentSiteIds.length > 0
      ? await getMorningDigestForSites(agentSiteIds).catch(() => null)
      : (user.role === 'admin' || user.role === 'manager') && user.organization_id
        ? await getOrgMorningDigest(user.organization_id).catch(() => null)
        : null
    : null

  // Narratif : on ouvre sur une salutation + la journée — une feuille de route,
  // pas un tableau de bord. « Qu'est-ce que je fais maintenant ? », pas des chiffres.
  const firstName = user.full_name?.trim().split(/\s+/)[0] || user.email?.split('@')[0] || ''
  const greetingDate = new Date(`${todayIso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6 max-w-md pb-32">
      <header className="space-y-0.5 pt-1">
        <h1 className="text-2xl font-bold leading-tight">Bonjour{firstName ? ` ${firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{greetingDate}</p>
      </header>

      {/* Le Matin — la Nuit rend compte à l'ouverture de la journée. */}
      {morningDigest && (
        <MorningHero
          digest={morningDigest}
          siteHrefBase="/m/site"
          ctaHref="/m/planning"
          ctaLabel="Commencer ma journée →"
          quietHref="/m/planning"
        />
      )}

      {/* 0 — Reprendre mon travail : la pile de travail du quotidien (visite en
          cours + tri restant). Au-dessus de tout — on reprend en un geste.
          « Commencer » n'est PAS répété ici : c'est le bouton central ➕ Visite
          de la barre du bas (une seule porte pour démarrer, pas de doublon). */}
      <ResumeWorkCard activeVisits={activeVisits} pendingTriage={pendingTriage} />

      {/* 1 — AUJOURD'HUI : l'agenda du jour, UN seul récit (refonte narrative
          2026-07-12). Réunions programmées, rendez-vous datés, interventions,
          échéances — chacun avec son chantier. La rangée de dates a disparu :
          le temps long se lit au Journal (pas deux calendriers). */}
      <CockpitCard
        icon={CalendarDays}
        iconClass="text-foreground/70"
        title={isToday ? "Aujourd'hui" : `Le ${selectedDayLabel}`}
        flat={todayMeetings.length === 0 && timedToday.length === 0 && recurringToday.length === 0 && dueTodayActions.length === 0 && orgTodaySites.length === 0}
      >
        {(todayMeetings.length > 0 || timedToday.length > 0 || recurringToday.length > 0 || dueTodayActions.length > 0) ? (
          <div className="space-y-1">
            {/* Réunions programmées — le rendez-vous structurant d'abord. */}
            {todayMeetings.map((m) => (
              <Link
                key={`meet-${m.siteId}`}
                href={`/m/site/${m.siteId}/reunions`}
                className="flex items-center gap-4 rounded-xl py-4 -mx-1 px-1 active:bg-muted/40 transition-colors"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
                  <Users className="h-[22px] w-[22px]" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-snug">Réunion de chantier</span>
                  <span className="mt-1 block truncate text-[13px] text-muted-foreground">{m.siteName}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            <ul className="space-y-1">
            {timedToday.map((i) => {
              const mission = missionById.get(i.mission_id)
              const site = mission ? siteById.get(mission.site_id) : null
              const timeLabel = formatInterventionTimeLabel({
                planned_start: i.planned_start,
                planned_end: i.planned_end,
                slot: (i.slot as 'morning' | 'afternoon' | 'evening' | null) ?? null,
              })
              return (
                <li key={i.id}>
                  <Link
                    href={`/m/intervention/${i.id}?date=${selectedDate}`}
                    className="flex items-center gap-4 rounded-xl py-4 -mx-1 px-1 active:bg-muted/40 transition-colors"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CalendarDays className="h-[22px] w-[22px]" strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium leading-snug line-clamp-2">{mission?.name ?? 'Rendez-vous'}</span>
                      {site?.name && <span className="mt-1 block truncate text-[13px] text-muted-foreground">{site.name}</span>}
                    </span>
                    {timeLabel && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 tabular-nums dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {timeLabel}
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
            </ul>

            {/* Interventions récurrentes du jour — les cartes riches (démarrer…). */}
            {recurringToday.length > 0 && (
              <ul className="space-y-3 pt-1">
                {recurringToday.map((i) => {
                  const mission = missionById.get(i.mission_id)
                  const site = mission ? siteById.get(mission.site_id) : null
                  return (
                    <InterventionCard
                      key={i.id}
                      interventionId={i.id}
                      missionName={mission?.name ?? 'Intervention'}
                      siteName={site?.name ?? null}
                      siteId={mission?.site_id ?? null}
                      scheduledFor={i.scheduled_for ?? i.scheduled_at.slice(0, 10)}
                      slot={i.slot ?? null}
                      plannedStart={i.planned_start}
                      plannedEnd={i.planned_end}
                      status={i.status}
                      skippedReason={i.skipped_reason}
                      selectedDate={selectedDate}
                      primary
                    />
                  )
                })}
              </ul>
            )}

            {/* Échéances d'actions DU JOUR — avec leur chantier. */}
            {dueTodayActions.map((a) => (
              <Link
                key={`due-${a.id}`}
                href={`/m/site/${a.siteId}`}
                className="flex items-center gap-4 rounded-xl py-4 -mx-1 px-1 active:bg-muted/40 transition-colors"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                  <CalendarClock className="h-[22px] w-[22px]" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-snug line-clamp-2">{a.title}</span>
                  <span className="mt-1 block truncate text-[13px] text-muted-foreground">{a.siteName} · échéance aujourd&apos;hui</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        ) : orgTodaySites.length > 0 ? (
          <ManagerTodayView sites={orgTodaySites} todayLabel={selectedDayLabel} />
        ) : (
          <div className="-mt-1 flex flex-col items-center gap-2.5 py-2 text-center">
            <p className="text-sm font-medium">Aucun rendez-vous {isToday ? "aujourd'hui" : `le ${selectedDayLabel}`}.</p>
            <Link href="/m/planning" className="text-[13px] font-medium text-foreground/70 underline underline-offset-2 active:opacity-70">
              Voir la semaine →
            </Link>
          </div>
        )}
      </CockpitCard>

      {/* 2 — À REPRENDRE : les chantiers qui réclament, chacun avec son POURQUOI
          (origine) — jamais une action hors contexte. Vide → silence positif. */}
      {attentionGroups.length > 0 && (
        <CockpitCard
          icon={Bell}
          iconClass="text-red-500"
          title="À reprendre"
          headerHref="/m/actions"
          headerExtra={<ChevronRight className="h-5 w-5 text-muted-foreground" />}
        >
          <div className="space-y-4">
            {attentionGroups.map((g) =>
              g.href ? (
                /* CHANTIER — le contexte d'abord : nom + compte, origine
                   cliquable, 2 éléments max, « + N autres », Ouvrir. */
                <div key={g.label} className="rounded-2xl border border-foreground/[0.06] bg-muted/20 p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold">{g.label}</span>
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] px-1.5 text-[11px] font-bold tabular-nums">
                      {g.totalCount}
                    </span>
                  </div>
                  {g.origin && (
                    g.originHref ? (
                      <Link href={g.originHref} className="mt-0.5 inline-block text-xs text-sky-700 underline underline-offset-2 active:opacity-70 dark:text-sky-300">
                        {g.origin} →
                      </Link>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">{g.origin}</p>
                    )
                  )}
                  <ul className="mt-2 space-y-1.5">
                    {g.items.map((item) => (
                      <li key={item.key} className="flex items-baseline gap-2 text-[13.5px]">
                        <span
                          aria-hidden
                          className={`mt-0.5 h-2 w-2 shrink-0 self-center rounded-full ${item.severity === 'red' ? 'bg-red-500' : item.severity === 'orange' ? 'bg-orange-400' : 'bg-amber-400'}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.subtitle}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2.5 flex items-center justify-between">
                    {g.moreCount > 0 ? (
                      <Link href={g.href} className="text-xs text-muted-foreground underline underline-offset-2 active:opacity-70">
                        + {g.moreCount} autre{g.moreCount > 1 ? 's' : ''}
                      </Link>
                    ) : <span />}
                    <Link href={g.href} className="text-[13px] font-semibold text-foreground/80 active:opacity-70">
                      Ouvrir le chantier →
                    </Link>
                  </div>
                </div>
              ) : (
                /* FAMILLES (Appels d'offres, Passation) — lignes riches. */
                <div key={g.label}>
                  <p className="text-[15px] font-semibold">{g.label}</p>
                  <div className="divide-y divide-foreground/[0.06]">
                    {g.items.map((item) => (
                      <AttentionRow key={item.key} item={item} />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </CockpitCard>
      )}

      {/* Absences du lieu — discrètes, sous les interventions. */}
      {mobileAbsences.length > 0 && (
        <div className="space-y-1.5 px-1">
          {mobileAbsences.map((abs, i) => (
            <p key={i} className="text-xs text-muted-foreground/80 italic pl-2 border-l border-muted leading-relaxed">
              {abs.weeksSince >= 16
                ? `${abs.missionName} — absent depuis ${Math.round(abs.weeksSince / 4.3)} mois`
                : `${abs.missionName} — absent depuis ${abs.weeksSince} semaines`}
            </p>
          ))}
        </div>
      )}

      {/* « Chantiers récents » n'est PAS ici : c'est l'onglet Chantiers de la barre
          du bas (Aujourd'hui ne doit pas devenir un 2ᵉ écran Chantiers). */}

      {/* Récent — fin de la feuille de journée : dernière visite, dernier CR. */}
      <RecentActivityCard items={recentActivity} />

      {/* À venir cette semaine. */}
      {upcomingInterventions.length > 0 && (
        <CockpitCard icon={CalendarDays} iconClass="text-foreground/70" title="À venir">
          <ul className="space-y-2">
            {upcomingInterventions.map((i) => {
              const mission = missionById.get(i.mission_id)
              const site = mission ? siteById.get(mission.site_id) : null
              return (
                <InterventionCard
                  key={i.id}
                  interventionId={i.id}
                  missionName={mission?.name ?? 'Intervention'}
                  siteName={site?.name ?? null}
                  siteId={mission?.site_id ?? null}
                  scheduledFor={i.scheduled_for ?? i.scheduled_at.slice(0, 10)}
                  slot={i.slot ?? null}
                  plannedStart={i.planned_start}
                  plannedEnd={i.planned_end}
                  status={i.status}
                  skippedReason={i.skipped_reason}
                  selectedDate={selectedDate}
                  primary={false}
                />
              )
            })}
          </ul>
        </CockpitCard>
      )}

      <FreePhotoFab sites={fabSites} />
    </div>
  )
}

function InterventionCard({
  interventionId,
  missionName,
  siteName,
  siteId,
  scheduledFor,
  slot,
  plannedStart,
  plannedEnd,
  status,
  skippedReason,
  selectedDate,
  primary,
}: {
  interventionId: string
  missionName: string
  siteName: string | null
  siteId: string | null
  scheduledFor: string
  slot: string | null
  plannedStart: string | null
  plannedEnd: string | null
  status: string
  skippedReason: string | null
  selectedDate: string
  primary: boolean
}) {
  const { day, isToday } = formatScheduledTime(scheduledFor)
  // V6.2 — affiche l'HEURE (précise si saisie, ancrage sinon), jamais le mot
  // « matin ». Le slot ne sert plus qu'à la couleur du badge.
  const slotLabel = formatInterventionTimeLabel({
    planned_start: plannedStart,
    planned_end: plannedEnd,
    slot: (slot as 'morning' | 'afternoon' | 'evening' | null) ?? null,
  })
  const slotBadgeClass = slot
    ? SLOT_BADGE_CLASSES[slot] ?? 'bg-muted text-foreground border-border'
    : 'bg-muted text-foreground border-border'
  const isInProgress = status === 'in_progress'
  const isCompleted = status === 'completed' || status === 'validated'
  const isSkipped = status === 'skipped'

  return (
    <li>
      <Link
        href={`/m/intervention/${interventionId}?date=${selectedDate}`}
        className={`block rounded-xl border p-4 transition-colors active:bg-muted/40 ${
          isSkipped
            ? 'bg-muted/30 border-border opacity-70 hover:bg-muted/40'
            : primary
              ? 'bg-card border-foreground/10 hover:bg-muted/20'
              : 'bg-muted/20 border-border hover:bg-muted/30'
        }`}
        style={{ minHeight: primary ? 96 : 72 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {(primary || isSkipped) && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <StatusBadge status={status} />
                {isSkipped && skippedReason && (
                  <span
                    className="text-[11px] text-amber-900/80 italic truncate"
                    title={skippedReason}
                  >
                    — {truncate(skippedReason, 50)}
                  </span>
                )}
              </div>
            )}
            <div className={`font-semibold text-base mb-1 underline underline-offset-2 ${isSkipped ? 'line-through decoration-amber-700/40' : 'decoration-foreground/40'}`}>
              {missionName}
            </div>
            {siteName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{siteName}</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {!isToday && (
                <div className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{day}</span>
                </div>
              )}
              {slotLabel && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${slotBadgeClass}`}
                >
                  {slotLabel}
                </span>
              )}
            </div>
          </div>
          {primary && !isCompleted && !isSkipped && (
            <div className="flex flex-col items-center justify-center shrink-0">
              <div className="rounded-full bg-foreground text-background px-4 py-3 text-sm font-medium flex items-center gap-1" style={{ minHeight: 64, minWidth: 64 }}>
                {isInProgress ? 'Continuer' : 'Démarrer'}
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          )}
          {primary && isCompleted && (
            <div className="flex items-center gap-1.5 shrink-0 text-emerald-700 text-sm">
              ✓
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {(!primary || isSkipped) && (
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          )}
        </div>
      </Link>
    </li>
  )
}
