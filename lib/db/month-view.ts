import 'server-only'

// L'ASSEMBLAGE des faits de la Vue Mois. Lecture seule, strictement.
//
// Cette couche ne dÃ©cide de rien : elle rassemble ce que les autres savent dÃ©jÃ 
// (interventions matÃ©rialisÃ©es, rythmes actifs, fermetures, dÃ©cisions,
// exceptions) et laisse lib/planning/month-view.ts dire ce que Ã§a SIGNIFIE.
//
// Une occurrence n'est jamais comptÃ©e deux fois : si l'intervention existe en
// base pour (rythme, jour), la projection de ce (rythme, jour) est ignorÃ©e.
// L'identitÃ© d'occurrence (mig 198) est la mÃªme partout â une seule vÃ©ritÃ©.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { projectOccurrences, type ProjectableTemplate } from '@/lib/planning/projection'
import { findClosureForDate } from '@/lib/planning/closures'
import { isStillExpected } from '@/lib/planning/conflicts'
import { detectDeviations, hhmmOf } from '@/lib/planning/occurrence-exception'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { listKeptInterventionIds } from '@/lib/db/closure-decisions'
import type { DayFacts, TeamDayFacts } from '@/lib/planning/month-view'

export interface MonthRow {
  siteId: string
  siteName: string
  /**
   * Le client. Sans lui, Â« PointiÃ¨re Â» ne dÃ©signe rien : il y a le magasin
   * Discount de PointiÃ¨re et la mairie de PointiÃ¨re. C'est le couple
   * client + lieu qui identifie un chantier (cf. lib/labels/site-label).
   */
  clientName: string | null
  /** date â faits. Toutes les dates du mois sont prÃ©sentes. */
  days: Record<string, DayFacts>
}

interface MonthIntervention {
  id: string
  site_id: string
  template_id: string | null
  scheduled_for: string
  status: string
  assigned_team_id: string | null
  planned_start: string | null
  planned_end: string | null
}

