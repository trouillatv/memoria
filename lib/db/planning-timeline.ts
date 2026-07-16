import 'server-only'

// ── LE PLANNING EST UNE CHRONOLOGIE, PAS UNE GRILLE D'INTERVENTIONS ──────────
// Un conducteur ne demande pas « quelles interventions ai-je ? » mais « que se
// passe-t-il sur ce chantier, aujourd'hui et dans les jours qui viennent ? ».
// Interventions, visites, réunions, échéances, roulements et fermetures vivaient
// dans des circuits séparés : chaque écran en lisait un, aucun ne les réunissait.
//
// LA RÈGLE (Vincent, 2026-07-17), non négociable :
//
//   Le Planning affiche immédiatement tout événement RÉEL ou toute proposition
//   DATÉE qui existe. Les événements futurs qui n'ont pas encore de modèle métier
//   sont créés dans des sprints séparés — JAMAIS simulés.
//
// Deux conséquences qu'on assume, et qu'on ne contourne pas :
//
//   · Aucune VISITE PRÉVUE. Une visite naît en démarrant (`started_at = maintenant`) :
//     il n'existe aucune visite planifiée dans le modèle. On affiche donc « visite
//     en cours » et « visite terminée », jamais « visite prévue ». Le futur proche
//     n'a aucune visite — et c'est honnête.
//   · `next_meeting_at` N'EST PAS une réunion. C'est une date portée par le CR
//     précédent, sans heure, sans participants, sans déroulé. On la montre comme
//     « Réunion à organiser · date indicative · à confirmer » — une intention.
//     Lui inventer une heure donnerait une certitude que le modèle ne possède pas.
//
// Les objets restent spécialisés en ÉCRITURE ; la timeline les unifie en LECTURE.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { projectClosures, CLOSURE_REASON_FR } from '@/lib/planning/closures'
import { echeanceDateLabel } from '@/lib/visits/echeance-labels'
import { todayLocalIso } from '@/lib/time/local-date'
import {
  sortTimeline,
  type PlanningTimelineEvent,
  type PlanningRange,
  type PlanningFilters,
  type PlanningEventStatus,
} from '@/lib/planning/timeline-contract'

/** Bornes instant d'une plage civile Nouméa (UTC+11). */
function bounds(range: PlanningRange): { from: string; to: string } {
  return { from: `${range.from}T00:00:00.000+11:00`, to: `${range.to}T23:59:59.999+11:00` }
}

function statusOfDate(dayIso: string, todayIso: string): PlanningEventStatus {
  if (dayIso < todayIso) return 'overdue'
  return 'upcoming'
}

/**
 * TOUS les événements datés d'une période. Un seul contrat de lecture ; le Jour,
 * la Semaine et le Mois n'en changent que la densité.
 */
