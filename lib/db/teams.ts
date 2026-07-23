// Phase 9 — Vue Semaine & Équipes (Slice 9.1)
//
// Helpers DB pour `teams` + `team_members`.
//
// Doctrine V2 impérative — `docs/superpowers/doctrines/planning-doctrine.md` :
//
//   « On organise la couverture des engagements. On ne mesure jamais les humains. »
//
// L'équipe est un CONTENEUR LOGISTIQUE de couverture. JAMAIS une unité analytique.
// Ce module expose donc :
//
//   ✅ CRUD teams + memberships (composition variable dans le temps)
//   ✅ `listTeamsWithMemberCount` — info descriptive, jamais utilisée comme KPI
//   ✅ `archiveTeam` (soft-delete + désaffectation des missions/interventions
//       PLANIFIÉES uniquement — les interventions exécutées/validées
//       CONSERVENT `assigned_team_id` au titre de l'immuabilité de la preuve)
//
// INTERDIT explicitement dans ce fichier — refus par défaut si proposé :
//
//   ❌ getTeamCharge / getTeamLoad / getTeamSaturation
//   ❌ getTeamPerformance / getTeamProductivity / getTeamCompletionRate
//   ❌ getActivityByMember (KPI par personne)
//   ❌ Toute comparaison inter-équipes ou inter-agents
//
// `member_count` reste descriptif. Si une PR future commence à exposer un ratio
//  « charge équipe » ou « % complétion équipe » → refus immédiat.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import type { DbTeam, DbTeamMember } from '@/types/db'

/**
 * L'appartenance à une équipe est INDÉPENDANTE du rôle. Une équipe est un
 * conteneur logistique de couverture (le planning affecte des ÉQUIPES, pas des
 * personnes) : toute personne pouvant intervenir sur un chantier peut donc en
 * être membre, quel que soit son rôle (manager, chef d'équipe, et demain
 * conducteur, ouvrier…). Le rôle continue de gouverner les droits et les
 * écrans — jamais l'appartenance à une équipe.
 *
 * On exclut uniquement le compte système `admin` (jamais un intervenant
 * terrain), en miroir de `listIntervenantsForList`. Éviter un allowlist de
 * rôles supprime les exceptions « si Manager alors autoriser quand même… » à
 * chaque nouveau rôle.
 */
const SYSTEM_ROLE_EXCLUDED_FROM_TEAMS = 'admin'

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string
  color?: string | null
  /** Migration 077 — icône lucide (kebab-case). */
  icon?: string | null
  created_by?: string | null
  organization_id?: string | null
}

export interface UpdateTeamInput {
  name?: string
  color?: string | null
  /** Migration 077 — icône lucide (kebab-case). */
  icon?: string | null
  /** Migration 078 — spécialités déclarées (tags whitelisted). */
  specialties?: string[]
  active?: boolean
}

// ----------------------------------------------------------------------------
// CRUD teams
// ----------------------------------------------------------------------------

/** Liste toutes les équipes non archivées, triées par nom. */
export async function listTeams(): Promise<DbTeam[]> {
  const supabase = createAdminClient()
  // M3 — agrégé. FAIL-CLOSED : `.in([])` (aucune appartenance) → aucune équipe.
  const orgIds = await getOrgIdsOfUser()
  const q = supabase.from('teams').select('*').is('deleted_at', null)
    .in('organization_id', orgIds).order('name', { ascending: true })
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/** Récupère une team par id (non archivée). */
export async function getTeam(id: string): Promise<DbTeam | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Crée une team. Le contrôle d'unicité de nom est délégué à la DB (idx_teams_name_active). */
export async function createTeam(input: CreateTeamInput): Promise<DbTeam> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('teams')
    .insert({
      name: input.name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      created_by: input.created_by ?? null,
      organization_id: input.organization_id,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DbTeam
}

/** Met à jour une team (rename, recolor, change icon, activate/deactivate). */
export async function updateTeam(id: string, input: UpdateTeamInput): Promise<DbTeam> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.specialties !== undefined) patch.specialties = input.specialties
  if (input.active !== undefined) patch.active = input.active

  const { data, error } = await supabase
    .from('teams')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as DbTeam
}

