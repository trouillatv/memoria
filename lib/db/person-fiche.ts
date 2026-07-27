import 'server-only'

// ── FICHE PERSONNE (Lot 2B.3A) ───────────────────────────────────────────────
// Read model d'UN contact (company_contacts), org-globale et LECTURE SEULE. Répond
// « qui est cette personne, où intervient-elle, qu'attend-on d'elle ? ». N'affiche
// que des relations structurellement fiables (pas de « visite citée » JSONB, cf.
// cadrage 2B.3 §12). L'état d'attention vient de la POLITIQUE COMMUNE — la fiche et
// le cockpit montrent donc le MÊME état.
//
// buildPersonFiche est PURE (testable sans base) ; getPersonFiche charge les lignes
// org-scopées (fail-closed) et délègue. Perf : on filtre par les ids du sujet, jamais
// de scan de table entière.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { deriveActorAttentionState, type AttentionState } from '@/lib/knowledge/actor-attention'
import type { ActorStatus } from '@/lib/db/actors-cockpit'

export interface FicheActionRef {
  id: string
  title: string
  siteId: string
  siteName: string
  dueDate: string | null
  overdue: boolean
  href: string // surface propriétaire : /sites/{siteId}/action/{id}
}

export interface FicheCastingRow {
  siteId: string
  siteName: string
  role: string
  active: boolean
  href: string // /sites/{siteId}
}

export interface FicheTeamRow {
  id: string
  name: string
  active: boolean
  href: string // /equipes/{id}
}

export interface FicheDecisionRow {
  id: string
  title: string
  siteId: string
  siteName: string
  date: string | null
}

export interface PersonFiche {
  id: string
  name: string
  category: 'Agent interne' | 'Contact externe' | 'Contact'
  function: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  companyId: string | null
  companyName: string | null
  status: ActorStatus
  attention: AttentionState
  /** Compte utilisateur probablement lié (heuristique) — signal, JAMAIS fusion. */
  linkedAccountUserId: string | null
  // Situation actuelle
  actionsAsReferent: FicheActionRef[]
  /** Actions dont SON entreprise est responsable (contexte, ne pilote pas SON attention). */
  actionsViaCompany: FicheActionRef[]
  overdueCount: number
  // Organisation
  teams: FicheTeamRow[]
  casting: FicheCastingRow[]
  // Historique utile
  decisions: FicheDecisionRow[]
}

/** Entrées brutes déjà résolues (noms de sites/entreprise joints côté fetch). */
export interface PersonFicheInputs {
  today: string
  contact: { id: string; full_name: string; function: string | null; company_id: string | null; is_internal_agent: boolean; email: string | null; phone: string | null; mobile: string | null }
  companyName: string | null
  teams: Array<{ id: string; name: string; active: boolean }>
  casting: Array<{ siteId: string; siteName: string; role: string; active: boolean }>
  referentActions: Array<{ id: string; title: string; siteId: string; siteName: string; dueDate: string | null }>
  companyActions: Array<{ id: string; title: string; siteId: string; siteName: string; dueDate: string | null }>
  decisions: Array<{ id: string; title: string; siteId: string; siteName: string; date: string | null }>
  linkedAccountUserId: string | null
}

function toActionRef(a: { id: string; title: string; siteId: string; siteName: string; dueDate: string | null }, today: string): FicheActionRef {
  return {
    id: a.id, title: a.title, siteId: a.siteId, siteName: a.siteName, dueDate: a.dueDate,
    overdue: !!a.dueDate && a.dueDate < today,
    href: `/sites/${a.siteId}/action/${a.id}`,
  }
}