export async function buildMonthRows(params: {
  from: string
  to: string
}): Promise<MonthRow[]> {
  const { from, to } = params
  const db = createAdminClient()
  const orgIds = await getOrgIdsOfUser() // M3 : agrégé, fail-closed (jamais null → tout)

  // ââ Les interventions MATÃRIALISÃES du mois ââââââââââââââââââââââââââââââââ
  const { data: intvRows } = await db
    .from('interventions')
    .select(
      'id, template_id, scheduled_for, status, assigned_team_id, planned_start, planned_end, missions!inner(site_id, sites!inner(id, name, organization_id, client:clients(name)))',
    )
    .gte('scheduled_for', from)
    .lte('scheduled_for', to)

  type Raw = {
    id: string
    template_id: string | null
    scheduled_for: string
    status: string
    assigned_team_id: string | null
    planned_start: string | null
    planned_end: string | null
    missions?: { site_id?: string; sites?: { id?: string; name?: string; organization_id?: string | null; client?: { name?: string } | Array<{ name?: string }> | null } }
  }

  const interventions: MonthIntervention[] = []
  const siteNames = new Map<string, string>()
  // Le client du chantier â Â« PointiÃ¨re Â» seul ne dÃ©signe rien.
  const clientNames = new Map<string, string | null>()
  for (const r of ((intvRows ?? []) as unknown as Raw[])) {
    const site = r.missions?.sites
    if (!site?.id) continue
    // Isolation : le service role contourne la RLS â le filtre org vit ici.
    if (!orgIds.includes(site.organization_id ?? '')) continue
    siteNames.set(site.id, site.name ?? 'Chantier')
    {
      const c = Array.isArray(site.client) ? site.client[0] : site.client
      clientNames.set(site.id, c?.name ?? null)
    }
    interventions.push({
      id: r.id,
      site_id: site.id,
      template_id: r.template_id,
      scheduled_for: r.scheduled_for,
      status: r.status,
      assigned_team_id: r.assigned_team_id,
      planned_start: r.planned_start,
      planned_end: r.planned_end,
    })
  }

  // ââ Les RYTHMES actifs (roulements publiÃ©s) â pour projeter au-delÃ  de
  //    l'horizon de gÃ©nÃ©ration, et savoir quels jours DEVAIENT Ãªtre couverts. ââ
  const { data: tplRows } = await db
    .from('intervention_templates')
    .select(
      'id, frequency, slots, day_of_week, day_of_month, planned_start_hhmm, planned_end_hhmm, starts_on, ends_on, cycle_length_weeks, anchor_date, week_index, assigned_team_id, cycle_id, missions!inner(id, site_id, sites!inner(id, name, organization_id, client:clients(name)))',
    )
    .eq('active', true)
    .is('deleted_at', null)

  type RawTpl = ProjectableTemplate & {
    assigned_team_id: string | null
    cycle_id: string | null
    missions?: { id?: string; site_id?: string; sites?: { id?: string; name?: string; organization_id?: string | null; client?: { name?: string } | Array<{ name?: string }> | null } }
  }

  const templatesBySite = new Map<string, RawTpl[]>()
  const templatesById = new Map<string, RawTpl>()
  // Supabase type la jointure `missions` en tableau ; au runtime c'est un objet
  // (relation Nâ1). Le passage par `unknown` est le constat, pas un contournement.
  for (const t of ((tplRows ?? []) as unknown as RawTpl[])) {
    const site = t.missions?.sites
    if (!site?.id) continue
    if (!orgIds.includes(site.organization_id ?? '')) continue
    siteNames.set(site.id, site.name ?? 'Chantier')
    {
      const c = Array.isArray(site.client) ? site.client[0] : site.client
      clientNames.set(site.id, c?.name ?? null)
    }
    const list = templatesBySite.get(site.id) ?? []
    list.push({ ...t, mission_id: t.missions?.id ?? t.mission_id })
    templatesBySite.set(site.id, list)
    templatesById.set(t.id, t)
  }

  const siteIds = [...siteNames.keys()]
  if (siteIds.length === 0) return []

  // ââ Fermetures + dÃ©cisions Â« maintenir Â» ââââââââââââââââââââââââââââââââââ
  const [closuresBySite, keptIds] = await Promise.all([
    listActiveClosuresForSites(siteIds, from, to).catch(
      (): Record<string, SiteClosure[]> => ({}),
    ),
    listKeptInterventionIds(interventions.map((i) => i.id)).catch(() => new Set<string>()),
  ])

  // ââ L'assemblage, chantier par chantier, jour par jour ââââââââââââââââââââ
  const days: string[] = []
  {
    const start = new Date(`${from}T00:00:00.000Z`).getTime()
    const end = new Date(`${to}T00:00:00.000Z`).getTime()
    for (let t = start; t <= end; t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10))
    }
  }

  const rows: MonthRow[] = []

  for (const siteId of siteIds) {
    const siteTemplates = templatesBySite.get(siteId) ?? []
    const closures = closuresBySite[siteId] ?? []
    const siteIntv = interventions.filter((i) => i.site_id === siteId)

    // Ce que les rythmes PRODUIRAIENT sur le mois. Sert Ã  deux choses :
    // complÃ©ter au-delÃ  de l'horizon de gÃ©nÃ©ration, et savoir quels jours
    // devaient Ãªtre couverts (le trou n'existe que lÃ ).
    const projected = siteTemplates.length
      ? projectOccurrences({ templates: siteTemplates, from, to })
      : []
    const projectedByDay = new Map<string, Set<string>>()
    for (const o of projected) {
      const set = projectedByDay.get(o.scheduledFor) ?? new Set<string>()
      set.add(o.templateId)
      projectedByDay.set(o.scheduledFor, set)
    }

    const dayFacts: Record<string, DayFacts> = {}
    for (const day of days) {
      const todays = siteIntv.filter((i) => i.scheduled_for === day)

      // Attendu = encore planifiÃ©, HORS dÃ©cisions Â« maintenir Â» dÃ©jÃ  tranchÃ©es
      // (elles restent du travail prÃ©vu, mais ne re-crient pas en conflit).
      const expectedAll = todays.filter((i) => isStillExpected(i.status))
      const expected = expectedAll.filter((i) => !keptIds.has(i.id)).length
      const kept = expectedAll.length - expected
      // Fait/en cours : le passÃ© du mois se lit aussi.
      const done = todays.filter(
        (i) => i.status !== 'skipped' && !isStillExpected(i.status),
      ).length

      // ProjetÃ© SANS doublon : un (rythme, jour) dÃ©jÃ  matÃ©rialisÃ© ne compte pas
      // deux fois â l'identitÃ© d'occurrence est la mÃªme qu'en base (mig 198).
      const materializedTpl = new Set(
        todays.map((i) => i.template_id).filter((v): v is string => !!v),
      )
      const projTpl = projectedByDay.get(day) ?? new Set<string>()
      const projectedCount = [...projTpl].filter((id) => !materializedTpl.has(id)).length

      // Exceptions : une occurrence matÃ©rialisÃ©e qui dÃ©vie de son rythme.
      const hasException = todays.some((i) => {
        if (!i.template_id) return false
        const tpl = templatesById.get(i.template_id)
        if (!tpl) return false
        return (
          detectDeviations(
            {
              scheduledFor: i.scheduled_for,
              status: i.status,
              assignedTeamId: i.assigned_team_id,
              startHHMM: hhmmOf(i.planned_start),
              endHHMM: hhmmOf(i.planned_end),
            },
            tpl,
          ).length > 0
        )
      })

      dayFacts[day] = {
        expected,
        done,
        kept,
        projected: projectedCount,
        closed: findClosureForDate(closures, day) !== null,
        hasException,
        cycleCovers: projTpl.size > 0,
      }
    }

    rows.push({
      siteId,
      siteName: siteNames.get(siteId) ?? 'Chantier',
      clientName: clientNames.get(siteId) ?? null,
      days: dayFacts,
    })
  }

  return rows.sort((a, b) => a.siteName.localeCompare(b.siteName, 'fr'))
}