/**
 * Soft-delete d'une team + désaffectation des missions et des interventions
 * PLANIFIÉES uniquement.
 *
 * Règle doctrinale ABSOLUE : les interventions `in_progress`, `completed`,
 * `validated` (et leurs `skipped` qui font partie de l'historique factuel)
 * CONSERVENT `assigned_team_id` même après archivage de la team. C'est une
 * exigence d'immuabilité de la preuve — on ne réécrit jamais le passé.
 *
 * Soft-delete = `deleted_at = now()` + `active = false`. La FK reste en place
 * grâce à l'historique (le filet de sécurité `ON DELETE SET NULL` côté DB ne
 * se déclenche que sur un HARD delete, qu'on évite ici).
 */
/**
 * Ce qu'une équipe TIENT encore. À lire AVANT de l'archiver.
 *
 * Archiver désaffectait en silence : les missions perdaient leur équipe par
 * défaut, et TOUTES les interventions planifiées à venir — celles de demain, du
 * mois prochain — passaient en « Non-affecté ». Sans décompte, sans un mot.
 * Pire, elles ne pouvaient plus être démarrées (contrainte
 * `chk_active_intervention_requires_team`) tant qu'un humain ne les réaffectait
 * pas une par une.
 *
 * Une cascade ne doit jamais être silencieuse. On compte, et on montre.
 */
export interface TeamDependencies {
  /** Missions dont c'est l'équipe par défaut. */
  missions: number
  /** Interventions PLANIFIÉES à venir — celles qui deviendraient orphelines. */
  futureInterventions: number
  /** Jours de roulement tenus par cette équipe. Bloquant : voir ci-dessous. */
  rotationSlots: number
  /** Chantiers dont le roulement s'appuie sur elle (pour pouvoir le DIRE). */
  rotationSiteNames: string[]
}

export async function getTeamDependencies(id: string): Promise<TeamDependencies> {
  const supabase = createAdminClient()
  const todayIso = new Date().toISOString().slice(0, 10)

  const [missionsRes, interventionsRes, slotsRes] = await Promise.all([
    supabase
      .from('missions')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_team_id', id)
      .is('deleted_at', null),
    supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_team_id', id)
      .eq('status', 'planned')
      .gte('scheduled_for', todayIso),
    supabase
      .from('planning_cycle_slots')
      .select('id, cycle:planning_cycles!inner(id, name, deleted_at, site:sites(name))')
      .eq('team_id', id),
  ])

  type SlotRow = {
    cycle: {
      deleted_at: string | null
      site: { name: string } | { name: string }[] | null
    } | null
  }

  const siteNames = new Set<string>()
  let rotationSlots = 0
  for (const row of ((slotsRes.data ?? []) as unknown as SlotRow[])) {
    const cycle = row.cycle
    // Un roulement archivé ne tient plus rien.
    if (!cycle || cycle.deleted_at !== null) continue
    rotationSlots += 1
    const site = Array.isArray(cycle.site) ? cycle.site[0] : cycle.site
    if (site?.name) siteNames.add(site.name)
  }

  return {
    missions: missionsRes.count ?? 0,
    futureInterventions: interventionsRes.count ?? 0,
    rotationSlots,
    rotationSiteNames: [...siteNames].sort((a, b) => a.localeCompare(b, 'fr')),
  }
}

export async function archiveTeam(id: string): Promise<void> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  // 1) Désaffecter les missions (toutes — assigned_team_id sur missions est
  //    un défaut logistique, jamais une preuve)
  const { error: mErr } = await supabase
    .from('missions')
    .update({ assigned_team_id: null })
    .eq('assigned_team_id', id)
  if (mErr) throw mErr

  // 2) Désaffecter UNIQUEMENT les interventions planifiées
  //    Les autres statuts (in_progress, completed, validated, skipped) conservent
  //    leur lien historique avec la team — immuabilité preuve.
  const { error: iErr } = await supabase
    .from('interventions')
    .update({ assigned_team_id: null })
    .eq('assigned_team_id', id)
    .eq('status', 'planned')
  if (iErr) throw iErr

  // 2bis) Couper le lien avec les MODÈLES de génération. Sans ça, l'étape 2 ne
  //       servait à rien : la génération suivante relisait
  //       `intervention_templates.assigned_team_id` et recréait des
  //       interventions futures affectées à une équipe archivée — invisible
  //       dans les sélecteurs, donc incorrigible depuis l'écran.
  const { error: tplErr } = await supabase
    .from('intervention_templates')
    .update({ assigned_team_id: null })
    .eq('assigned_team_id', id)
  if (tplErr) throw tplErr

  // 3) Soft-delete de la team
  const { error: tErr } = await supabase
    .from('teams')
    .update({ deleted_at: nowIso, active: false })
    .eq('id', id)
  if (tErr) throw tErr
}

