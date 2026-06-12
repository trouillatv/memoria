// Page « Interventions du jour » — suivi temps réel de la journée en cours.
//
// Pendant que `evening-briefing.ts` anticipe DEMAIN (calme, préparation),
// `today-view.ts` montre AUJOURD'HUI (où on en est, ce qui bouge encore).
//
// Doctrine V5 :
//   - Toujours montrer tous les statuts (pas masquer les terminées) pour
//     donner la lecture complète de la journée.
//   - Groupement par créneau (matin / après-midi / soir) — rythme naturel.
//   - À risque = non-affectée OU annulée. Signaux logistiques, pas alarmes.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'

export type TodaySlot = 'morning' | 'afternoon' | 'evening' | 'none'

export interface TodayIntervention {
  id: string
  mission_name: string
  site_id: string | null
  site_name: string
  slot: TodaySlot
  status: 'planned' | 'in_progress' | 'completed' | 'validated' | 'skipped'
  assigned_team_id: string | null
  team_name: string | null
  team_color: string | null
  executed_at: string | null
  skipped_reason: string | null
  /** V6.1 — plage horaire de prestation. Affichée par intervention,
   *  jamais cumulée par agent. */
  planned_start: string | null
  planned_end: string | null
}

export interface OverdueIntervention {
  id: string
  mission_name: string
  site_name: string
  scheduled_for: string
  slot: TodaySlot
  team_name: string | null
  team_color: string | null
  daysOverdue: number
}

export interface UnassignedRecent {
  id: string
  mission_name: string
  site_name: string
  scheduled_for: string
  slot: TodaySlot
  status: TodayIntervention['status']
  daysAgo: number
}

export interface TodayView {
  date: string                                      // yyyy-mm-dd
  stats: {
    planned: number
    inProgress: number
    completed: number    // includes validated
    atRisk: number       // unassigned + skipped
  }
  bySlot: Array<{
    slot: TodaySlot
    interventions: TodayIntervention[]
  }>
  /** Interventions planifiées sur les 7 derniers jours qui n'ont jamais
   *  été cochées (ni terminées, ni exécutées, ni décalées, ni annulées).
   *  Signal de régularisation pour le superviseur. */
  overdue: OverdueIntervention[]
  /** Interventions sans équipe affectée sur les 7 derniers jours (aujourd'hui
   *  inclus). Signal critique : pas d'équipe = pas de signature terrain
   *  possible. À régulariser avant ou pendant la journée. */
  unassignedRecent: UnassignedRecent[]
}

/** Alias historique — utilise désormais le helper centralisé. */
export const todayUtcIso = todayLocalIso

const SLOT_ORDER: TodaySlot[] = ['morning', 'afternoon', 'evening', 'none']