/** Composition PURE de la fiche. Déterministe ; l'attention suit la politique commune. */
export function buildPersonFiche(input: PersonFicheInputs): PersonFiche {
  const { today, contact } = input
  const category = contact.is_internal_agent ? 'Agent interne' : (contact.company_id ? 'Contact externe' : 'Contact')
  const actionsAsReferent = input.referentActions.map((a) => toActionRef(a, today))
  const actionsViaCompany = input.companyActions.map((a) => toActionRef(a, today))
  const overdueCount = actionsAsReferent.filter((a) => a.overdue).length

  const activeTeam = input.teams.some((t) => t.active)
  const activeCasting = input.casting.some((c) => c.active)
  const active = activeTeam || activeCasting || actionsAsReferent.length > 0
  const status: ActorStatus = active
    ? 'active'
    : (contact.is_internal_agent && !activeTeam) || (!contact.is_internal_agent && !contact.company_id)
      ? 'incomplete'
      : 'historical'

  // Attention alignée sur le cockpit : SON overdue = actions dont elle est référent
  // (les actions via son entreprise n'engagent pas SON état).
  const attention = deriveActorAttentionState({
    kind: 'person',
    overdueActions: overdueCount,
    responsibleButNotActive: actionsAsReferent.length > 0 && !active,
    internalAgentWithoutTeam: contact.is_internal_agent && !activeTeam,
  })

  return {
    id: contact.id,
    name: contact.full_name,
    category,
    function: contact.function,
    email: contact.email,
    phone: contact.phone,
    mobile: contact.mobile,
    companyId: contact.company_id,
    companyName: input.companyName,
    status,
    attention,
    linkedAccountUserId: input.linkedAccountUserId,
    actionsAsReferent,
    actionsViaCompany,
    overdueCount,
    teams: input.teams.map((t) => ({ ...t, href: `/equipes/${t.id}` })),
    casting: input.casting.map((c) => ({ ...c, href: `/sites/${c.siteId}` })),
    decisions: input.decisions,
  }
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Charge la fiche d'un contact, org-scopée et FAIL-CLOSED (contact hors org → null).
 * Toutes les requêtes sont filtrées par les ids du sujet — aucun scan de table.
 */
export async function getPersonFiche(contactId: string, orgIds: string[]): Promise<PersonFiche | null> {
  if (orgIds.length === 0) return null
  const db = createAdminClient()
  const today = todayLocalIso()

  const { data: contactRow } = await db
    .from('company_contacts')
    .select('id, full_name, function, company_id, is_internal_agent, email, phone, mobile, organization_id, deleted_at')
    .eq('id', contactId)
    .maybeSingle()
  const contact = contactRow as
    | { id: string; full_name: string; function: string | null; company_id: string | null; is_internal_agent: boolean; email: string | null; phone: string | null; mobile: string | null; organization_id: string; deleted_at: string | null }
    | null
  if (!contact || contact.deleted_at || !orgIds.includes(contact.organization_id)) return null

  // Relations filtrées par le sujet (jamais de scan global).
  const [tfmRes, castRes, refActRes, coActRes, decRes, coRes, usersRes] = await Promise.all([
    db.from('team_field_members').select('team_id, left_at').eq('contact_id', contactId),
    db.from('site_intervenants').select('site_id, role, effective_to').eq('main_contact_id', contactId),
    db.from('site_actions').select('id, title, site_id, due_date').eq('assigned_contact_id', contactId).eq('status', 'open'),
    contact.company_id
      ? db.from('site_actions').select('id, title, site_id, due_date').eq('assigned_company_id', contact.company_id).eq('status', 'open')
      : Promise.resolve({ data: [] }),
    db.from('site_decisions').select('id, titre, site_id, date_decision').eq('decisionnaire_contact_id', contactId),
    contact.company_id
      ? db.from('companies').select('id, name, short_name').eq('id', contact.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('users').select('id, full_name, email').in('organization_id', orgIds),
  ])

  const tfm = (tfmRes.data ?? []) as Array<{ team_id: string; left_at: string | null }>
  const cast = (castRes.data ?? []) as Array<{ site_id: string; role: string; effective_to: string | null }>
  const refAct = (refActRes.data ?? []) as Array<{ id: string; title: string; site_id: string; due_date: string | null }>
  const coAct = (coActRes.data ?? []) as Array<{ id: string; title: string; site_id: string; due_date: string | null }>
  const dec = (decRes.data ?? []) as Array<{ id: string; titre: string; site_id: string; date_decision: string | null }>
  const companyRow = (coRes.data ?? null) as { id: string; name: string; short_name: string | null } | null

  // Résolution des noms de sites/équipes en un lot chacun (org-scopé).
  const teamIds = [...new Set(tfm.map((r) => r.team_id))]
  const siteIds = [...new Set([...cast.map((r) => r.site_id), ...refAct.map((r) => r.site_id), ...coAct.map((r) => r.site_id), ...dec.map((r) => r.site_id)])]
  const [teamNameRes, siteNameRes] = await Promise.all([
    teamIds.length ? db.from('teams').select('id, name').in('id', teamIds).in('organization_id', orgIds) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('sites').select('id, name').in('id', siteIds).in('organization_id', orgIds).is('deleted_at', null) : Promise.resolve({ data: [] }),
  ])
  const teamNameById = new Map(((teamNameRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]))
  const siteNameById = new Map(((siteNameRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const siteName = (id: string) => siteNameById.get(id) ?? 'Chantier'

  // Rapprochement compte (même heuristique que le cockpit) : e-mail exact, sinon nom normalisé.
  const users = (usersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>
  let linkedAccountUserId: string | null = null
  if (contact.email) {
    linkedAccountUserId = users.find((u) => u.email?.toLowerCase() === contact.email!.toLowerCase())?.id ?? null
  }
  if (!linkedAccountUserId) {
    const target = norm(contact.full_name)
    linkedAccountUserId = users.find((u) => u.full_name && norm(u.full_name) === target)?.id ?? null
  }

  // Dédup équipes actives (une personne peut avoir quitté puis revenir : garder l'état actif).
  const teamActive = new Map<string, boolean>()
  for (const r of tfm) teamActive.set(r.team_id, (teamActive.get(r.team_id) ?? false) || r.left_at === null)

  return buildPersonFiche({
    today,
    contact,
    companyName: companyRow ? (companyRow.short_name || companyRow.name) : null,
    teams: teamIds.map((id) => ({ id, name: teamNameById.get(id) ?? 'Équipe', active: teamActive.get(id) ?? false })),
    casting: cast.map((c) => ({ siteId: c.site_id, siteName: siteName(c.site_id), role: c.role, active: c.effective_to === null })),
    referentActions: refAct.map((a) => ({ id: a.id, title: a.title, siteId: a.site_id, siteName: siteName(a.site_id), dueDate: a.due_date })),
    companyActions: coAct.map((a) => ({ id: a.id, title: a.title, siteId: a.site_id, siteName: siteName(a.site_id), dueDate: a.due_date })),
    decisions: dec.map((d) => ({ id: d.id, title: d.titre, siteId: d.site_id, siteName: siteName(d.site_id), date: d.date_decision })),
    linkedAccountUserId,
  })
}
