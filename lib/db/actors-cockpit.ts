import 'server-only'

// ── COCKPIT DES ACTEURS (Lot 2B.2) ───────────────────────────────────────────
// Plus un annuaire (« qui existe ? ») mais un cockpit : « qui agit, où, avec qui,
// sur quoi, et qui requiert mon attention ? ».
// Read model DISCRIMINÉ person | company | team, org-scopé, LECTURE SEULE. Chaque
// acteur reste dans son entité (company_contacts / companies / teams) — jamais
// fusionné. On n'expose QUE des données réellement dérivables (cf. cadrage
// docs/foundations/2026-07-27-intervenants-repertoire-cadrage.md). Aucune
// « dernière activité » approximative ; le statut est déterministe et l'état
// d'attention provient de la POLITIQUE COMMUNE (lib/knowledge/actor-attention).
//
// La composition (buildActorsCockpit) est PURE et testable sans base : getActorsCockpit
// se contente de charger les lignes org-scopées puis délègue au calcul déterministe.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { deriveActorAttentionState, type AttentionState } from '@/lib/knowledge/actor-attention'

export type ActorKind = 'person' | 'company' | 'team'
export type ActorStatus = 'active' | 'incomplete' | 'historical'

export interface CockpitActor {
  kind: ActorKind
  id: string
  name: string
  /** Sous-titre lisible (catégorie/métier · quelques faits). */
  subtitle: string
  status: ActorStatus
  openActions: number
  overdueActions: number
  /** État d'attention issu de la POLITIQUE COMMUNE (le cockpit en est un client). */
  attention: AttentionState
  /** Compte utilisateur probablement lié (heuristique e-mail/nom) — signal, jamais fusion. */
  linkedAccountHint: boolean
  /** Surface propriétaire (fiche existante) quand elle existe ; null sinon (fiche 2B.3). */
  href: string | null
}

export interface ActorsCockpit {
  actors: CockpitActor[]
  /** Deux familles : ATTENTION (ce qui appelle une action) et VOLUME (contexte discret). */
  counters: {
    // ── Volume (contexte, discret) ──
    personsActive: number
    companiesActive: number
    teamsActive: number
    // ── Attention (ce qui doit remonter en haut de page) ──
    actionsWithoutOwner: number  // actions ouvertes sans aucun responsable (ni personne ni entreprise)
    companiesOverdue: number     // entreprises distinctes avec au moins une action en retard
    agentsWithoutTeam: number
    companiesActionsNoReferent: number
    detectedUnconfirmed: number  // propositions d'intervenants (stakeholder) non confirmées, org-globales
    overdueActions: number       // total d'actions ouvertes en retard (personne OU entreprise)
  }
}

