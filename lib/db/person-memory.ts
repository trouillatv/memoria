// ============================================================================
// lib/db/person-memory.ts — /EQUIPES V2, WOW PERSONNE (Doctrine V4)
// ============================================================================
//
// Mémoire d'une personne bâtie STRICTEMENT sur des preuves confirmées :
//   - users        → intervention_participants (participations confirmées)
//   - company_contacts → faits réellement liés (site_actions.assigned_contact_id,
//     team_field_members)
//
// Invariant unique (GO Vincent) : on ne transforme jamais une absence de
// preuve en présence supposée.
//   - `interventions.assigned_team_id`      → équipe PRÉVUE, jamais une preuve
//     de présence physique.
//   - appartenance ACTUELLE à une équipe    → jamais une preuve de présence
//     passée.
// Ces deux éléments ne doivent JAMAIS être utilisés ici pour fabriquer une
// participation qui n'a pas de ligne confirmée dans intervention_participants.
//
// Pas de fusion automatique users ↔ company_contacts par nom/email : deux
// identités distinctes tant qu'aucune décision humaine explicite ne les relie.
// `PersonRef` modélise cette dualité sans introduire de table Person unifiée.

import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'

export type PersonRef =
  | { kind: 'user'; id: string }
  | { kind: 'contact'; id: string }

// ----------------------------------------------------------------------------
// Types — mémoire "user" (participations confirmées)
// ----------------------------------------------------------------------------

// FIX 2 (revue ChatGPT/Vincent sur cd30aa2d) — intervention_participants peut
// être écrit (RLS ip_insert, migration 024) dès que l'intervention est encore
// `planned` ou `in_progress` : la présence d'une ligne ne prouve donc PAS à
// elle seule une intervention réalisée. Seuls `completed`/`validated` sont une
// preuve attestée ; `in_progress` est réel mais non clos ; `planned` (et tout
// statut non abouti comme `skipped`) ne compte JAMAIS ici.
export type ConfirmationBasis = 'attested' | 'in_progress'

export interface ConfirmedInterventionMemoryItem {
  interventionId: string
  role: 'participant' | 'referent'
  effectiveDate: string | null
  status: string
  confirmationBasis: ConfirmationBasis
  siteId: string
  siteName: string
  contractName: string | null
  clientName: string | null
  teamId: string | null
  teamName: string | null
}

export interface UserMemoryOverview {
  attestedInterventionsCount: number
  inProgressInterventionsCount: number
  referentCount: number
  distinctSiteCount: number
  distinctTeamCount: number
  firstConfirmedAt: string | null
  lastConfirmedAt: string | null
}

