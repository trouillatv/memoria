import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { DeviceKind } from '@/lib/navigation/device'

// Monitoring admin — exception doctrinale assumée.
//
// La doctrine V5 interdit en principe les métriques per-user. Ici, à la demande
// explicite du DG (2026-05-13), on conserve :
//   - tableau utilisateurs avec dernière connexion et nb actions sur la période
//   - feed d'activité nominatif
//
// Justification : surface admin uniquement (rôle admin), usage hygiène
// d'identité + traçabilité opérationnelle, pas RH/évaluation. Voir
// docs/10_JOURNAL_DECISIONS.md.
//
// Garde-fou : aucune de ces données ne doit jamais sortir vers un manager,
// un chef d'équipe, ou un client. Aucun PDF, aucun rapport, aucun export.

export type PeriodDays = 7 | 30 | 90

function cutoff(period: PeriodDays): string {
  const d = new Date()
  d.setDate(d.getDate() - period)
  return d.toISOString()
}

// ─── Adoption ────────────────────────────────────────────────────────────────

export interface UserAdoptionRow {
  id: string
  email: string
  full_name: string | null
  role: string
  /**
   * Dernière présence active dans l'app. Combine deux sources via MAX :
   *   1. MAX(activity_logs.created_at) par user — page views (PageViewLogger
   *      monté sur /(dashboard)/* et /(field)/*) + actions métier loggées.
   *      Bouge à chaque navigation et chaque action.
   *   2. auth.users.last_sign_in_at — sign-in explicite (Supabase managed).
   *      Ne bouge PAS au refresh de session (rolling tokens), donc reste
   *      figé après le premier login tant que la session ne ré-expire pas.
   *      Sert de filet de sécurité quand activity_logs est vide.
   * NB : il n'existe pas de `users.last_login_at` dans ce schéma.
   */
  last_activity_at: string | null
  actions_in_period: number
  status: 'active' | 'dormant' | 'inactive'
}

export interface PilotUsageRow extends UserAdoptionRow {
  active_days_30d: number
  notes_created: number
  briefs_created: number
  briefs_read: number
  documents_consulted: number
}

export interface PilotHealth {
  label: 'Inactif' | 'Exploration' | 'Utilisation réelle'
  tone: 'red' | 'amber' | 'green'
  activeDays: number
}

export interface MemoryMoments {
  total: number
  notes: number
  briefs: number
  documents: number
  anomalies: number
}

export interface ActionBreakdown {
  interventions_created: number
  photos_uploaded: number
  anomalies_reported: number
  validations_done: number
  password_resets: number
}

export interface AdoptionStats {
  users: PilotUsageRow[]
  breakdown: ActionBreakdown
  pilotHealth: PilotHealth
  memoryMoments: MemoryMoments
  guillaumeLastActivityAt: string | null
}

export function getPilotHealth(users: Pick<PilotUsageRow, 'active_days_30d'>[]): PilotHealth {
  const activeDays = Math.max(0, ...users.map((u) => u.active_days_30d))
  if (activeDays === 0) return { label: 'Inactif', tone: 'red', activeDays }
  if (activeDays <= 3) return { label: 'Exploration', tone: 'amber', activeDays }
  return { label: 'Utilisation réelle', tone: 'green', activeDays }
}

export function summarizeMemoryMoments(input: Omit<MemoryMoments, 'total'>): MemoryMoments {
  return {
    ...input,
    total: input.notes + input.briefs + input.documents + input.anomalies,
  }
}

function inc(map: Map<string, number>, key: string | null | undefined, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + amount)
}

function routeFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const route = (metadata as { route?: unknown }).route
  return typeof route === 'string' ? route : ''
}

function isDetailRoute(route: string, prefix: string): boolean {
  if (!route.startsWith(prefix)) return false
  const rest = route.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/')
}

