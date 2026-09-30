// /EQUIPES V2 (Batch D) — chargement des données du drawer WOW PERSONNE.
//
// lib/db/person-memory.ts ne renvoie ni nom ni identité (volontairement
// centré sur la preuve, pas sur la fiche) : on va chercher l'identité ici,
// par une requête directe scoping-org, avant de composer le résumé.
//
// FAIL-CLOSED : personne introuvable OU hors organisation → `null`, jamais
// une fiche vide qui laisserait croire à une absence de preuve.

import {
  getPersonMemorySummary,
  listConfirmedInterventionsForUser,
  listAssignedActionsForContact,
  listTeamMembershipsForContact,
  listPhotosForUser,
  type PersonRef,
  type ConfirmedInterventionMemoryItem,
  type ContactAssignedAction,
  type UserMemoryOverview,
  type ContactMemoryOverview,
  type PersonFieldPhoto,
} from '@/lib/db/person-memory'
import { createAdminClient } from '@/lib/supabase/admin'

export const PERSON_PERIOD_VALUES = ['7', '30', '90', 'all'] as const
export type PersonPeriod = (typeof PERSON_PERIOD_VALUES)[number]
export const DEFAULT_PERSON_PERIOD: PersonPeriod = '30'

export function parsePersonPeriod(raw: string | undefined): PersonPeriod {
  return (PERSON_PERIOD_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as PersonPeriod)
    : DEFAULT_PERSON_PERIOD
}

function sinceIsoFor(period: PersonPeriod): string | undefined {
  if (period === 'all') return undefined
  const days = Number(period)
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

export interface CurrentTeamRef {
  teamId: string
  teamName: string
}

export interface PersonDrawerData {
  ref: PersonRef
  displayName: string
  subtitle: string | null
  period: PersonPeriod
  userOverview: UserMemoryOverview | null
  contactOverview: ContactMemoryOverview | null
  interventions: ConfirmedInterventionMemoryItem[] | null
  contactActions: ContactAssignedAction[] | null
  photos: PersonFieldPhoto[] | null
  currentTeams: CurrentTeamRef[]
}

export async function loadPersonDrawerData(
  personId: string,
  personKind: 'user' | 'contact',
  orgIds: string[],
  period: PersonPeriod,
): Promise<PersonDrawerData | null> {
  if (!orgIds.length) return null
  const admin = createAdminClient()
  const ref: PersonRef = personKind === 'user' ? { kind: 'user', id: personId } : { kind: 'contact', id: personId }

  if (ref.kind === 'user') {
    const { data: userRow } = await admin
      .from('users')
      .select('id, full_name, email, role, deleted_at')
      .eq('id', personId)
      .maybeSingle()
    if (!userRow || userRow.deleted_at) return null

    // FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — `users.organization_id`
    // n'est qu'une organisation par défaut/legacy dès qu'un compte a plusieurs
    // appartenances (cf. lib/auth/memberships.ts). L'autorisation d'accès au
    // drawer doit venir d'une appartenance ACTIVE dans une des organisations du
    // viewer, jamais de cette colonne scalaire.
    const { data: membershipRow } = await admin
      .from('organization_memberships')
      .select('id')
      .eq('user_id', personId)
      .eq('status', 'active')
      .in('organization_id', orgIds)
      .limit(1)
      .maybeSingle()
    if (!membershipRow) return null

    const sinceIso = sinceIsoFor(period)
    const [summary, interventions, photos, memberships] = await Promise.all([
      getPersonMemorySummary(ref, orgIds, { sinceIso }),
      listConfirmedInterventionsForUser(personId, orgIds, { sinceIso, limit: 50 }),
      listPhotosForUser(personId, orgIds, { sinceIso, limit: 24 }),
      admin
        .from('team_members')
        .select('team:teams!inner(id, name, deleted_at, organization_id)')
        .eq('user_id', personId)
        .is('left_at', null),
    ])

    // FIX A (revue ChatGPT/Vincent, 08e355e2) — un user peut appartenir à
    // PLUSIEURS organisations : `users.organization_id` (déjà vérifié plus
    // haut) ne garantit donc pas que ses équipes actuelles le sont aussi.
    // Fail-closed jusque dans `currentTeams` : une équipe hors `orgIds` ne
    // doit jamais apparaître dans le drawer, même si son propriétaire est
    // par ailleurs visible.
    type TeamLite = { id: string; name: string; deleted_at: string | null; organization_id: string | null }
    const currentTeams: CurrentTeamRef[] = ((memberships.data ?? []) as Array<{ team: TeamLite | TeamLite[] | null }>)
      .map((m) => (Array.isArray(m.team) ? m.team[0] ?? null : m.team))
      .filter((t): t is TeamLite => !!t && !t.deleted_at && !!t.organization_id && orgIds.includes(t.organization_id))
      .map((t) => ({ teamId: t.id, teamName: t.name }))

    return {
      ref,
      displayName: displayName(userRow.full_name, userRow.email),
      subtitle: userRow.role === 'manager' ? 'Manager' : userRow.role === 'chef_equipe' ? 'Chef d’équipe' : null,
      period,
      userOverview: summary.userOverview,
      contactOverview: null,
      interventions,
      contactActions: null,
      photos,
      currentTeams,
    }
  }

  const { data: contactRow } = await admin
    .from('company_contacts')
    .select('id, full_name, function, organization_id, deleted_at, company:companies(name)')
    .eq('id', personId)
    .maybeSingle()
  if (!contactRow || contactRow.deleted_at) return null
  if (!contactRow.organization_id || !orgIds.includes(contactRow.organization_id)) return null

  const company = Array.isArray(contactRow.company) ? contactRow.company[0] ?? null : contactRow.company

  const [summary, actions, teams] = await Promise.all([
    getPersonMemorySummary(ref, orgIds, {}),
    listAssignedActionsForContact(personId, orgIds),
    listTeamMembershipsForContact(personId, orgIds),
  ])

  const subtitleParts = [contactRow.function, company?.name].filter((v): v is string => !!v)

  return {
    ref,
    displayName: contactRow.full_name,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : null,
    period,
    userOverview: null,
    contactOverview: summary.contactOverview,
    interventions: null,
    contactActions: actions,
    photos: null,
    currentTeams: teams.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
  }
}