export async function buildTodayView(date: string): Promise<TodayView> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  let q = supabase
    .from('interventions')
    .select(`
      id,
      slot,
      status,
      assigned_team_id,
      executed_at,
      skipped_reason,
      planned_start,
      planned_end,
      mission:missions!inner(name, site:sites!inner(id, name))
    `)
    .eq('scheduled_for', date)
    // V6.1 (Vincent 2026-05-20) : ordre par planned_start (heure
    // précise) plutôt que slot grossier. Vue aujourd'hui plus fidèle
    // à la réalité métier : une 06h30 vient avant 07h00 ancrage matin.
    .order('planned_start', { ascending: true, nullsFirst: false })
  if (orgId) q = q.eq('organization_id', orgId)
  const { data: rows } = await q

  type Row = {
    id: string
    slot: TodaySlot | null
    status: TodayIntervention['status']
    assigned_team_id: string | null
    executed_at: string | null
    skipped_reason: string | null
    planned_start: string | null
    planned_end: string | null
    mission: { name: string; site: { id: string; name: string } | Array<{ id: string; name: string }> | null } | Array<{ name: string; site: { id: string; name: string } | Array<{ id: string; name: string }> | null }> | null
  }
  const pick = <T,>(v: T | T[] | null): T | null =>
    v === null ? null : Array.isArray(v) ? v[0] ?? null : v

  // Résoudre les noms d'équipes en batch
  const teamIds = Array.from(new Set(
    ((rows ?? []) as Row[]).map((r) => r.assigned_team_id).filter((id): id is string => !!id)
  ))
  const teamById = new Map<string, { name: string; color: string | null }>()
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, color')
      .in('id', teamIds)
    for (const t of (teams ?? []) as Array<{ id: string; name: string; color: string | null }>) {
      teamById.set(t.id, { name: t.name, color: t.color })
    }
  }

  const items: TodayIntervention[] = []
  for (const r of (rows ?? []) as Row[]) {
    const mission = pick(r.mission)
    const site = mission ? pick(mission.site) : null
    const team = r.assigned_team_id ? teamById.get(r.assigned_team_id) ?? null : null
    items.push({
      id: r.id,
      mission_name: mission?.name ?? 'Intervention',
      site_id: site?.id ?? null,
      site_name: site?.name ?? 'Site inconnu',
      slot: (r.slot ?? 'none') as TodaySlot,
      status: r.status,
      assigned_team_id: r.assigned_team_id,
      team_name: team?.name ?? null,
      team_color: team?.color ?? null,
      executed_at: r.executed_at,
      skipped_reason: r.skipped_reason,
      planned_start: r.planned_start,
      planned_end: r.planned_end,
    })
  }

  // Stats
  const stats = {
    planned: items.filter((i) => i.status === 'planned').length,
    inProgress: items.filter((i) => i.status === 'in_progress').length,
    completed: items.filter((i) => i.status === 'completed' || i.status === 'validated').length,
    atRisk: items.filter((i) => i.status === 'skipped' || (i.status === 'planned' && !i.assigned_team_id)).length,
  }

  // Grouper par créneau, en respectant l'ordre matin → après-midi → soir → sans créneau
  const groupMap = new Map<TodaySlot, TodayIntervention[]>()
  for (const s of SLOT_ORDER) groupMap.set(s, [])
  for (const i of items) {
    const arr = groupMap.get(i.slot) ?? []
    arr.push(i)
    groupMap.set(i.slot, arr)
  }
  // Trier chaque groupe par statut (in_progress > planned > completed > skipped) puis site
  const STATUS_RANK: Record<TodayIntervention['status'], number> = {
    in_progress: 0, planned: 1, completed: 2, validated: 3, skipped: 4,
  }
  for (const list of groupMap.values()) {
    list.sort((a, b) => {
      const r = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (r !== 0) return r
      return a.site_name.localeCompare(b.site_name, 'fr')
    })
  }

  const bySlot = SLOT_ORDER
    .map((slot) => ({ slot, interventions: groupMap.get(slot) ?? [] }))
    .filter((g) => g.interventions.length > 0)

  // À régulariser : interventions planifiées sur les 7 derniers jours
  // (hors aujourd'hui) qui n'ont jamais été cochées comme terminées,
  // exécutées, décalées, ou annulées. Status 'planned' avec scheduled_for
  // dans [date-7, date-1].
  const overdue = await getOverdueInterventions(date, 7)

  // Sans équipe : interventions sur les 7 derniers jours (aujourd'hui inclus)
  // sans assigned_team_id. Signal critique distinct des "À régulariser" car
  // c'est un manque d'affectation, pas un défaut de clôture.
  const unassignedRecent = await getUnassignedRecent(date, 7)

  return { date, stats, bySlot, overdue, unassignedRecent }
}

