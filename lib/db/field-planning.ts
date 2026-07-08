// lib/db/field-planning.ts
//
// Planning terrain unifié — la MÉMOIRE TEMPORELLE du conducteur.
// Voir docs/foundations/roadmap-terrain-contextuel.md.
//
// Définition (figée) : le Planning est la vue chronologique de TOUS les
// événements DATÉS liés aux chantiers du conducteur — visites, réunions,
// interventions (récurrentes ET ponctuelles), actions planifiées — passés ou à
// venir. Règle d'architecture : un objet DATÉ → il apparaît ; sinon → il reste
// dans son écran métier. Les missions (gabarits) ne sont JAMAIS des lignes.
//
// Doctrine V3 (garde-fou) : cet agrégateur est ÉVÉNEMENT-CENTRÉ et scopé par
// SITE (« qu'est-ce qui concerne MES chantiers ? »), jamais par personne. Aucune
// agrégation, aucun calcul par user/agent : on LIT des événements, on ne MESURE
// personne. C'est le planning de CELUI qui regarde (auto-consultation), jamais la
// vue d'un tiers sur « ce qu'a fait l'agent X ». Fenêtre bornée au proche
// (J-7 → J+7) : le Passé profond (justification lointaine) est différé.

import { createAdminClient } from '@/lib/supabase/admin'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { PONCTUEL_MISSION_NAME } from '@/lib/db/system-missions'
import { todayLocalIso, addDaysLocal, localDateOf } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

/** Combien de jours de part et d'autre d'aujourd'hui la timeline couvre. */
const WINDOW_DAYS = 7

export type PlanningEventKind = 'visite' | 'intervention' | 'reunion' | 'action'
export type PlanningEventState = 'done' | 'in_progress' | 'upcoming' | 'overdue' | 'cancelled'

export interface PlanningEvent {
  id: string
  kind: PlanningEventKind
  /** Jour CIVIL (YYYY-MM-DD, zone Nouméa) auquel l'événement appartient. */
  date: string
  /** Instant ISO pour le tri intra-journée (null = événement « de la journée »). */
  at: string | null
  /** Libellé horaire (« 7h », « 14h ») pour les interventions ; sinon null. */
  timeLabel: string | null
  title: string
  siteId: string | null
  siteName: string | null
  /** Équipe affectée (intervention) — conteneur logistique, jamais une personne. */
  teamName: string | null
  state: PlanningEventState
  href: string
}

export interface FieldPlanning {
  today: string
  windowStart: string
  windowEnd: string
  /** Tous les événements datés, triés chronologiquement (asc). */
  events: PlanningEvent[]
}

/** Les chantiers du conducteur : sites dont une mission est affectée à l'une de
 *  ses équipes. Manager/admin sans équipe → tous les sites de l'organisation
 *  (vue de supervision). Scope par SITE = doctrine « mes chantiers ». */
async function resolveScopeSiteIds(
  userId: string,
  role: string,
  orgId: string | null,
): Promise<string[]> {
  const supabase = createAdminClient()
  const teamIds = await listActiveTeamIdsForUser(userId)

  if (teamIds.length > 0) {
    const { data } = await supabase
      .from('missions')
      .select('site_id')
      .in('assigned_team_id', teamIds)
      .is('deleted_at', null)
    const ids = Array.from(
      new Set((data ?? []).map((m) => m.site_id).filter((s): s is string => !!s)),
    )
    if (ids.length > 0) return ids
  }

  if ((role === 'admin' || role === 'manager') && orgId) {
    const { data } = await supabase
      .from('sites')
      .select('id')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
    return (data ?? []).map((s) => s.id as string)
  }

  return []
}

/**
 * Construit la mémoire temporelle du conducteur sur la fenêtre proche.
 * @param userId  l'utilisateur qui REGARDE (auto-consultation).
 * @param role    son rôle (pour le repli supervision manager/admin).
 * @param orgId   son organisation (repli manager/admin).
 */
