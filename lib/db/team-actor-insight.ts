import 'server-only'

// ── ÉCLAIRAGE ACTEUR D'UNE ÉQUIPE (Lot 2B.3C) ────────────────────────────────
// Complément LECTURE SEULE à la fiche équipe existante (/equipes/[id]) : apporte
// l'état d'attention COMMUN (politique partagée) + le bloc « actions portées par
// les membres ». NE crée PAS de nouvelle route, NE restructure PAS la page.
//
// Prudence imposée (Vincent) : l'action n'est JAMAIS assignée à une équipe (aucun
// site_actions.assigned_team_id). On n'affiche donc QUE « actions portées par les
// MEMBRES de l'équipe », jamais « actions de l'équipe ». Les actions portées sur
// un chantier où l'équipe n'est plus mobilisée sont signalées à part (orphelines).
//
// buildTeamActorInsight est PURE ; getTeamActorInsight charge les lignes filtrées
// par l'équipe (aucun scan de table), fail-closed hors org.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { deriveActorAttentionState, type AttentionState } from '@/lib/knowledge/actor-attention'

export interface TeamMemberActionRef {
  id: string
  title: string
  siteId: string
  siteName: string
  contactId: string
  contactName: string
  dueDate: string | null
  overdue: boolean
  href: string // /sites/{siteId}/action/{id}
}

export interface TeamActorInsight {
  attention: AttentionState
  /** Actions portées par les membres SUR les chantiers où l'équipe est mobilisée. */
  memberActions: TeamMemberActionRef[]
  /** Actions portées par des membres sur un chantier dont l'équipe est SORTIE. */
  orphanActions: TeamMemberActionRef[]
  openCount: number
  overdueCount: number
}

export interface TeamActorInsightInputs {
  today: string
  totalMembers: number      // connectés + terrain, actifs
  fieldMemberCount: number  // agents terrain actifs
  assignedSiteIds: string[] // chantiers où l'équipe est actuellement mobilisée
  memberOpenActions: Array<{ id: string; title: string; siteId: string; siteName: string; contactId: string; contactName: string; dueDate: string | null }>
}

/** Composition PURE. Attention via la politique commune (équipe : jamais 'urgent'). */
export function buildTeamActorInsight(input: TeamActorInsightInputs): TeamActorInsight {
  const { today } = input
  const assigned = new Set(input.assignedSiteIds)
  const toRef = (a: TeamActorInsightInputs['memberOpenActions'][number]): TeamMemberActionRef => ({
    ...a, overdue: !!a.dueDate && a.dueDate < today, href: `/sites/${a.siteId}/action/${a.id}`,
  })
  const memberActions = input.memberOpenActions.filter((a) => assigned.has(a.siteId)).map(toRef)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue))
  const orphanActions = input.memberOpenActions.filter((a) => !assigned.has(a.siteId)).map(toRef)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue))

  const attention = deriveActorAttentionState({
    kind: 'team',
    mobilized: input.assignedSiteIds.length > 0,
    hasAnyMember: input.totalMembers > 0,
    hasFieldMember: input.fieldMemberCount > 0,
    memberOrphanActions: orphanActions.length,
  })

  const all = [...memberActions, ...orphanActions]
  return {
    attention,
    memberActions,
    orphanActions,
    openCount: all.length,
    overdueCount: all.filter((a) => a.overdue).length,
  }
}

/**
 * Charge l'éclairage acteur d'une équipe, org-scopé et FAIL-CLOSED. Toutes les
 * requêtes filtrées par l'équipe / ses membres — aucun scan de table.
 */
export async function getTeamActorInsight(teamId: string, orgIds: string[]): Promise<TeamActorInsight | null> {
  if (orgIds.length === 0) return null
  const db = createAdminClient()
  const today = todayLocalIso()

  const { data: teamRow } = await db.from('teams').select('id, organization_id, deleted_at').eq('id', teamId).maybeSingle()
  const team = teamRow as { id: string; organization_id: string; deleted_at: string | null } | null
  if (!team || team.deleted_at || !orgIds.includes(team.organization_id)) return null

  const [tmRes, tfmRes, missionRes] = await Promise.all([
    db.from('team_members').select('user_id').eq('team_id', teamId).is('left_at', null),
    db.from('team_field_members').select('contact_id').eq('team_id', teamId).is('left_at', null),
    db.from('missions').select('site_id').eq('assigned_team_id', teamId).is('deleted_at', null),
  ])
  const connectedCount = ((tmRes.data ?? []) as Array<{ user_id: string }>).length
  const fieldContactIds = [...new Set(((tfmRes.data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))]
  const assignedSiteIds = [...new Set(((missionRes.data ?? []) as Array<{ site_id: string }>).map((r) => r.site_id))]

  // Actions ouvertes portées par les agents terrain de l'équipe.
  const actRes = fieldContactIds.length
    ? await db.from('site_actions').select('id, title, site_id, due_date, assigned_contact_id').in('assigned_contact_id', fieldContactIds).eq('status', 'open')
    : { data: [] as Array<{ id: string; title: string; site_id: string; due_date: string | null; assigned_contact_id: string }> }
  const act = (actRes.data ?? []) as Array<{ id: string; title: string; site_id: string; due_date: string | null; assigned_contact_id: string }>

  // Résolution des noms (sites concernés = missions ∪ actions ; contacts = agents terrain).
  const siteIds = [...new Set([...assignedSiteIds, ...act.map((a) => a.site_id)])]
  const [siteRes, contactRes] = await Promise.all([
    siteIds.length ? db.from('sites').select('id, name').in('id', siteIds).in('organization_id', orgIds).is('deleted_at', null) : Promise.resolve({ data: [] }),
    fieldContactIds.length ? db.from('company_contacts').select('id, full_name').in('id', fieldContactIds) : Promise.resolve({ data: [] }),
  ])
  const siteNameById = new Map(((siteRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const contactNameById = new Map(((contactRes.data ?? []) as Array<{ id: string; full_name: string }>).map((c) => [c.id, c.full_name]))

  return buildTeamActorInsight({
    today,
    totalMembers: connectedCount + fieldContactIds.length,
    fieldMemberCount: fieldContactIds.length,
    assignedSiteIds,
    memberOpenActions: act.map((a) => ({
      id: a.id, title: a.title, siteId: a.site_id, siteName: siteNameById.get(a.site_id) ?? 'Chantier',
      contactId: a.assigned_contact_id, contactName: contactNameById.get(a.assigned_contact_id) ?? 'Membre',
      dueDate: a.due_date,
    })),
  })
}