// ----------------------------------------------------------------------------
// listTeamsWithMemberCount — info descriptive
// ----------------------------------------------------------------------------

export interface TeamWithMemberCount extends DbTeam {
  memberCount: number
  /** Profil du référent (si désigné via teams.referent_user_id). */
  referent: { id: string; full_name: string | null; email: string } | null
}

/**
 * Liste les équipes actives (non archivées) avec leur effectif courant
 * (`left_at IS NULL`). Ce comptage est descriptif (affichage « Alpha · 4
 * personnes »), JAMAIS utilisé comme métrique de performance / saturation.
 */
export async function listTeamsWithMemberCount(): Promise<TeamWithMemberCount[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → aucune équipe.
  if (orgIds.length === 0) return []
  const tQ = supabase.from('teams').select('*').is('deleted_at', null)
    .in('organization_id', orgIds).order('name', { ascending: true })
  const { data: teams, error: tErr } = await tQ
  if (tErr) throw tErr
  if (!teams || teams.length === 0) return []

  const teamIds = teams.map((t) => t.id)

  // Un seul SELECT pour récupérer les memberships actifs, comptage en mémoire.
  const { data: memberships, error: mErr } = await supabase
    .from('team_members')
    .select('team_id')
    .in('team_id', teamIds)
    .is('left_at', null)
  if (mErr) throw mErr

  const counts = new Map<string, number>()
  for (const m of memberships ?? []) {
    counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1)
  }

  // Profils des référents (jointure manuelle pour éviter les surprises de typage)
  const referentIds = Array.from(
    new Set((teams as DbTeam[]).map((t) => t.referent_user_id).filter((id): id is string => !!id)),
  )
  const refMap = new Map<string, { id: string; full_name: string | null; email: string }>()
  if (referentIds.length > 0) {
    const { data: refUsers, error: rErr } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', referentIds)
    if (rErr) throw rErr
    for (const u of refUsers ?? []) {
      refMap.set(u.id, { id: u.id, full_name: u.full_name, email: u.email })
    }
  }

  return (teams as DbTeam[]).map((t) => ({
    ...t,
    memberCount: counts.get(t.id) ?? 0,
    referent: t.referent_user_id ? refMap.get(t.referent_user_id) ?? null : null,
  }))
}

/**
 * Désigne ou retire le référent d'une équipe.
 *
 * Doctrine V3 :
 *   - Référent = point de contact stable, pas une hiérarchie.
 *   - `null` accepté (retrait sans remplacement immédiat).
 *   - Pas de contrainte DB "le référent doit être membre" : tolérance
 *     opérationnelle (transitions, départ sans relai immédiat).
 */