async function getUnassignedRecent(
  todayIso: string,
  daysBack: number,
): Promise<UnassignedRecent[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const [y, m, d] = todayIso.split('-').map(Number)
  const today = new Date(Date.UTC(y, m - 1, d))
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - daysBack)
  const startIso = start.toISOString().slice(0, 10)

  let qUnassigned = supabase
    .from('interventions')
    .select(`
      id,
      slot,
      status,
      scheduled_for,
      mission:missions!inner(name, site:sites!inner(name))
    `)
    .is('assigned_team_id', null)
    .in('status', ['planned', 'in_progress', 'completed'])
    .gte('scheduled_for', startIso)
    .lte('scheduled_for', todayIso)
    .order('scheduled_for', { ascending: false })
  if (orgId) qUnassigned = qUnassigned.eq('organization_id', orgId)
  const { data: rows } = await qUnassigned

  type Row = {
    id: string
    slot: TodaySlot | null
    status: TodayIntervention['status']
    scheduled_for: string
    mission: { name: string; site: { name: string } | Array<{ name: string }> | null } | Array<{ name: string; site: { name: string } | Array<{ name: string }> | null }> | null
  }
  const pick = <T,>(v: T | T[] | null): T | null =>
    v === null ? null : Array.isArray(v) ? v[0] ?? null : v

  const result: UnassignedRecent[] = []
  for (const r of (rows ?? []) as Row[]) {
    const mission = pick(r.mission)
    const site = mission ? pick(mission.site) : null
    const [ry, rm, rd] = r.scheduled_for.split('-').map(Number)
    const rDate = new Date(Date.UTC(ry, rm - 1, rd))
    const daysAgo = Math.round((today.getTime() - rDate.getTime()) / 86_400_000)
    result.push({
      id: r.id,
      mission_name: mission?.name ?? 'Intervention',
      site_name: site?.name ?? 'Site inconnu',
      scheduled_for: r.scheduled_for,
      slot: (r.slot ?? 'none') as TodaySlot,
      status: r.status,
      daysAgo,
    })
  }
  return result
}

async function getOverdueInterventions(
  todayIso: string,
  daysBack: number,
): Promise<OverdueIntervention[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  // Calcule la date "7 jours avant" en raisonnant en date civile (pas de
  // dépendance fuseau côté serveur — on manipule yyyy-mm-dd directement).
  const [y, m, d] = todayIso.split('-').map(Number)
  const today = new Date(Date.UTC(y, m - 1, d))
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - daysBack)
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const startIso = start.toISOString().slice(0, 10)
  const yesterdayIso = yesterday.toISOString().slice(0, 10)

  let qOverdue = supabase
    .from('interventions')
    .select(`
      id,
      slot,
      scheduled_for,
      assigned_team_id,
      mission:missions!inner(name, site:sites!inner(name))
    `)
    .eq('status', 'planned')
    .gte('scheduled_for', startIso)
    .lte('scheduled_for', yesterdayIso)
    .order('scheduled_for', { ascending: true })
  if (orgId) qOverdue = qOverdue.eq('organization_id', orgId)
  const { data: rows } = await qOverdue

  type Row = {
    id: string
    slot: TodaySlot | null
    scheduled_for: string
    assigned_team_id: string | null
    mission: { name: string; site: { name: string } | Array<{ name: string }> | null } | Array<{ name: string; site: { name: string } | Array<{ name: string }> | null }> | null
  }
  const pick = <T,>(v: T | T[] | null): T | null =>
    v === null ? null : Array.isArray(v) ? v[0] ?? null : v

  const teamIds = Array.from(new Set(
    ((rows ?? []) as Row[]).map((r) => r.assigned_team_id).filter((id): id is string => !!id)
  ))
  const teamById = new Map<string, { name: string; color: string | null }>()
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, color')
      .in('id', teamIds)
    for (const t of (teams ?? []) as Array<{ id: string; name: string; color: string | null }>) {
      teamById.set(t.id, { name: t.name, color: t.color })
    }
  }

  const result: OverdueIntervention[] = []
  for (const r of (rows ?? []) as Row[]) {
    const mission = pick(r.mission)
    const site = mission ? pick(mission.site) : null
    const team = r.assigned_team_id ? teamById.get(r.assigned_team_id) ?? null : null
    const [ry, rm, rd] = r.scheduled_for.split('-').map(Number)
    const rDate = new Date(Date.UTC(ry, rm - 1, rd))
    const daysOverdue = Math.round((today.getTime() - rDate.getTime()) / 86_400_000)
    result.push({
      id: r.id,
      mission_name: mission?.name ?? 'Intervention',
      site_name: site?.name ?? 'Site inconnu',
      scheduled_for: r.scheduled_for,
      slot: (r.slot ?? 'none') as TodaySlot,
      team_name: team?.name ?? null,
      team_color: team?.color ?? null,
      daysOverdue,
    })
  }
  // Plus ancienne en premier (priorité de régularisation)
  result.sort((a, b) => b.daysOverdue - a.daysOverdue)
  return result
}