export async function getAdoptionStats(period: PeriodDays): Promise<AdoptionStats> {
  const sb = createAdminClient()
  const orgId = await getOrgId()
  const since = cutoff(period)
  const since30 = cutoff(30)

  // Charge tous les utilisateurs, isole les admins → exclus du dataset adoption
  // (leurs actions sont du tooling/hygiène, pas un signal d'adoption produit).
  let qUsers = sb.from('users').select('id, email, full_name, role').is('deleted_at', null)
  if (orgId) qUsers = qUsers.eq('organization_id', orgId)
  const { data: allUsers } = await qUsers
  const adminIds = (allUsers ?? []).filter((u) => u.role === 'admin').map((u) => u.id)
  const monitoredUsers = (allUsers ?? []).filter((u) => u.role !== 'admin')
  const monitoredIds = monitoredUsers.map((u) => u.id)

  // Si aucun utilisateur monitoré, on évite des requêtes IN () vides.
  const monitoredIdsForIn = monitoredIds.length ? monitoredIds : ['00000000-0000-0000-0000-000000000000']

  // Dernière présence : MAX(activity_logs.created_at, auth.last_sign_in_at).
  // - activity_logs : page views (PageViewLogger sur dashboard + field) + actions
  //   métier → bouge à chaque interaction réelle. Source principale.
  // - auth.last_sign_in_at : filet de sécurité si activity_logs est vide pour
  //   un user (compte fraîchement créé qui s'est connecté sans naviguer).
  // Aucune des deux ne bouge sur un simple refresh de session — c'est inhérent
  // à Supabase. activity_logs résout ce problème en pratique.
  const [periodLogsRes, latestLogsRes, logs30Res, authData] = await Promise.all([
    sb.from('activity_logs').select('user_id')
      .gte('created_at', since).not('user_id', 'is', null).in('user_id', monitoredIdsForIn),
    sb.from('activity_logs').select('user_id, created_at')
      .not('user_id', 'is', null).in('user_id', monitoredIdsForIn)
      .order('created_at', { ascending: false }),
    sb.from('activity_logs').select('user_id, entity_type, action, metadata, created_at')
      .gte('created_at', since30).not('user_id', 'is', null).in('user_id', monitoredIdsForIn),
    sb.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const actionCounts = new Map<string, number>()
  for (const log of periodLogsRes.data ?? []) {
    if (log.user_id) actionCounts.set(log.user_id, (actionCounts.get(log.user_id) ?? 0) + 1)
  }
  const lastFromLogs = new Map<string, string>()
  for (const log of latestLogsRes.data ?? []) {
    // Trié desc → la 1ère occurrence par user est la plus récente.
    if (log.user_id && !lastFromLogs.has(log.user_id)) lastFromLogs.set(log.user_id, log.created_at)
  }
  const lastFromAuth = new Map<string, string>()
  for (const u of authData.data?.users ?? []) {
    if (u.last_sign_in_at) lastFromAuth.set(u.id, u.last_sign_in_at)
  }

  const activeDaysByUser = new Map<string, Set<string>>()
  const briefsReadByUser = new Map<string, number>()
  const docsConsultedByUser = new Map<string, number>()
  for (const log of logs30Res.data ?? []) {
    if (!log.user_id) continue
    const day = String(log.created_at).slice(0, 10)
    const set = activeDaysByUser.get(log.user_id) ?? new Set<string>()
    set.add(day)
    activeDaysByUser.set(log.user_id, set)

    const route = routeFromMetadata(log.metadata)
    if (
      log.entity_type === 'page' &&
      log.action === 'view' &&
      isDetailRoute(route, '/handovers/')
    ) {
      inc(briefsReadByUser, log.user_id)
    }
    if (
      (log.entity_type === 'document' && ['opened', 'downloaded'].includes(String(log.action))) ||
      (log.entity_type === 'page' && log.action === 'view' && isDetailRoute(route, '/documents/'))
    ) {
      inc(docsConsultedByUser, log.user_id)
    }
  }

  const [notesRes, briefsRes, documentsRes, anomaliesMonthRes] = await Promise.all([
    sb.from('site_notes').select('created_by').gte('created_at', since30),
    sb.from('handover_briefs').select('created_by').gte('created_at', since30),
    sb.from('documents').select('created_by', { count: 'exact' }).gte('created_at', since30),
    sb.from('intervention_anomalies').select('id', { count: 'exact', head: true }).gte('created_at', since30),
  ])

  const notesByUser = new Map<string, number>()
  for (const note of notesRes.data ?? []) inc(notesByUser, note.created_by)
  const briefsByUser = new Map<string, number>()
  for (const brief of briefsRes.data ?? []) inc(briefsByUser, brief.created_by)

  // MAX des deux sources par user.
  function maxIso(a: string | undefined, b: string | undefined): string | null {
    if (!a) return b ?? null
    if (!b) return a
    return a > b ? a : b
  }

  const now = Date.now()
  const MS_7D = 7 * 24 * 60 * 60 * 1000
  const MS_30D = 30 * 24 * 60 * 60 * 1000

  const users: PilotUsageRow[] = monitoredUsers.map((u) => {
    const lastAt = maxIso(lastFromLogs.get(u.id), lastFromAuth.get(u.id))
    const actions = actionCounts.get(u.id) ?? 0
    let status: 'active' | 'dormant' | 'inactive'
    if (!lastAt) status = 'inactive'
    else {
      const elapsed = now - new Date(lastAt).getTime()
      if (elapsed < MS_7D) status = 'active'
      else if (elapsed < MS_30D) status = 'dormant'
      else status = 'inactive'
    }
    return {
      ...u,
      last_activity_at: lastAt,
      actions_in_period: actions,
      status,
      active_days_30d: activeDaysByUser.get(u.id)?.size ?? 0,
      notes_created: notesByUser.get(u.id) ?? 0,
      briefs_created: briefsByUser.get(u.id) ?? 0,
      briefs_read: briefsReadByUser.get(u.id) ?? 0,
      documents_consulted: docsConsultedByUser.get(u.id) ?? 0,
    }
  })

  users.sort((a, b) => {
    if (!a.last_activity_at && !b.last_activity_at) return 0
    if (!a.last_activity_at) return 1
    if (!b.last_activity_at) return -1
    return b.last_activity_at.localeCompare(a.last_activity_at)
  })

  // Breakdown : exclut les actions effectuées PAR un admin (filtre serveur
  // via .not(col, 'in', '(uuids)') quand des admins existent).
  const adminInClause = adminIds.length ? `(${adminIds.join(',')})` : null
  const photosQ = sb.from('intervention_photos').select('id', { count: 'exact', head: true }).gte('taken_at', since)
  const anomaliesQ = sb.from('intervention_anomalies').select('id', { count: 'exact', head: true }).gte('created_at', since)
  const validationsQ = sb.from('intervention_validations').select('id', { count: 'exact', head: true }).gte('validated_at', since)
  const resetsQ = sb.from('activity_logs').select('id', { count: 'exact', head: true }).eq('action', 'password_reset_forced').gte('created_at', since)
  const intQ = sb.from('interventions').select('id', { count: 'exact', head: true }).gte('created_at', since)

  const [photosRes, anomaliesRes, validationsRes, resetsRes, intRes] = await Promise.all([
    adminInClause ? photosQ.not('taken_by', 'in', adminInClause) : photosQ,
    adminInClause ? anomaliesQ.not('reported_by', 'in', adminInClause) : anomaliesQ,
    adminInClause ? validationsQ.not('validated_by', 'in', adminInClause) : validationsQ,
    adminInClause ? resetsQ.not('user_id', 'in', adminInClause) : resetsQ,
    adminInClause ? intQ.not('created_by', 'in', adminInClause) : intQ,
  ])

  const guillaume =
    users.find((u) => u.email.toLowerCase() === 'guillaume.demene@memoria.nc') ??
    users.find((u) => `${u.full_name ?? ''} ${u.email}`.toLowerCase().includes('guillaume')) ??
    null

  return {
    users,
    breakdown: {
      interventions_created: intRes.count ?? 0,
      photos_uploaded: photosRes.count ?? 0,
      anomalies_reported: anomaliesRes.count ?? 0,
      validations_done: validationsRes.count ?? 0,
      password_resets: resetsRes.count ?? 0,
    },
    pilotHealth: getPilotHealth(users),
    memoryMoments: summarizeMemoryMoments({
      notes: notesRes.data?.length ?? 0,
      briefs: briefsRes.data?.length ?? 0,
      documents: documentsRes.count ?? 0,
      anomalies: anomaliesMonthRes.count ?? 0,
    }),
    guillaumeLastActivityAt: guillaume?.last_activity_at ?? null,
  }
}

// ─── Feed activité ────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: string
  user_id: string | null
  user_name: string | null
  user_role: string | null
  entity_type: string
  entity_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export async function getActivityFeed(period: PeriodDays, roleFilter?: string): Promise<ActivityEntry[]> {
  const sb = createAdminClient()
  const since = cutoff(period)

  const { data: logs } = await sb
    .from('activity_logs')
    .select('id, user_id, entity_type, entity_id, action, metadata, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  if (!logs?.length) return []

  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))] as string[]
  const { data: usersData } = await sb
    .from('users')
    .select('id, full_name, role')
    .in('id', userIds)

  const userMap = new Map((usersData ?? []).map(u => [u.id, u]))

  let entries: ActivityEntry[] = logs.map(l => {
    const u = l.user_id ? userMap.get(l.user_id) : undefined
    return {
      ...l,
      user_name: u?.full_name ?? (l.user_id ? l.user_id.slice(0, 8) : null),
      user_role: u?.role ?? null,
    }
  })

  // Exclut systématiquement les actions admin du feed adoption (cohérent avec
  // les compteurs et le tableau utilisateurs de getAdoptionStats).
  entries = entries.filter(e => e.user_role !== 'admin')

  if (roleFilter) {
    entries = entries.filter(e => e.user_role === roleFilter)
  }

  return entries
}