interface RawParticipantRow {
  role: 'participant' | 'referent'
  intervention: {
    id: string
    scheduled_for: string | null
    planned_start: string | null
    status: string
    assigned_team_id: string | null
    team: { id: string; name: string } | { id: string; name: string }[] | null
    mission: {
      site: {
        id: string
        name: string
        organization_id: string
        contract: { name: string } | { name: string }[] | null
        client: { name: string } | { name: string }[] | null
      } | Array<{
        id: string
        name: string
        organization_id: string
        contract: { name: string } | { name: string }[] | null
        client: { name: string } | { name: string }[] | null
      }> | null
    } | Array<{
      site: unknown
    }> | null
  } | Array<{
    id: string
    scheduled_for: string | null
    planned_start: string | null
    status: string
    assigned_team_id: string | null
    team: unknown
    mission: unknown
  }> | null
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function effectiveDate(i: { scheduled_for: string | null; planned_start: string | null }): string | null {
  return i.scheduled_for ?? i.planned_start
}

const ATTESTED_STATUSES = new Set(['completed', 'validated'])
const IN_PROGRESS_STATUS = 'in_progress'

/**
 * Participations RÉELLES d'un user (statut `completed`/`validated`/`in_progress`
 * uniquement — jamais `planned` ni `skipped`, cf. `confirmationBasis`), triées
 * par date décroissante. Borne temporelle optionnelle (`sinceIso`) et
 * pagination — jamais un dump complet. Scope organisationnel obligatoire
 * (`orgIds`) : un manager multi-org ne voit que les sites de ses organisations.
 */
export async function listConfirmedInterventionsForUser(
  userId: string,
  orgIds: string[],
  opts: { sinceIso?: string; limit?: number; offset?: number } = {},
): Promise<ConfirmedInterventionMemoryItem[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0

  const { data, error } = await supabase
    .from('intervention_participants')
    .select(
      `role,
       intervention:interventions!inner(
         id, scheduled_for, planned_start, status, assigned_team_id,
         team:teams(id, name),
         mission:missions!inner(
           site:sites!inner(id, name, organization_id, contract:contracts(name), client:clients(name))
         )
       )`,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error

  const out: ConfirmedInterventionMemoryItem[] = []
  for (const r of (data ?? []) as unknown as RawParticipantRow[]) {
    const intervention = pickOne(r.intervention) as {
      id: string
      scheduled_for: string | null
      planned_start: string | null
      status: string
      assigned_team_id: string | null
      team: unknown
      mission: unknown
    } | null
    if (!intervention) continue

    // `planned` (RLS permet déjà l'écriture avant réalisation) et tout statut
    // non abouti (`skipped`) ne sont jamais une participation — cf. doctrine
    // en tête de fichier et migration 024 (trg_ip_freeze/ip_insert).
    let confirmationBasis: ConfirmationBasis
    if (ATTESTED_STATUSES.has(intervention.status)) {
      confirmationBasis = 'attested'
    } else if (intervention.status === IN_PROGRESS_STATUS) {
      confirmationBasis = 'in_progress'
    } else {
      continue
    }

    const mission = pickOne(intervention.mission as never) as { site?: unknown } | null
    const site = pickOne(mission?.site as never) as {
      id?: string
      name?: string
      organization_id?: string
      contract?: unknown
      client?: unknown
    } | null
    if (!site?.id || !site.name || !site.organization_id) continue
    if (!orgIds.includes(site.organization_id)) continue

    const date = effectiveDate(intervention)
    if (opts.sinceIso && (!date || date < opts.sinceIso)) continue

    const team = pickOne(intervention.team as never) as { id?: string; name?: string } | null
    const contract = pickOne(site.contract as never) as { name?: string } | null
    const client = pickOne(site.client as never) as { name?: string } | null

    out.push({
      interventionId: intervention.id,
      role: r.role,
      effectiveDate: date,
      status: intervention.status,
      confirmationBasis,
      siteId: site.id,
      siteName: site.name,
      contractName: contract?.name ?? null,
      clientName: client?.name ?? null,
      teamId: team?.id ?? intervention.assigned_team_id ?? null,
      teamName: team?.name ?? null,
    })
  }

  return out.slice(offset, offset + limit)
}

/**
 * Vue d'ensemble agrégée — comptages simples sur des lignes confirmées
 * uniquement. Ce n'est PAS une fonction de performance/productivité : aucune
 * comparaison inter-personnes, aucun classement.
 */
export async function getUserMemoryOverview(
  userId: string,
  orgIds: string[],
  opts: { sinceIso?: string } = {},
): Promise<UserMemoryOverview> {
  const items = await listConfirmedInterventionsForUser(userId, orgIds, {
    sinceIso: opts.sinceIso,
    limit: 100000,
  })

  // firstConfirmedAt/lastConfirmedAt restent des dates ATTESTÉES : une
  // intervention encore `in_progress` n'est pas close, elle ne doit jamais
  // avancer la date de "dernière participation confirmée".
  const attested = items.filter((i) => i.confirmationBasis === 'attested')
  const sites = new Set(items.map((i) => i.siteId))
  const teams = new Set(items.filter((i) => i.teamId).map((i) => i.teamId as string))
  const dates = attested.map((i) => i.effectiveDate).filter((d): d is string => !!d).sort()

  return {
    attestedInterventionsCount: attested.length,
    inProgressInterventionsCount: items.length - attested.length,
    referentCount: items.filter((i) => i.role === 'referent').length,
    distinctSiteCount: sites.size,
    distinctTeamCount: teams.size,
    firstConfirmedAt: dates[0] ?? null,
    lastConfirmedAt: dates.at(-1) ?? null,
  }
}

// ----------------------------------------------------------------------------
// FIX 1 (revue ChatGPT/Vincent sur cd30aa2d) — mémoire photo terrain d'un user
// ----------------------------------------------------------------------------
//
// Source de vérité UNIQUE : intervention_photos.taken_by = userId (même
// invariant que lib/db/team-profile.ts::listTeamRecentPhotos). Aucune photo
// n'est jamais rattachée via une appartenance équipe ou un assigned_team_id :
// une photo sans taken_by n'apparaît nulle part ici.

export interface PersonFieldPhoto {
  id: string
  signedUrl: string
  caption: string | null
  takenAt: string
  interventionId: string
  siteId: string
  siteName: string
}

interface RawUserPhotoRow {
  id: string
  caption: string | null
  taken_at: string
  intervention_id: string
  storage_path: string
  intervention: {
    id: string
    mission: {
      site: { id: string; name: string; organization_id: string } | Array<{ id: string; name: string; organization_id: string }> | null
    } | Array<{ site: unknown }> | null
  } | Array<{ id: string; mission: unknown }> | null
}

/**
 * Photos terrain RÉELLEMENT prises par ce user (`taken_by`), triées par date
 * décroissante. Borne temporelle optionnelle (`sinceIso`, même sémantique que
 * `listConfirmedInterventionsForUser`). Scope organisationnel obligatoire.
 */
export async function listPhotosForUser(
  userId: string,
  orgIds: string[],
  opts: { sinceIso?: string; limit?: number } = {},
): Promise<PersonFieldPhoto[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const limit = opts.limit ?? 24

  const { data, error } = await supabase
    .from('intervention_photos')
    .select(
      `id, caption, taken_at, intervention_id, storage_path,
       intervention:interventions!inner(
         id,
         mission:missions!inner(
           site:sites!inner(id, name, organization_id)
         )
       )`,
    )
    .eq('taken_by', userId)
    .order('taken_at', { ascending: false })

  if (error) throw error

  const matched: Array<{ caption: string | null; takenAt: string; interventionId: string; storagePath: string; id: string; siteId: string; siteName: string }> = []
  for (const r of (data ?? []) as unknown as RawUserPhotoRow[]) {
    const intervention = pickOne(r.intervention as never) as { mission?: unknown } | null
    if (!intervention) continue
    const mission = pickOne(intervention.mission as never) as { site?: unknown } | null
    const site = pickOne(mission?.site as never) as { id?: string; name?: string; organization_id?: string } | null
    if (!site?.id || !site.name || !site.organization_id) continue
    if (!orgIds.includes(site.organization_id)) continue

    const date = r.taken_at
    if (opts.sinceIso && (!date || date < opts.sinceIso)) continue

    matched.push({
      id: r.id,
      caption: r.caption,
      takenAt: r.taken_at,
      interventionId: r.intervention_id,
      storagePath: r.storage_path,
      siteId: site.id,
      siteName: site.name,
    })
  }

  const page = matched.slice(0, limit)
  const urlByPath = await getSignedPhotoUrlsThumb(page.map((p) => p.storagePath))

  const out: PersonFieldPhoto[] = []
  for (const p of page) {
    const signed = urlByPath.get(p.storagePath)
    if (!signed) continue
    out.push({
      id: p.id,
      signedUrl: signed,
      caption: p.caption,
      takenAt: p.takenAt,
      interventionId: p.interventionId,
      siteId: p.siteId,
      siteName: p.siteName,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// Types — mémoire "contact" (faits réellement liés uniquement)
// ----------------------------------------------------------------------------
//
// company_contacts n'a pas de compte MemorIA et n'apparaît jamais dans
// intervention_participants (FK vers `users` uniquement). Sa mémoire se limite
// donc à ce qui est structurellement rattaché : actions assignées et
// appartenance à une équipe terrain. Étendre le modèle de participation aux
// contacts nécessiterait une migration dédiée — non fait ici, aucun besoin
// métier ne l'a justifié pour ce lot (cf. rapport HARD STOP).

export interface ContactAssignedAction {
  id: string
  title: string
  status: string
  dueDate: string | null
  siteId: string
  siteName: string
}

export interface ContactTeamMembership {
  teamId: string
  teamName: string
  joinedAt: string
}

export interface ContactMemoryOverview {
  openActionCount: number
  doneActionCount: number
  teamCount: number
}

const DONE_ACTION_STATUSES = new Set(['done', 'cancelled'])

export async function listAssignedActionsForContact(
  contactId: string,
  orgIds: string[],
): Promise<ContactAssignedAction[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('id, title, status, due_date, site:sites!inner(id, name, organization_id)')
    .eq('assigned_contact_id', contactId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200)
  if (error) throw error

  const out: ContactAssignedAction[] = []
  for (const r of (data ?? []) as unknown as Array<{
    id: string
    title: string
    status: string
    due_date: string | null
    site: { id: string; name: string; organization_id: string } | Array<{ id: string; name: string; organization_id: string }> | null
  }>) {
    const site = pickOne(r.site)
    if (!site || !orgIds.includes(site.organization_id)) continue
    out.push({
      id: r.id,
      title: r.title,
      status: r.status,
      dueDate: r.due_date,
      siteId: site.id,
      siteName: site.name,
    })
  }
  return out
}

/**
 * FIX A (revue ChatGPT/Vincent, 08e355e2) — `orgIds` obligatoire et
 * fail-closed : `team_field_members` n'a pas de garde applicative avant ce
 * correctif, sa sûreté reposait sur les seuls invariants DB. Une équipe hors
 * organisations accessibles ne doit jamais apparaître ici.
 */
export async function listTeamMembershipsForContact(
  contactId: string,
  orgIds: string[],
): Promise<ContactTeamMembership[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_field_members')
    .select('joined_at, team:teams!inner(id, name, deleted_at, organization_id)')
    .eq('contact_id', contactId)
    .is('left_at', null)
  if (error) throw error

  const out: ContactTeamMembership[] = []
  for (const r of (data ?? []) as unknown as Array<{
    joined_at: string
    team: { id: string; name: string; deleted_at: string | null; organization_id: string | null } | Array<{ id: string; name: string; deleted_at: string | null; organization_id: string | null }> | null
  }>) {
    const team = pickOne(r.team)
    if (!team || team.deleted_at) continue
    if (!team.organization_id || !orgIds.includes(team.organization_id)) continue
    out.push({ teamId: team.id, teamName: team.name, joinedAt: r.joined_at })
  }
  return out
}

export interface ContactTeamMembershipHistoryEntry {
  teamId: string
  teamName: string
  joinedAt: string
  leftAt: string | null
  /** Équipe archivée depuis (`teams.deleted_at`) — reste dans l'historique,
   *  ne doit jamais être présentée comme une appartenance actuelle. */
  teamArchived: boolean
}

/**
 * Historique COMPLET (actuel + passé) d'appartenance de ce contact aux
 * équipes terrain, avec `left_at` réel (jamais fabriqué, cf.
 * `removeFieldMemberFromTeam`). Jamais une preuve de présence sur une
 * intervention — uniquement une composition déclarée dans le temps.
 *
 * Une équipe archivée (`teams.deleted_at`) fait partie du passé réel et reste
 * donc dans l'historique (`teamArchived: true`) — la supprimer effacerait une
 * tranche entière de la vie de la personne. Seul le classement actuelle/
 * ancienne (fait par l'appelant) doit tenir compte de `teamArchived`.
 */
export async function listTeamMembershipHistoryForContact(
  contactId: string,
  orgIds: string[],
): Promise<ContactTeamMembershipHistoryEntry[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_field_members')
    .select('joined_at, left_at, team:teams!inner(id, name, deleted_at, organization_id)')
    .eq('contact_id', contactId)
    .order('joined_at', { ascending: true })
  if (error) throw error

  const out: ContactTeamMembershipHistoryEntry[] = []
  for (const r of (data ?? []) as unknown as Array<{
    joined_at: string
    left_at: string | null
    team: { id: string; name: string; deleted_at: string | null; organization_id: string | null } | Array<{ id: string; name: string; deleted_at: string | null; organization_id: string | null }> | null
  }>) {
    const team = pickOne(r.team)
    if (!team) continue
    if (!team.organization_id || !orgIds.includes(team.organization_id)) continue
    out.push({
      teamId: team.id,
      teamName: team.name,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
      teamArchived: !!team.deleted_at,
    })
  }
  return out
}

export async function getContactMemoryOverview(
  contactId: string,
  orgIds: string[],
): Promise<ContactMemoryOverview> {
  const [actions, teams] = await Promise.all([
    listAssignedActionsForContact(contactId, orgIds),
    listTeamMembershipsForContact(contactId, orgIds),
  ])
  return {
    openActionCount: actions.filter((a) => !DONE_ACTION_STATUSES.has(a.status)).length,
    doneActionCount: actions.filter((a) => DONE_ACTION_STATUSES.has(a.status)).length,
    teamCount: teams.length,
  }
}

// ----------------------------------------------------------------------------
// Dispatcher PersonRef
// ----------------------------------------------------------------------------

export interface PersonMemorySummary {
  ref: PersonRef
  kind: 'user' | 'contact'
  userOverview: UserMemoryOverview | null
  contactOverview: ContactMemoryOverview | null
}

/** Point d'entrée unique pour les drawers WOW PERSONNE — jamais de fusion, un seul côté rempli selon `kind`. */
export async function getPersonMemorySummary(
  ref: PersonRef,
  orgIds: string[],
  opts: { sinceIso?: string } = {},
): Promise<PersonMemorySummary> {
  if (ref.kind === 'user') {
    const userOverview = await getUserMemoryOverview(ref.id, orgIds, opts)
    return { ref, kind: 'user', userOverview, contactOverview: null }
  }
  const contactOverview = await getContactMemoryOverview(ref.id, orgIds)
  return { ref, kind: 'contact', userOverview: null, contactOverview }
}