/** Entrées brutes déjà org-scopées et pré-filtrées (placeholders/supprimés exclus côté fetch). */
export interface ActorsCockpitInputs {
  today: string
  companies: Array<{ id: string; name: string; short_name: string | null }>
  contacts: Array<{ id: string; full_name: string; function: string | null; company_id: string | null; is_internal_agent: boolean; email: string | null }>
  teams: Array<{ id: string; name: string }>
  users: Array<{ id: string; full_name: string | null; email: string; role: string }>
  teamMembers: Array<{ team_id: string; user_id: string }>       // team_members actifs (left_at null)
  fieldMembers: Array<{ team_id: string; contact_id: string }>   // team_field_members actifs
  missions: Array<{ site_id: string; assigned_team_id: string }> // missions actives avec équipe
  casting: Array<{ company_id: string; main_contact_id: string | null; role: string }> // casting actif
  actions: Array<{ assigned_contact_id: string | null; assigned_company_id: string | null; due_date: string | null }> // actions ouvertes
  proposalCount: number  // propositions stakeholder « proposed »
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Composition PURE du répertoire. Déterministe : mêmes entrées → même sortie.
 * Ne dépend d'aucune surface ni d'aucun I/O — testable directement.
 */
export function buildActorsCockpit(input: ActorsCockpitInputs): ActorsCockpit {
  const { today, companies, contacts, teams, users, teamMembers, fieldMembers, missions, casting, actions, proposalCount } = input
  const companyNameById = new Map(companies.map((c) => [c.id, c.short_name || c.name]))
  const teamNameById = new Map(teams.map((t) => [t.id, t.name]))
  const isOverdue = (d: string | null) => !!d && d < today

  // Index d'appartenance / activité.
  const teamMembersCount = new Map<string, number>()
  for (const r of teamMembers) teamMembersCount.set(r.team_id, (teamMembersCount.get(r.team_id) ?? 0) + 1)
  for (const r of fieldMembers) teamMembersCount.set(r.team_id, (teamMembersCount.get(r.team_id) ?? 0) + 1)
  const contactTeams = new Map<string, Set<string>>()
  for (const r of fieldMembers) { const s = contactTeams.get(r.contact_id) ?? new Set<string>(); s.add(r.team_id); contactTeams.set(r.contact_id, s) }
  const userTeams = new Map<string, Set<string>>()
  for (const r of teamMembers) { const s = userTeams.get(r.user_id) ?? new Set<string>(); s.add(r.team_id); userTeams.set(r.user_id, s) }
  const teamSites = new Map<string, Set<string>>()
  for (const m of missions) { const s = teamSites.get(m.assigned_team_id) ?? new Set<string>(); s.add(m.site_id); teamSites.set(m.assigned_team_id, s) }
  const teamFieldMembers = new Map<string, string[]>() // teamId → contactIds
  for (const r of fieldMembers) { const arr = teamFieldMembers.get(r.team_id) ?? []; arr.push(r.contact_id); teamFieldMembers.set(r.team_id, arr) }
  const activeCastingCompanies = new Set(casting.map((c) => c.company_id))
  const activeCastingContacts = new Set(casting.map((c) => c.main_contact_id).filter((v): v is string => !!v))

  // Actions par acteur — ouvertes + en retard.
  const openByContact = new Map<string, number>(); const overdueByContact = new Map<string, number>()
  const openByCompany = new Map<string, number>(); const overdueByCompany = new Map<string, number>(); const noReferentByCompany = new Map<string, number>()
  let actionsWithoutOwner = 0 // action ouverte SANS aucun responsable (ni personne ni entreprise)
  for (const a of actions) {
    if (a.assigned_contact_id) {
      openByContact.set(a.assigned_contact_id, (openByContact.get(a.assigned_contact_id) ?? 0) + 1)
      if (isOverdue(a.due_date)) overdueByContact.set(a.assigned_contact_id, (overdueByContact.get(a.assigned_contact_id) ?? 0) + 1)
    }
    if (a.assigned_company_id) {
      openByCompany.set(a.assigned_company_id, (openByCompany.get(a.assigned_company_id) ?? 0) + 1)
      if (isOverdue(a.due_date)) overdueByCompany.set(a.assigned_company_id, (overdueByCompany.get(a.assigned_company_id) ?? 0) + 1)
      if (!a.assigned_contact_id) noReferentByCompany.set(a.assigned_company_id, (noReferentByCompany.get(a.assigned_company_id) ?? 0) + 1)
    }
    if (!a.assigned_contact_id && !a.assigned_company_id) actionsWithoutOwner++
  }

  // Rapprochement compte↔contact : par e-mail exact, sinon nom normalisé.
  const userByEmail = new Map<string, string>(); const userByName = new Map<string, string>()
  for (const u of users) {
    if (u.email) userByEmail.set(u.email.toLowerCase(), u.id)
    if (u.full_name) userByName.set(norm(u.full_name), u.id)
  }
  const matchedUserIds = new Set<string>()

  const actors: CockpitActor[] = []

  // ── PERSONNES : company_contacts d'abord ────────────────────────────────────
  for (const c of contacts) {
    const activeTeam = (contactTeams.get(c.id)?.size ?? 0) > 0
    const activeCasting = activeCastingContacts.has(c.id)
    const open = openByContact.get(c.id) ?? 0
    const overdue = overdueByContact.get(c.id) ?? 0
    const active = activeTeam || activeCasting || open > 0
    const category = c.is_internal_agent ? 'Agent interne' : (c.company_id ? 'Contact externe' : 'Contact')
    const teamNames = [...(contactTeams.get(c.id) ?? [])].map((t) => teamNameById.get(t)).filter(Boolean)
    const companyName = c.company_id ? companyNameById.get(c.company_id) ?? null : null
    const subtitleBits = [category, c.function, companyName, teamNames.length ? `Équipe ${teamNames[0]}` : null].filter(Boolean)
    const incomplete = !active && ((c.is_internal_agent && !activeTeam) || (!c.is_internal_agent && !c.company_id))
    const status: ActorStatus = active ? 'active' : incomplete ? 'incomplete' : 'historical'
    const attention = deriveActorAttentionState({
      kind: 'person',
      overdueActions: overdue,
      responsibleButNotActive: open > 0 && !active,
      internalAgentWithoutTeam: c.is_internal_agent && !activeTeam,
    })
    const matchUserId = (c.email && userByEmail.get(c.email.toLowerCase())) || userByName.get(norm(c.full_name)) || null
    if (matchUserId) matchedUserIds.add(matchUserId)
    actors.push({
      kind: 'person', id: c.id, name: c.full_name, subtitle: subtitleBits.join(' · '),
      status, openActions: open, overdueActions: overdue, attention,
      linkedAccountHint: !!matchUserId, href: null, // fiche personne = 2B.3
    })
  }

  // ── PERSONNES : comptes users AVEC présence métier (équipe active) et NON déjà
  //    représentés par un contact (dédup par rapprochement) ────────────────────
  for (const u of users) {
    const activeTeam = (userTeams.get(u.id)?.size ?? 0) > 0
    if (!activeTeam) continue // pas de présence métier dérivable → hors répertoire
    if (matchedUserIds.has(u.id)) continue // déjà présent via un contact (pas de doublon)
    const teamNames = [...(userTeams.get(u.id) ?? [])].map((t) => teamNameById.get(t)).filter(Boolean)
    actors.push({
      kind: 'person', id: u.id, name: u.full_name || u.email, subtitle: ['Compte', teamNames.length ? `Équipe ${teamNames[0]}` : null].filter(Boolean).join(' · '),
      status: 'active', openActions: 0, overdueActions: 0,
      attention: deriveActorAttentionState({ kind: 'person', overdueActions: 0, responsibleButNotActive: false, internalAgentWithoutTeam: false }),
      linkedAccountHint: false,
      href: `/intervenants/${u.id}`, // fiche compte existante
    })
  }

  // ── ENTREPRISES ─────────────────────────────────────────────────────────────
  for (const co of companies) {
    const activeCasting = activeCastingCompanies.has(co.id)
    const open = openByCompany.get(co.id) ?? 0
    const overdue = overdueByCompany.get(co.id) ?? 0
    const noRef = noReferentByCompany.get(co.id) ?? 0
    const roles = [...new Set(casting.filter((x) => x.company_id === co.id).map((x) => x.role))]
    const contactCount = contacts.filter((x) => x.company_id === co.id).length
    const active = activeCasting || open > 0
    const status: ActorStatus = active ? 'active' : (contactCount === 0 ? 'incomplete' : 'historical')
    const attention = deriveActorAttentionState({
      kind: 'company',
      overdueActions: overdue,
      actionsWithoutReferent: noRef,
      leftCastingWithOpenActions: open > 0 && !activeCasting,
    })
    const subtitleBits = [roles.join(', ') || null, `${contactCount} contact${contactCount > 1 ? 's' : ''}`].filter(Boolean)
    actors.push({
      kind: 'company', id: co.id, name: co.short_name || co.name, subtitle: subtitleBits.join(' · '),
      status, openActions: open, overdueActions: overdue, attention, linkedAccountHint: false,
      href: null, // fiche entreprise = 2B.3
    })
  }

  // ── ÉQUIPES ─────────────────────────────────────────────────────────────────
  for (const t of teams) {
    const members = teamMembersCount.get(t.id) ?? 0
    const sites = teamSites.get(t.id)?.size ?? 0
    const affected = sites > 0
    const agentIds = new Set(teamFieldMembers.get(t.id) ?? [])
    let teamOpen = 0; let teamOverdue = 0
    for (const [contactId, n] of openByContact) if (agentIds.has(contactId)) teamOpen += n
    for (const [contactId, n] of overdueByContact) if (agentIds.has(contactId)) teamOverdue += n
    const active = affected || members > 0
    const status: ActorStatus = affected ? 'active' : (members === 0 ? 'incomplete' : 'historical')
    const attention = deriveActorAttentionState({
      kind: 'team',
      emptyButAssigned: members === 0 && affected,
      activeWithoutFieldMember: active && agentIds.size === 0,
      memberOrphanActions: 0, // détail par membre reporté à la fiche Équipe (2B.3C)
    })
    const subtitleBits = [`${members} personne${members > 1 ? 's' : ''}`, sites ? `${sites} chantier${sites > 1 ? 's' : ''}` : null].filter(Boolean)
    actors.push({
      kind: 'team', id: t.id, name: t.name, subtitle: subtitleBits.join(' · '),
      status, openActions: teamOpen, overdueActions: teamOverdue, attention, linkedAccountHint: false,
      href: `/equipes/${t.id}`, // fiche équipe existante
    })
  }

  // ── Compteurs (fiables) ─────────────────────────────────────────────────────
  const personsActive = actors.filter((a) => a.kind === 'person' && a.status === 'active').length
  const companiesActive = actors.filter((a) => a.kind === 'company' && a.status === 'active').length
  const teamsActive = actors.filter((a) => a.kind === 'team' && a.status === 'active').length
  const overdueActions = [...overdueByContact.values()].reduce((s, n) => s + n, 0) + [...overdueByCompany.values()].reduce((s, n) => s + n, 0)
  const hasCode = (a: CockpitActor, code: string) => a.attention.reasons.some((r) => r.code === code)
  const agentsWithoutTeam = actors.filter((a) => a.kind === 'person' && hasCode(a, 'agent_no_team')).length
  const companiesActionsNoReferent = actors.filter((a) => a.kind === 'company' && hasCode(a, 'company_no_referent')).length
  const companiesOverdue = actors.filter((a) => a.kind === 'company' && hasCode(a, 'overdue_actions')).length

  return {
    actors,
    counters: {
      personsActive, companiesActive, teamsActive,
      actionsWithoutOwner, companiesOverdue, agentsWithoutTeam, companiesActionsNoReferent, detectedUnconfirmed: proposalCount, overdueActions,
    },
  }
}

/**
 * Charge les lignes org-scopées puis délègue à la composition pure. Fail-closed :
 * sans org → répertoire vide.
 */
export async function getActorsCockpit(orgIds: string[]): Promise<ActorsCockpit> {
  if (orgIds.length === 0) return buildActorsCockpit(emptyInputs())
  const db = createAdminClient()
  const today = todayLocalIso()

  // ── Entités de base (org-scopées) ──────────────────────────────────────────
  const [companyRes, contactRes, teamRes, userRes, siteRes] = await Promise.all([
    db.from('companies').select('id, name, short_name, is_placeholder, deleted_at').in('organization_id', orgIds),
    db.from('company_contacts').select('id, full_name, function, company_id, is_internal_agent, email, deleted_at').in('organization_id', orgIds),
    db.from('teams').select('id, name, deleted_at').in('organization_id', orgIds).is('deleted_at', null),
    db.from('users').select('id, full_name, email, role').in('organization_id', orgIds),
    db.from('sites').select('id').in('organization_id', orgIds).is('deleted_at', null),
  ])
  const companies = ((companyRes.data ?? []) as Array<{ id: string; name: string; short_name: string | null; is_placeholder: boolean; deleted_at: string | null }>)
    .filter((c) => !c.is_placeholder && !c.deleted_at)
    .map((c) => ({ id: c.id, name: c.name, short_name: c.short_name }))
  const contacts = ((contactRes.data ?? []) as Array<{ id: string; full_name: string; function: string | null; company_id: string | null; is_internal_agent: boolean; email: string | null; deleted_at: string | null }>)
    .filter((c) => !c.deleted_at)
    .map((c) => ({ id: c.id, full_name: c.full_name, function: c.function, company_id: c.company_id, is_internal_agent: c.is_internal_agent, email: c.email }))
  const teams = (teamRes.data ?? []) as Array<{ id: string; name: string }>
  const users = (userRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string }>
  const siteIds = ((siteRes.data ?? []) as Array<{ id: string }>).map((s) => s.id)

  // ── Relations (org / sites) ─────────────────────────────────────────────────
  const [tmRes, tfmRes, missionRes, castingRes, actionRes, proposalRes] = await Promise.all([
    db.from('team_members').select('team_id, user_id').is('left_at', null).in('organization_id', orgIds),
    db.from('team_field_members').select('team_id, contact_id').is('left_at', null).in('organization_id', orgIds),
    siteIds.length ? db.from('missions').select('site_id, assigned_team_id').in('site_id', siteIds).is('deleted_at', null).not('assigned_team_id', 'is', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_intervenants').select('company_id, main_contact_id, role').in('site_id', siteIds).is('effective_to', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_actions').select('assigned_contact_id, assigned_company_id, due_date').in('site_id', siteIds).eq('status', 'open') : Promise.resolve({ data: [] }),
    db.from('site_knowledge_proposals').select('id').in('organization_id', orgIds).eq('kind', 'stakeholder').eq('status', 'proposed'),
  ])

  return buildActorsCockpit({
    today,
    companies,
    contacts,
    teams,
    users,
    teamMembers: (tmRes.data ?? []) as Array<{ team_id: string; user_id: string }>,
    fieldMembers: (tfmRes.data ?? []) as Array<{ team_id: string; contact_id: string }>,
    missions: (missionRes.data ?? []) as Array<{ site_id: string; assigned_team_id: string }>,
    casting: (castingRes.data ?? []) as Array<{ company_id: string; main_contact_id: string | null; role: string }>,
    actions: (actionRes.data ?? []) as Array<{ assigned_contact_id: string | null; assigned_company_id: string | null; due_date: string | null }>,
    proposalCount: ((proposalRes.data ?? []) as Array<{ id: string }>).length,
  })
}

function emptyInputs(): ActorsCockpitInputs {
  return { today: todayLocalIso(), companies: [], contacts: [], teams: [], users: [], teamMembers: [], fieldMembers: [], missions: [], casting: [], actions: [], proposalCount: 0 }
}