// ─── Usage : terrain vs bureau + appareil ─────────────────────────────────────

export interface UsageBreakdown {
  total: number
  terrain: number // pages /m… (PWA terrain)
  bureau: number // tout le reste (dashboard)
  byDevice: Record<DeviceKind, number>
}

/**
 * Répartition des visites de page sur la période : terrain (routes /m) vs
 * bureau, et par catégorie d'appareil. Le SEUL graphe d'usage que l'admin
 * veut vraiment (mobile/tel vs ordinateur). Lit `activity_logs` (page views).
 * Les logs antérieurs à la capture d'appareil tombent en `other`.
 */
export async function getUsageBreakdown(period: PeriodDays): Promise<UsageBreakdown> {
  const sb = createAdminClient()
  const since = cutoff(period)
  const { data } = await sb
    .from('activity_logs')
    .select('metadata, user_id')
    .eq('entity_type', 'page')
    .eq('action', 'view')
    .gte('created_at', since)
    .not('user_id', 'is', null)
    .limit(20000)

  const byDevice: Record<DeviceKind, number> = { ios: 0, android: 0, desktop: 0, other: 0 }
  let terrain = 0
  let bureau = 0
  let total = 0
  for (const row of data ?? []) {
    const meta = (row as { metadata: Record<string, unknown> | null }).metadata ?? {}
    const route = typeof meta.route === 'string' ? meta.route : ''
    if (!route) continue
    total += 1
    if (route === '/m' || route.startsWith('/m/')) terrain += 1
    else bureau += 1
    // `device` peut manquer (logs anciens) → on retombe sur 'other'.
    const device = (meta.device as DeviceKind | undefined) ?? 'other'
    byDevice[device === 'ios' || device === 'android' || device === 'desktop' ? device : 'other'] += 1
  }
  return { total, terrain, bureau, byDevice }
}