export async function getPlanningTimeline(
  range: PlanningRange,
  filters: PlanningFilters = {},
): Promise<PlanningTimelineEvent[]> {
  const db = createAdminClient()
  const orgId = await getOrgId()
  const { from, to } = bounds(range)
  const today = todayLocalIso()
  const out: PlanningTimelineEvent[] = []

  // Les chantiers du périmètre — fail-closed sur l'organisation (le service-role
  // bypasse la RLS : sans ce filtre, un id suffirait à lire chez un autre client).
  let sq = db.from('sites').select('id, name').is('deleted_at', null)
  if (orgId) sq = sq.eq('organization_id', orgId)
  if (filters.siteIds?.length) sq = sq.in('id', filters.siteIds)
  const { data: siteRows } = await sq
  const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
  if (sites.length === 0) return []
  const siteIds = sites.map((s) => s.id)
  const nameOf = new Map(sites.map((s) => [s.id, s.name]))

  // ── INTERVENTIONS ──────────────────────────────────────────────────────────
  const { data: missionRows } = await db
    .from('missions').select('id, name, site_id').in('site_id', siteIds).is('deleted_at', null)
  const missions = (missionRows ?? []) as Array<{ id: string; name: string; site_id: string }>
  if (missions.length > 0) {
    let iq = db
      .from('interventions')
      .select('id, mission_id, status, scheduled_for, scheduled_at, planned_start, assigned_team_id, label')
      .in('mission_id', missions.map((m) => m.id))
      .gte('scheduled_for', range.from)
      .lte('scheduled_for', range.to)
      .neq('status', 'skipped')
    if (filters.teamId) iq = iq.eq('assigned_team_id', filters.teamId)
    const { data: intvRows } = await iq
    const missionOf = new Map(missions.map((m) => [m.id, m]))
    for (const i of (intvRows ?? []) as Array<Record<string, unknown>>) {
      const mission = missionOf.get(i.mission_id as string)
      if (!mission) continue
      const done = i.status === 'completed' || i.status === 'validated'
      const day = (i.scheduled_for as string) ?? String(i.scheduled_at ?? '').slice(0, 10)
      out.push({
        id: `intervention-${i.id}`,
        type: 'intervention',
        siteId: mission.site_id,
        siteName: nameOf.get(mission.site_id) ?? '',
        title: (i.label as string) || mission.name,
        // L'heure si elle est connue, la date sinon — jamais un horaire fabriqué.
        start: (i.planned_start as string) ? `${day}T${String(i.planned_start).slice(0, 5)}:00+11:00` : day,
        end: null,
        status: i.status === 'cancelled' ? 'cancelled' : done ? 'done' : statusOfDate(day, today),
        certainty: 'confirmed',
        source: 'intervention',
        href: `/interventions/${i.id}`,
        detail: mission.name,
      })
    }
  }

  // ── VISITES ────────────────────────────────────────────────────────────────
  // En cours ou terminées, jamais « prévue » : la visite planifiée n'existe pas
  // dans le modèle, et l'inventer serait promettre un rendez-vous que personne
  // n'a pris.
  const { data: visitRows } = await db
    .from('site_reports')
    .select('id, site_id, started_at, ended_at, objective, origin')
    .in('site_id', siteIds)
    .not('origin', 'is', null)
    .is('deleted_at', null)
    .gte('started_at', from)
    .lte('started_at', to)
  for (const v of (visitRows ?? []) as Array<Record<string, unknown>>) {
    const siteId = v.site_id as string
    out.push({
      id: `visite-${v.id}`,
      type: 'visite',
      siteId,
      siteName: nameOf.get(siteId) ?? '',
      title: (v.objective as string)?.trim() || 'Visite terrain',
      start: v.started_at as string,
      end: (v.ended_at as string) ?? null,
      status: v.ended_at ? 'done' : 'in_progress',
      certainty: 'confirmed',
      source: 'visite',
      href: `/m/visite/${v.id}/cr`,
      detail: v.ended_at ? 'Visite terminée' : 'Visite en cours',
    })
  }

  // ── RÉUNIONS TENUES ────────────────────────────────────────────────────────
  const { data: meetingRows } = await db
    .from('site_reports')
    .select('id, site_id, title, created_at, next_meeting_at')
    .in('site_id', siteIds)
    .is('origin', null)
    .is('deleted_at', null)
    .gte('created_at', from)
    .lte('created_at', to)
  for (const m of (meetingRows ?? []) as Array<Record<string, unknown>>) {
    const siteId = m.site_id as string
    out.push({
      id: `reunion-${m.id}`,
      type: 'reunion',
      siteId,
      siteName: nameOf.get(siteId) ?? '',
      title: (m.title as string)?.trim() || 'Réunion de chantier',
      start: m.created_at as string,
      end: null,
      status: 'done',
      certainty: 'confirmed',
      source: 'reunion',
      href: `/meetings/${m.id}`,
      detail: null,
    })
  }

  // ── RÉUNIONS À ORGANISER ───────────────────────────────────────────────────
  // `next_meeting_at` est une DATE posée sur un CR — pas un objet réunion. On
  // dédouble par chantier+jour : plusieurs CR peuvent annoncer la même.
  const { data: nextRows } = await db
    .from('site_reports')
    .select('id, site_id, next_meeting_at')
    .in('site_id', siteIds)
    .not('next_meeting_at', 'is', null)
    .is('deleted_at', null)
    .gte('next_meeting_at', range.from)
    .lte('next_meeting_at', range.to)
  const seenIntent = new Set<string>()
  for (const n of (nextRows ?? []) as Array<Record<string, unknown>>) {
    const siteId = n.site_id as string
    const day = n.next_meeting_at as string
    const key = `${siteId}|${day}`
    if (seenIntent.has(key)) continue
    seenIntent.add(key)
    out.push({
      id: `reunion-intention-${key}`,
      type: 'reunion_a_organiser',
      siteId,
      siteName: nameOf.get(siteId) ?? '',
      title: 'Réunion à organiser',
      start: day,
      end: null,
      status: statusOfDate(day, today),
      // Une intention, pas un engagement : personne ne l'a encore confirmée.
      certainty: 'proposed',
      source: 'next_meeting_at',
      href: `/sites/${siteId}`,
      detail: `Date indicative : ${echeanceDateLabel(day)}`,
    })
  }

  // ── ACTIONS DATÉES ─────────────────────────────────────────────────────────
  const { data: actionRows } = await db
    .from('site_actions')
    .select('id, site_id, title, due_date, status')
    .in('site_id', siteIds)
    .not('due_date', 'is', null)
    .gte('due_date', range.from)
    .lte('due_date', range.to)
    .is('deleted_at', null)
  for (const a of (actionRows ?? []) as Array<Record<string, unknown>>) {
    const siteId = a.site_id as string
    const day = a.due_date as string
    const done = a.status === 'done'
    out.push({
      id: `action-${a.id}`,
      type: 'action',
      siteId,
      siteName: nameOf.get(siteId) ?? '',
      title: a.title as string,
      start: day,
      end: null,
      status: a.status === 'cancelled' ? 'cancelled' : done ? 'done' : statusOfDate(day, today),
      certainty: 'confirmed',
      source: 'site_action',
      href: `/sites/${siteId}/actions`,
      detail: null,
    })
  }

  // ── ÉCHÉANCES ──────────────────────────────────────────────────────────────
  // Seules les DATÉES entrent dans une chronologie : une échéance « à planifier »
  // n'a pas de jour, donc pas de place ici — elle attend dans sa section dédiée.
  // La poser sur une date déduite de « sous dix jours » serait inventer.
  const deadlineLists = await Promise.all(siteIds.map((id) => listSiteDeadlines(id).catch(() => [])))
  deadlineLists.flat().forEach((d) => {
    if (!d.due_date || d.due_date < range.from || d.due_date > range.to) return
    out.push({
      id: `echeance-${d.id}`,
      type: 'echeance',
      siteId: d.site_id,
      siteName: nameOf.get(d.site_id) ?? '',
      title: d.title,
      start: d.due_date,
      end: null,
      status: statusOfDate(d.due_date, today),
      certainty: 'confirmed',
      source: 'site_deadline',
      href: `/sites/${d.site_id}?tab=planning`,
      detail: d.constraint_text,
    })
  })

  // ── FERMETURES ─────────────────────────────────────────────────────────────
  // `listActiveClosuresForSites` renvoie DÉJÀ un Record<siteId, fermetures> : on ne
  // regroupe pas ce qui l'est. `projectClosures` étale ensuite chaque période sur
  // ses jours — la logique de fermeture reste pure et partagée avec la Semaine.
  const closuresBySite = await listActiveClosuresForSites(siteIds, range.from, range.to).catch(
    () => ({} as Record<string, SiteClosure[]>),
  )
  for (const [siteId, list] of Object.entries(closuresBySite)) {
    const projected = projectClosures({ closures: list, from: range.from, to: range.to })
    for (const [day, closure] of Object.entries(projected)) {
      out.push({
        id: `fermeture-${siteId}-${day}`,
        type: 'fermeture',
        siteId,
        siteName: nameOf.get(siteId) ?? '',
        title: CLOSURE_REASON_FR[closure.reasonKind] ?? 'Chantier fermé',
        start: day,
        end: null,
        status: statusOfDate(day, today),
        certainty: 'confirmed',
        source: 'site_closure',
        href: '/calendrier',
        detail: closure.reason,
      })
    }
  }

  // ── BLOCAGES DATÉS ─────────────────────────────────────────────────────────
  // Un blocage n'est un événement de la chronologie que s'il a une date exploitable
  // DANS la plage. Un blocage ouvert depuis des mois n'appartient pas à un jour :
  // c'est un état, et il vit ailleurs.
  const blocageLists = await Promise.all(siteIds.map((id) => listBlocagesBySite(id).catch(() => [])))
  blocageLists.flat().forEach((b) => {
    if (!b.dateStart || b.dateStart < range.from || b.dateStart > range.to) return
    out.push({
      id: `blocage-${b.id}`,
      type: 'blocage',
      siteId: b.siteId,
      siteName: nameOf.get(b.siteId) ?? '',
      title: b.title,
      start: b.dateStart,
      end: b.dateEnd,
      status: b.dateEnd ? 'done' : 'in_progress',
      certainty: 'confirmed',
      source: 'site_blocage',
      href: `/sites/${b.siteId}/reserves`,
      detail: b.impact ?? b.description,
    })
  })

  const filtered = filters.types?.length
    ? out.filter((e) => filters.types!.includes(e.type))
    : out
  return sortTimeline(filtered)
}