export async function setTeamReferent(input: {
  teamId: string
  userId: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('teams')
    .update({ referent_user_id: input.userId })
    .eq('id', input.teamId)
  if (error) throw error
}

// ----------------------------------------------------------------------------
// Members
// ----------------------------------------------------------------------------

export interface TeamMemberWithUser {
  membership: DbTeamMember
  user: { id: string; full_name: string | null; email: string }
}

/**
 * Liste les membres actifs d'une équipe (`left_at IS NULL`), avec leur
 * identité publique.
 *
 * ⚠ Cette fonction expose des noms d'agents. À n'utiliser QUE sur la page
 * Équipes — seule page de supervision où la doctrine V2 tolère l'affichage
 * nominatif. Partout ailleurs, exposer « Équipe Alpha (4 personnes) ».
 *
 * EXCEPTION assumée (Vincent, 2026-07-14) : la Vue Mois en mode Équipe affiche
 * la COMPOSITION de chaque équipe sous son nom — le conducteur doit savoir qui
 * tourne. La limite tient : ces noms sont un LIBELLÉ DE LIGNE, jamais des lignes
 * eux-mêmes. Aucune grille de jours travaillés par personne, aucun total
 * individuel : ce serait une feuille de présence, pas un planning.
 */
export async function listMembersOfTeam(teamId: string): Promise<TeamMemberWithUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('*, user:users(id, full_name, email)')
    .eq('team_id', teamId)
    .is('left_at', null)
    .order('joined_at', { ascending: true })
  if (error) throw error

  type Row = DbTeamMember & {
    user: { id: string; full_name: string | null; email: string } | null
      | Array<{ id: string; full_name: string | null; email: string }>
  }

  return ((data ?? []) as Row[])
    .map((r) => {
      const u = Array.isArray(r.user) ? r.user[0] ?? null : r.user
      if (!u) return null
      const { user: _omit, ...membership } = r
      return {
        membership: membership as DbTeamMember,
        user: u,
      }
    })
    .filter((x): x is TeamMemberWithUser => x !== null)
}

/**
 * Ajoute un user à une équipe (insère un nouveau `team_members` actif).
 * L'unicité (team_id, user_id) WHERE left_at IS NULL est garantie par
 * l'index DB partial → erreur si déjà membre actif.
 */
export async function addMemberToTeam(teamId: string, userId: string): Promise<DbTeamMember> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId })
    .select('*')
    .single()
  if (error) throw error
  return data as DbTeamMember
}

/**
 * Retire un user d'une équipe : on positionne `left_at` (historique conservé).
 * Idempotent : si aucun membership actif, ne fait rien.
 */
export async function removeMemberFromTeam(teamId: string, userId: string): Promise<void> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('team_members')
    .update({ left_at: nowIso })
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .is('left_at', null)
  if (error) throw error
}

/**
 * Pour l'app mobile agent : retourne la liste des `team_id` d'équipes
 * actives auxquelles cet user appartient actuellement (left_at IS NULL).
 *
 * Sert à filtrer les interventions affichées (« mes interventions » =
 * interventions affectées à une équipe dont je suis membre).
 */
export async function listActiveTeamIdsForUser(userId: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .is('left_at', null)
  if (error) throw error
  return (data ?? []).map((r) => r.team_id)
}

// ----------------------------------------------------------------------------
// Orphan users — info descriptive pour la page Équipes
// ----------------------------------------------------------------------------

export interface OrphanUser {
  id: string
  full_name: string | null
  email: string
  role: string
}

/**
 * Liste les personnes pouvant appartenir à une équipe (tout le monde sauf le
 * compte système admin) qui ne sont membres actifs d'aucune équipe. Sert à
 * afficher le bandeau « ⚠ X personnes pas dans une équipe » sur la page Équipes.
 *
 * Comme `listMembersOfTeam`, cette fonction expose des noms d'agents et n'est
 * destinée QU'à la page Équipes.
 */
export async function listOrphanUsers(): Promise<OrphanUser[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → personne (jamais les
  // gens d'un autre tenant).
  if (orgIds.length === 0) return []

  // 1) Toutes les personnes non archivées de l'org, hors compte système admin.
  const uQ = supabase.from('users').select('id, full_name, email, role')
    .neq('role', SYSTEM_ROLE_EXCLUDED_FROM_TEAMS).is('deleted_at', null)
    .in('organization_id', orgIds)
  const { data: users, error: uErr } = await uQ
  if (uErr) throw uErr
  if (!users || users.length === 0) return []

  // 2) Tous les userIds qui ont au moins un membership actif
  const { data: memberships, error: mErr } = await supabase
    .from('team_members')
    .select('user_id')
    .is('left_at', null)
    .in('user_id', users.map((u) => u.id))
  if (mErr) throw mErr

  const memberSet = new Set((memberships ?? []).map((m) => m.user_id))
  return users
    .filter((u) => !memberSet.has(u.id))
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
    }))
}