// ─── Dernière présence de TOUS les utilisateurs (page Personnes) ──────────────

export interface UserActivity {
  last_activity_at: string | null
  status: 'active' | 'dormant' | 'inactive'
}

/**
 * Dernière présence par utilisateur — TOUS rôles inclus (admins compris,
 * contrairement à getAdoptionStats). Sert la colonne « Dernière connexion »
 * de la page Personnes. MAX(activity_logs.created_at, auth.last_sign_in_at).
 */
export async function getUsersActivitySummary(): Promise<Record<string, UserActivity>> {
  const sb = createAdminClient()
  const [latestLogsRes, authData] = await Promise.all([
    sb.from('activity_logs').select('user_id, created_at')
      .not('user_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20000),
    sb.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const lastFromLogs = new Map<string, string>()
  for (const log of latestLogsRes.data ?? []) {
    if (log.user_id && !lastFromLogs.has(log.user_id)) lastFromLogs.set(log.user_id, log.created_at)
  }
  const lastFromAuth = new Map<string, string>()
  for (const u of authData.data?.users ?? []) {
    if (u.last_sign_in_at) lastFromAuth.set(u.id, u.last_sign_in_at)
  }

  const now = Date.now()
  const MS_7D = 7 * 24 * 60 * 60 * 1000
  const MS_30D = 30 * 24 * 60 * 60 * 1000
  const ids = new Set([...lastFromLogs.keys(), ...lastFromAuth.keys()])
  const out: Record<string, UserActivity> = {}
  for (const id of ids) {
    const a = lastFromLogs.get(id)
    const b = lastFromAuth.get(id)
    const lastAt = !a ? (b ?? null) : !b ? a : a > b ? a : b
    let status: UserActivity['status']
    if (!lastAt) status = 'inactive'
    else {
      const elapsed = now - new Date(lastAt).getTime()
      status = elapsed < MS_7D ? 'active' : elapsed < MS_30D ? 'dormant' : 'inactive'
    }
    out[id] = { last_activity_at: lastAt, status }
  }
  return out
}

// ─── Dernière activité PAR ENTREPRISE (remplace la carte Guillaume) ───────────

export interface OrgActivityRow {
  id: string
  name: string
  member_count: number
  last_activity_at: string | null
  status: 'active' | 'dormant' | 'inactive'
}

/**
 * Dernière activité par entreprise = MAX de la dernière présence de ses
 * membres. Remplace l'ancienne carte « dernière activité de Guillaume »
 * (mono-pilote) par une vue multi-entreprises.
 */
export async function getOrgActivitySummary(): Promise<OrgActivityRow[]> {
  const sb = createAdminClient()
  const [{ data: orgs }, { data: users }, activity] = await Promise.all([
    sb.from('organizations').select('id, name').order('name'),
    sb.from('users').select('id, organization_id').is('deleted_at', null),
    getUsersActivitySummary(),
  ])

  const membersByOrg = new Map<string, string[]>()
  for (const u of users ?? []) {
    const oid = (u as { organization_id: string | null }).organization_id
    if (!oid) continue
    const arr = membersByOrg.get(oid) ?? []
    arr.push(u.id)
    membersByOrg.set(oid, arr)
  }

  const now = Date.now()
  const MS_7D = 7 * 24 * 60 * 60 * 1000
  const MS_30D = 30 * 24 * 60 * 60 * 1000

  const rows: OrgActivityRow[] = (orgs ?? []).map((o) => {
    const memberIds = membersByOrg.get(o.id) ?? []
    let last: string | null = null
    for (const id of memberIds) {
      const a = activity[id]?.last_activity_at
      if (a && (!last || a > last)) last = a
    }
    let status: OrgActivityRow['status']
    if (!last) status = 'inactive'
    else {
      const elapsed = now - new Date(last).getTime()
      status = elapsed < MS_7D ? 'active' : elapsed < MS_30D ? 'dormant' : 'inactive'
    }
    return { id: o.id, name: o.name, member_count: memberIds.length, last_activity_at: last, status }
  })

  rows.sort((a, b) => {
    if (!a.last_activity_at && !b.last_activity_at) return 0
    if (!a.last_activity_at) return 1
    if (!b.last_activity_at) return -1
    return b.last_activity_at.localeCompare(a.last_activity_at)
  })
  return rows
}

// ─── Compteurs d'objets (sites, contrats, interventions, intervenants) ────────

export interface EntityCounts {
  sitesCreated: number
  sitesTotal: number
  contractsCreated: number
  contractsTotal: number
  interventionsCreated: number
  intervenants: number
}

export async function getEntityCounts(period: PeriodDays): Promise<EntityCounts> {
  const sb = createAdminClient()
  const since = cutoff(period)
  const head = { count: 'exact' as const, head: true }
  const [sitesC, sitesT, contractsC, contractsT, intC, interv] = await Promise.all([
    sb.from('sites').select('id', head).is('deleted_at', null).gte('created_at', since),
    sb.from('sites').select('id', head).is('deleted_at', null),
    sb.from('contracts').select('id', head).is('deleted_at', null).gte('created_at', since),
    sb.from('contracts').select('id', head).is('deleted_at', null),
    sb.from('interventions').select('id', head).gte('created_at', since),
    sb.from('users').select('id', head).is('deleted_at', null).eq('role', 'chef_equipe'),
  ])
  return {
    sitesCreated: sitesC.count ?? 0,
    sitesTotal: sitesT.count ?? 0,
    contractsCreated: contractsC.count ?? 0,
    contractsTotal: contractsT.count ?? 0,
    interventionsCreated: intC.count ?? 0,
    intervenants: interv.count ?? 0,
  }
}

// ─── Usage par jour (graphe de visites) ───────────────────────────────────────

export interface DailyUsagePoint {
  date: string // YYYY-MM-DD
  count: number
}

/**
 * Visites de page par jour sur la période — alimente le graphe d'usage.
 * Tous les jours de la fenêtre sont représentés (0 inclus) pour un graphe
 * continu. Bucket par date UTC.
 */
export async function getDailyUsage(period: PeriodDays): Promise<DailyUsagePoint[]> {
  const sb = createAdminClient()
  const since = cutoff(period)
  const { data } = await sb
    .from('activity_logs')
    .select('created_at')
    .eq('entity_type', 'page')
    .eq('action', 'view')
    .gte('created_at', since)
    .limit(50000)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const day = String((row as { created_at: string }).created_at).slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  // Génère la liste continue des jours (du plus ancien au plus récent).
  const out: DailyUsagePoint[] = []
  const start = new Date(since)
  start.setUTCHours(0, 0, 0, 0)
  const today = new Date()
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    out.push({ date: key, count: counts.get(key) ?? 0 })
  }
  return out
}

// ─── Santé opérationnelle ─────────────────────────────────────────────────────

export interface OperationalKPIs {
  closureRate: number | null
  proofCoverage: number | null
  openAnomalies: number
  engagementsWithoutMission: number
  lateInterventions: number
}

export async function getOperationalKPIs(period: PeriodDays): Promise<OperationalKPIs> {
  const sb = createAdminClient()
  const since = cutoff(period)
  const today = new Date().toISOString()

  const [allRes, doneRes, anomaliesRes, engagementsRes, missionsRes, lateRes] = await Promise.all([
    sb.from('interventions').select('id', { count: 'exact', head: true }).gte('created_at', since),
    sb.from('interventions').select('id').in('status', ['completed', 'validated']).gte('created_at', since),
    sb.from('intervention_anomalies').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('engagements').select('id').eq('status', 'active'),
    sb.from('missions').select('engagement_ids').is('deleted_at', null).eq('active', true),
    sb.from('interventions').select('id', { count: 'exact', head: true }).eq('status', 'planned').lt('scheduled_at', today),
  ])

  const totalPlanned = allRes.count ?? 0
  const doneIds = (doneRes.data ?? []).map(d => d.id)
  const closureRate = totalPlanned > 0 ? Math.round((doneIds.length / totalPlanned) * 100) : null

  const coveredIds = new Set((missionsRes.data ?? []).flatMap(m => (m.engagement_ids as string[]) ?? []))
  const engagementsWithoutMission = (engagementsRes.data ?? []).filter(e => !coveredIds.has(e.id)).length

  let proofCoverage: number | null = null
  if (doneIds.length > 0) {
    const { data: photosData } = await sb
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', doneIds)

    const withPhotos = new Set((photosData ?? []).map(p => p.intervention_id))
    proofCoverage = Math.round((withPhotos.size / doneIds.length) * 100)
  }

  return {
    closureRate,
    proofCoverage,
    openAnomalies: anomaliesRes.count ?? 0,
    engagementsWithoutMission,
    lateInterventions: lateRes.count ?? 0,
  }
}

// ─── Tableau par contrat ──────────────────────────────────────────────────────

export interface ContractHealth {
  id: string
  name: string
  client_name: string
  sites_count: number
  interventions_planned: number
  interventions_done: number
  closure_rate: number | null
  last_intervention_at: string | null
}

export async function getContractHealthTable(period: PeriodDays): Promise<ContractHealth[]> {
  const sb = createAdminClient()
  const since = cutoff(period)

  const { data: contracts } = await sb
    .from('contracts')
    .select('id, name, client_name')
    .eq('status', 'active')
    .is('deleted_at', null)

  if (!contracts?.length) return []

  const contractIds = contracts.map(c => c.id)

  const { data: sites } = await sb
    .from('sites')
    .select('id, contract_id')
    .is('deleted_at', null)
    .in('contract_id', contractIds)

  const sitesByContract = new Map<string, string[]>()
  for (const s of sites ?? []) {
    if (!s.contract_id) continue
    const arr = sitesByContract.get(s.contract_id) ?? []
    arr.push(s.id)
    sitesByContract.set(s.contract_id, arr)
  }

  const allSiteIds = (sites ?? []).map(s => s.id)
  if (!allSiteIds.length) {
    return contracts.map(c => ({
      id: c.id, name: c.name, client_name: c.client_name,
      sites_count: 0, interventions_planned: 0, interventions_done: 0,
      closure_rate: null, last_intervention_at: null,
    }))
  }

  const { data: missions } = await sb
    .from('missions')
    .select('id, site_id')
    .eq('active', true)
    .is('deleted_at', null)
    .in('site_id', allSiteIds)

  const missionsBySite = new Map<string, string[]>()
  for (const m of missions ?? []) {
    const arr = missionsBySite.get(m.site_id) ?? []
    arr.push(m.id)
    missionsBySite.set(m.site_id, arr)
  }

  const allMissionIds = (missions ?? []).map(m => m.id)

  type IntRow = { mission_id: string; status: string; executed_at: string | null }
  let interventions: IntRow[] = []
  if (allMissionIds.length) {
    const { data } = await sb
      .from('interventions')
      .select('mission_id, status, executed_at')
      .gte('created_at', since)
      .in('mission_id', allMissionIds)
    interventions = (data ?? []) as IntRow[]
  }

  const intByMission = new Map<string, IntRow[]>()
  for (const i of interventions) {
    const arr = intByMission.get(i.mission_id) ?? []
    arr.push(i)
    intByMission.set(i.mission_id, arr)
  }

  return contracts
    .map(c => {
      const siteIds = sitesByContract.get(c.id) ?? []
      const missionIds = siteIds.flatMap(sid => missionsBySite.get(sid) ?? [])
      const ints = missionIds.flatMap(mid => intByMission.get(mid) ?? [])
      const planned = ints.length
      const done = ints.filter(i => ['completed', 'validated'].includes(i.status)).length
      const lastAt = ints
        .filter(i => i.executed_at)
        .sort((a, b) => (b.executed_at ?? '').localeCompare(a.executed_at ?? ''))
        .at(0)?.executed_at ?? null

      return {
        id: c.id,
        name: c.name,
        client_name: c.client_name,
        sites_count: siteIds.length,
        interventions_planned: planned,
        interventions_done: done,
        closure_rate: planned > 0 ? Math.round((done / planned) * 100) : null,
        last_intervention_at: lastAt,
      }
    })
    .sort((a, b) => {
      if (a.closure_rate === null && b.closure_rate === null) return 0
      if (a.closure_rate === null) return -1
      if (b.closure_rate === null) return -1
      return a.closure_rate - b.closure_rate
    })
}