export async function buildFieldPlanning(
  userId: string,
  role: string,
  orgId: string | null,
): Promise<FieldPlanning> {
  const today = todayLocalIso()
  const windowStart = addDaysLocal(today, -WINDOW_DAYS)
  const windowEnd = addDaysLocal(today, WINDOW_DAYS)

  const supabase = createAdminClient()
  const siteIds = await resolveScopeSiteIds(userId, role, orgId)
  if (siteIds.length === 0) {
    return { today, windowStart, windowEnd, events: [] }
  }

  const siteNameById = new Map<string, string>()
  {
    const { data } = await supabase.from('sites').select('id, name').in('id', siteIds)
    for (const s of (data ?? []) as Array<{ id: string; name: string }>) siteNameById.set(s.id, s.name)
  }

  // Bornes timestamptz élargies d'1 jour de chaque côté (marge fuseau Nouméa) :
  // on reclasse ensuite chaque événement à son jour CIVIL et on écarte le
  // hors-fenêtre. Garantit qu'aucun événement n'atterrit sur le mauvais jour.
  const tsLow = `${addDaysLocal(windowStart, -1)}T00:00:00.000Z`
  const tsHigh = `${addDaysLocal(windowEnd, 2)}T00:00:00.000Z`
  const nowIso = new Date().toISOString()

  const events: PlanningEvent[] = []
  const inWindow = (civil: string) => civil >= windowStart && civil <= windowEnd

  // ── 1. Interventions (récurrentes + ponctuelles) ──────────────────────────
  // Scopées par site via missions. On exclut les missions système « conteneur »
  // (Traces libres = dépôt photo) MAIS on garde « Interventions ponctuelles » :
  // ses interventions sont de vrais événements datés, affichées via `label`.
  {
    const { data: missions } = await supabase
      .from('missions')
      .select('id, name, site_id, cadence')
      .in('site_id', siteIds)
      .is('deleted_at', null)
    const validMissions = (missions ?? []).filter(
      (m) => (m.cadence as string) !== 'on_demand' || (m.name as string) === PONCTUEL_MISSION_NAME,
    )
    const missionById = new Map(
      validMissions.map((m) => [m.id as string, { name: m.name as string, siteId: m.site_id as string }]),
    )
    const missionIds = validMissions.map((m) => m.id as string)

    if (missionIds.length > 0) {
      const { data: rows } = await supabase
        .from('interventions')
        .select('id, status, slot, planned_start, planned_end, scheduled_for, scheduled_at, label, mission_id, assigned_team_id')
        .in('mission_id', missionIds)
        .gte('scheduled_for', windowStart)
        .lte('scheduled_for', windowEnd)
        .limit(400)
      const list = (rows ?? []) as Array<{
        id: string; status: string; slot: InterventionSlot | null
        planned_start: string | null; planned_end: string | null
        scheduled_for: string | null; scheduled_at: string; label: string | null
        mission_id: string; assigned_team_id: string | null
      }>

      // Noms d'équipes (conteneur logistique) — batch.
      const teamIds = Array.from(new Set(list.map((i) => i.assigned_team_id).filter((t): t is string => !!t)))
      const teamNameById = new Map<string, string>()
      if (teamIds.length > 0) {
        const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds)
        for (const t of (teams ?? []) as Array<{ id: string; name: string }>) teamNameById.set(t.id, t.name)
      }

      for (const i of list) {
        const mission = missionById.get(i.mission_id)
        if (!mission) continue
        const date = i.scheduled_for ?? localDateOf(new Date(i.scheduled_at))
        if (!inWindow(date)) continue
        events.push({
          id: `int-${i.id}`,
          kind: 'intervention',
          date,
          at: i.planned_start ?? i.scheduled_at,
          timeLabel: formatInterventionTimeLabel({
            planned_start: i.planned_start,
            planned_end: i.planned_end,
            slot: i.slot,
          }),
          // Affichage = objet de la ponctuelle si présent, sinon nom de mission.
          title: (i.label?.trim() || mission.name),
          siteId: mission.siteId,
          siteName: siteNameById.get(mission.siteId) ?? null,
          teamName: i.assigned_team_id ? teamNameById.get(i.assigned_team_id) ?? null : null,
          state: interventionState(i.status, date, today),
          href: `/m/intervention/${i.id}?date=${date}`,
        })
      }
    }
  }

  // ── 2. Visites (site_reports avec origin) ─────────────────────────────────
  {
    const { data: rows } = await supabase
      .from('site_reports')
      .select('id, site_id, started_at, ended_at, created_at, objective')
      .in('site_id', siteIds)
      .not('origin', 'is', null)
      .is('deleted_at', null)
      .gte('started_at', tsLow)
      .lt('started_at', tsHigh)
      .limit(300)
    for (const r of (rows ?? []) as Array<{ id: string; site_id: string; started_at: string | null; ended_at: string | null; created_at: string; objective: string | null }>) {
      const at = r.started_at ?? r.created_at
      const date = localDateOf(new Date(at))
      if (!inWindow(date)) continue
      const inProgress = !r.ended_at
      events.push({
        id: `vis-${r.id}`,
        kind: 'visite',
        date,
        at,
        timeLabel: null,
        title: r.objective?.trim() || 'Visite',
        siteId: r.site_id,
        siteName: siteNameById.get(r.site_id) ?? null,
        teamName: null,
        state: inProgress ? 'in_progress' : 'done',
        href: inProgress ? `/m/visite/${r.id}` : `/m/visite/${r.id}/recap`,
      })
    }
  }

  // ── 3. Réunions passées + réunions à venir (next_meeting_at) ───────────────
  {
    const { data: pastRows } = await supabase
      .from('site_reports')
      .select('id, site_id, title, started_at, created_at')
      .in('site_id', siteIds)
      .is('origin', null)
      .neq('status', 'draft')
      .gte('created_at', tsLow)
      .lt('created_at', tsHigh)
      .limit(200)
    for (const r of (pastRows ?? []) as Array<{ id: string; site_id: string; title: string | null; started_at: string | null; created_at: string }>) {
      const at = r.started_at ?? r.created_at
      const date = localDateOf(new Date(at))
      if (!inWindow(date)) continue
      events.push({
        id: `mtg-${r.id}`,
        kind: 'reunion',
        date,
        at,
        timeLabel: null,
        title: r.title?.trim() || 'Réunion',
        siteId: r.site_id,
        siteName: siteNameById.get(r.site_id) ?? null,
        teamName: null,
        state: 'done',
        href: `/m/reunion/${r.id}`,
      })
    }

    // Prochaines réunions planifiées (next_meeting_at) — événements à venir.
    // Dédupliquées par (site, jour) : un même RDV noté sur plusieurs CR = 1 ligne.
    const { data: nextRows } = await supabase
      .from('site_reports')
      .select('site_id, next_meeting_at')
      .in('site_id', siteIds)
      .not('next_meeting_at', 'is', null)
      .gte('next_meeting_at', nowIso)
      .lte('next_meeting_at', tsHigh)
      .limit(100)
    const seenNext = new Set<string>()
    for (const r of (nextRows ?? []) as Array<{ site_id: string; next_meeting_at: string }>) {
      const date = localDateOf(new Date(r.next_meeting_at))
      if (!inWindow(date)) continue
      const key = `${r.site_id}|${date}`
      if (seenNext.has(key)) continue
      seenNext.add(key)
      events.push({
        id: `nmtg-${key}`,
        kind: 'reunion',
        date,
        at: r.next_meeting_at,
        timeLabel: null,
        title: 'Réunion prévue',
        siteId: r.site_id,
        siteName: siteNameById.get(r.site_id) ?? null,
        teamName: null,
        state: 'upcoming',
        href: `/m/site/${r.site_id}/reunions`,
      })
    }
  }

  // ── 4. Actions PLANIFIÉES (ouvertes AVEC une échéance) ─────────────────────
  // Frontière date : une action sans due_date reste dans l'écran « Actions ».
  {
    const openActions = await listOpenSiteActions({ siteIds }).catch(() => [])
    for (const a of openActions) {
      if (!a.due_date) continue
      const date = a.due_date.slice(0, 10)
      if (!inWindow(date)) continue
      events.push({
        id: `act-${a.id}`,
        kind: 'action',
        date,
        at: null,
        timeLabel: null,
        title: a.title,
        siteId: a.site_id,
        siteName: a.site_name ?? siteNameById.get(a.site_id) ?? null,
        teamName: null,
        state: date < today ? 'overdue' : 'upcoming',
        href: `/m/actions?site=${a.site_id}`,
      })
    }
  }

  // Tri chronologique : jour, puis instant (les « sans heure » en fin de jour),
  // puis type pour un ordre stable.
  const kindOrder: Record<PlanningEventKind, number> = { intervention: 0, visite: 1, reunion: 2, action: 3 }
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1
    if (!!a.at !== !!b.at) return a.at ? -1 : 1
    return kindOrder[a.kind] - kindOrder[b.kind]
  })

  return { today, windowStart, windowEnd, events }
}

function interventionState(status: string, date: string, today: string): PlanningEventState {
  if (status === 'in_progress') return 'in_progress'
  if (status === 'completed' || status === 'validated') return 'done'
  if (status === 'skipped') return 'cancelled'
  // planned
  return date < today ? 'overdue' : 'upcoming'
}