export interface TeamMonthRow {
  teamId: string
  teamName: string
  /**
   * Qui compose l'Ã©quipe. Vincent, 2026-07-14 : exception ASSUMÃE Ã  la rÃ¨gle
   * Â« nominatif seulement sur /equipes Â» â le conducteur doit savoir QUI tourne.
   *
   * La limite tient : ces noms sont la COMPOSITION de la ligne, jamais des
   * lignes eux-mÃªmes. Aucune grille de jours travaillÃ©s par personne, aucun
   * total individuel â ce serait une feuille de prÃ©sence, pas un planning.
   */
  members: string[]
  days: Record<string, TeamDayFacts>
}

/**
 * LE MÃME MOIS, vu par Ã©quipe. Aucun second moteur : ce sont exactement les
 * mÃªmes faits (interventions matÃ©rialisÃ©es + projection des roulements +
 * fermetures + exceptions), regroupÃ©s sur l'axe Ã©quipe au lieu de l'axe
 * chantier. Une occurrence sans Ã©quipe affectÃ©e n'appartient Ã  aucune ligne :
 * elle reste visible en mode chantier, lÃ  oÃ¹ le trou se traite.
 */
export async function buildTeamMonthRows(params: {
  from: string
  to: string
  /** Les lignes chantier dÃ©jÃ  assemblÃ©es â la page les a pour le verdict : on ne
   *  refait pas le travail, et surtout on ne recalcule pas les mÃªmes faits. */
  siteRows?: MonthRow[]
}): Promise<TeamMonthRow[]> {
  const { from, to } = params
  const db = createAdminClient()
  const orgIds = await getOrgIdsOfUser() // M3 : agrégé, fail-closed (jamais null → tout)

  const [siteRows, teamRows] = await Promise.all([
    params.siteRows ?? buildMonthRows({ from, to }),
    db.from('teams').select('id, name, organization_id').is('deleted_at', null),
  ])
  if (siteRows.length === 0) return []

  const teamNames = new Map<string, string>()
  for (const t of ((teamRows.data ?? []) as Array<{
    id: string
    name: string
    organization_id: string | null
  }>)) {
    // Isolation : le service role contourne la RLS â le filtre org vit ici.
    if (!orgIds.includes(t.organization_id ?? '')) continue
    teamNames.set(t.id, t.name)
  }

  // La composition des Ã©quipes actives (voir TeamMonthRow.members).
  const membersByTeam = new Map<string, string[]>()
  if (teamNames.size > 0) {
    const { data: memberRows } = await db
      .from('team_members')
      .select('team_id, user:users(full_name, email)')
      .in('team_id', [...teamNames.keys()])
      .is('left_at', null)
      .order('joined_at', { ascending: true })

    type MemberRow = {
      team_id: string
      user: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> | null
    }
    for (const m of ((memberRows ?? []) as unknown as MemberRow[])) {
      const u = Array.isArray(m.user) ? m.user[0] ?? null : m.user
      if (!u) continue
      const label = (u.full_name ?? '').trim() || u.email.split('@')[0]
      const list = membersByTeam.get(m.team_id) ?? []
      list.push(label)
      membersByTeam.set(m.team_id, list)
    }
  }

  const days: string[] = []
  {
    const start = new Date(`${from}T00:00:00.000Z`).getTime()
    const end = new Date(`${to}T00:00:00.000Z`).getTime()
    for (let t = start; t <= end; t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10))
    }
  }

  // Ce que le mode chantier sait dÃ©jÃ  : oÃ¹ c'est fermÃ©, oÃ¹ Ã§a dÃ©vie.
  const closedBySiteDay = new Set<string>()
  const exceptionBySiteDay = new Set<string>()
  for (const row of siteRows) {
    for (const [day, facts] of Object.entries(row.days)) {
      if (facts.closed) closedBySiteDay.add(`${row.siteId}::${day}`)
      if (facts.hasException) exceptionBySiteDay.add(`${row.siteId}::${day}`)
    }
  }

  const { data: intvRows } = await db
    .from('interventions')
    .select(
      'id, scheduled_for, status, assigned_team_id, template_id, missions!inner(site_id, sites!inner(id, organization_id))',
    )
    .gte('scheduled_for', from)
    .lte('scheduled_for', to)

  type Raw = {
    id: string
    scheduled_for: string
    status: string
    assigned_team_id: string | null
    template_id: string | null
    missions?: { sites?: { id?: string; organization_id?: string | null } }
  }
  const intv = ((intvRows ?? []) as unknown as Raw[])

  const rows = new Map<string, TeamMonthRow>()
  const ensure = (teamId: string): TeamMonthRow => {
    const existing = rows.get(teamId)
    if (existing) return existing
    const created: TeamMonthRow = {
      teamId,
      teamName: teamNames.get(teamId) ?? 'Ãquipe',
      members: membersByTeam.get(teamId) ?? [],
      days: Object.fromEntries(
        days.map((d) => [d, { worked: 0, projected: 0, conflicts: 0, hasException: false }]),
      ),
    }
    rows.set(teamId, created)
    return created
  }

  for (const r of intv) {
    const site = r.missions?.sites
    if (!site?.id) continue
    if (!orgIds.includes(site.organization_id ?? '')) continue
    if (!r.assigned_team_id || !teamNames.has(r.assigned_team_id)) continue
    if (r.status === 'skipped') continue

    const facts = ensure(r.assigned_team_id).days[r.scheduled_for]
    if (!facts) continue
    facts.worked += 1
    if (closedBySiteDay.has(`${site.id}::${r.scheduled_for}`)) facts.conflicts += 1
    if (exceptionBySiteDay.has(`${site.id}::${r.scheduled_for}`)) facts.hasException = true
  }

  // Ce que les roulements PROJETTENT au-delÃ  de l'horizon de gÃ©nÃ©ration : sans
  // eux, la fin du mois paraÃ®trait vide alors qu'elle est dÃ©jÃ  engagÃ©e.
  const { data: tplRows } = await db
    .from('intervention_templates')
    .select(
      'id, frequency, slots, day_of_week, day_of_month, planned_start_hhmm, planned_end_hhmm, starts_on, ends_on, cycle_length_weeks, anchor_date, week_index, assigned_team_id, mission_id, missions!inner(id, site_id, sites!inner(id, organization_id))',
    )
    .eq('active', true)
    .is('deleted_at', null)

  type RawTpl = ProjectableTemplate & {
    assigned_team_id: string | null
    missions?: { id?: string; site_id?: string; sites?: { id?: string; organization_id?: string | null } }
  }

  const templates: RawTpl[] = []
  const siteOfTemplate = new Map<string, string>()
  for (const t of ((tplRows ?? []) as unknown as RawTpl[])) {
    const site = t.missions?.sites
    if (!site?.id) continue
    if (!orgIds.includes(site.organization_id ?? '')) continue
    if (!t.assigned_team_id || !teamNames.has(t.assigned_team_id)) continue
    templates.push({ ...t, mission_id: t.missions?.id ?? t.mission_id })
    siteOfTemplate.set(t.id, site.id)
  }

  if (templates.length > 0) {
    // Jamais deux fois la mÃªme occurrence : si elle existe en base, elle est
    // dÃ©jÃ  comptÃ©e au-dessus (identitÃ© d'occurrence, mig 198).
    const materialized = new Set(
      intv.filter((r) => r.template_id).map((r) => `${r.template_id}::${r.scheduled_for}`),
    )
    const teamOfTemplate = new Map(templates.map((t) => [t.id, t.assigned_team_id as string]))

    for (const o of projectOccurrences({ templates, from, to })) {
      if (materialized.has(`${o.templateId}::${o.scheduledFor}`)) continue
      const teamId = teamOfTemplate.get(o.templateId)
      if (!teamId) continue

      const facts = ensure(teamId).days[o.scheduledFor]
      if (!facts) continue
      facts.projected += 1
      const siteId = siteOfTemplate.get(o.templateId)
      if (siteId && closedBySiteDay.has(`${siteId}::${o.scheduledFor}`)) facts.conflicts += 1
    }
  }

  return [...rows.values()].sort((a, b) => a.teamName.localeCompare(b.teamName, 'fr'))
}
