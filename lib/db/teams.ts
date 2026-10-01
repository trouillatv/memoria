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
  /**
   * Obligatoire dans le code applicatif (enforçé par `createTeamAction` avant
   * d'appeler cette fonction). Optionnel uniquement pour les scripts et tests de
   * seed : une équipe sans org est invisible pour tous les tenants (fail-closed
   * via `.in('organization_id', orgIds)`). Ne pas omettre en dehors des scripts.
   */
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

/**
 * Équipes affectables à CE chantier (PLAN-SEC-1, mandat Vincent 2026-09-26) —
 * jamais l'agrégat multi-org de `listTeams`. Un sélecteur qui propose une
 * équipe pour un chantier donné ne doit jamais lister une équipe d'une autre
 * organisation : ce n'est plus le point de blocage réel (chaque écriture
 * `assigned_team_id` revalide via `requireTeamCompatibleWithOrg`), mais
 * afficher l'option invite au clic-puis-refus. Fail-closed : chantier
 * introuvable → liste vide. Une équipe désactivée (`active = false`) reste en
 * base pour son historique mais ne doit plus être proposée à un nouveau choix.
 */
export async function listTeamsForSite(siteId: string): Promise<DbTeam[]> {
  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  if (!site) return []
  const { data, error } = await supabase.from('teams').select('*').is('deleted_at', null)
    .eq('organization_id', site.organization_id).eq('active', true).order('name', { ascending: true })
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
  /** Roulements (planning_cycles) distincts où cette équipe tient un jour. */
  rotationCycleCount: number
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
      id: string
      deleted_at: string | null
      site: { name: string } | { name: string }[] | null
    } | null
  }

  const siteNames = new Set<string>()
  const cycleIds = new Set<string>()
  let rotationSlots = 0
  for (const row of ((slotsRes.data ?? []) as unknown as SlotRow[])) {
    const cycle = row.cycle
    // Un roulement archivé ne tient plus rien.
    if (!cycle || cycle.deleted_at !== null) continue
    rotationSlots += 1
    cycleIds.add(cycle.id)
    const site = Array.isArray(cycle.site) ? cycle.site[0] : cycle.site
    if (site?.name) siteNames.add(site.name)
  }

  return {
    missions: missionsRes.count ?? 0,
    futureInterventions: interventionsRes.count ?? 0,
    rotationSlots,
    rotationCycleCount: cycleIds.size,
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

  // NOTE PLAN-SEC-1 (mandat Vincent 2026-09-26) — `planning_cycle_slots.team_id`
  // est NOT NULL en base : impossible de le désaffecter comme mission/template
  // ci-dessus. Une case de grille peut donc continuer à CITER cette équipe après
  // son archivage. Ce n'est plus un trou de sécurité : `regenerateTemplates`
  // (choke-point unique, cf. lib/db/planning-cycles.ts) REFUSE désormais
  // explicitement de régénérer tant que Guillaume n'a pas réenregistré le
  // roulement avec une équipe valide — jamais de réinjection silencieuse.
  // Reste une limite produit : la grille affichée peut montrer une équipe
  // archivée jusqu'à cette correction manuelle.

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
 *
 * FIX 5 (revue ChatGPT/Vincent, cd30aa2d) — un référent non-null DOIT être
 * membre ACTIF de l'équipe (team_members, left_at IS NULL). L'ancienne
 * tolérance « n'importe qui dans l'organisation » permettait un référent
 * jamais rattaché à l'équipe qu'il est censé représenter — refusé désormais
 * avec une erreur métier explicite plutôt qu'une écriture silencieuse.
 */
export async function setTeamReferent(input: {
  teamId: string
  userId: string | null
}): Promise<void> {
  const supabase = createAdminClient()

  if (input.userId !== null) {
    const { data: membership, error: mErr } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', input.teamId)
      .eq('user_id', input.userId)
      .is('left_at', null)
      .maybeSingle()
    if (mErr) throw mErr
    if (!membership) {
      throw new Error("Le référent doit être membre actif de l'équipe")
    }
  }

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
 * Liste TOUT l'historique d'appartenance d'une équipe (membres actifs +
 * anciens), avec `joined_at`/`left_at` réels — jamais fabriqués ou
 * rétrodatés (cf. `addMemberToTeam`/`removeMemberFromTeam` : ces colonnes ne
 * sont écrites qu'au moment réel du geste UI). Sert exclusivement l'affichage
 * d'un historique de composition — jamais une preuve de présence sur une
 * intervention : appartenir à une équipe, même aujourd'hui, ne prouve rien
 * sur une intervention précise.
 *
 * Même doctrine d'exposition nominative que `listMembersOfTeam` ci-dessus :
 * page Équipes uniquement.
 */
export async function listTeamMembershipHistory(teamId: string): Promise<TeamMemberWithUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('*, user:users(id, full_name, email)')
    .eq('team_id', teamId)
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

  // La frontière d'organisation vient de l'équipe, jamais de
  // users.organization_id (qui n'est plus qu'un champ historique dès qu'un
  // compte possède plusieurs appartenances).
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id, organization_id')
    .eq('id', teamId)
    .is('deleted_at', null)
    .maybeSingle()
  if (teamError) throw teamError
  if (!team?.organization_id) {
    throw new Error('Équipe sans organisation')
  }

  const { data: organizationMembership, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', team.organization_id)
    .eq('status', 'active')
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!organizationMembership) {
    throw new Error("Cette personne n'est pas membre actif de l'organisation de l'équipe")
  }

  const { data, error } = await supabase
    .from('team_members')
    .insert({
      team_id: teamId,
      user_id: userId,
      organization_id: team.organization_id,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DbTeamMember
}

/**
 * Retire un user d'une équipe : on positionne `left_at` (historique conservé).
 * Idempotent : si aucun membership actif, ne fait rien.
 *
 * FIX B (revue ChatGPT/Vincent, 08e355e2) — remplace l'ancien effacement
 * automatique du référent (FIX 5, cd30aa2d) : cet effacement silencieux était
 * une UX cachée (Vincent exige qu'aucun retrait de référent ne soit implicite)
 * et les deux écritures n'étaient pas atomiques (un échec de la seconde
 * laissait exactement l'état orphelin qu'on voulait interdire). On refuse
 * désormais le retrait tant que ce user est le référent courant : l'appelant
 * doit d'abord changer le référent (ou choisir explicitement « Aucun
 * référent ») via `setTeamReferent`, puis retirer le membre.
 */
export async function removeMemberFromTeam(teamId: string, userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('referent_user_id')
    .eq('id', teamId)
    .maybeSingle()
  if (teamError) throw teamError
  if (team?.referent_user_id === userId) {
    throw new Error("Retirez ou changez d'abord le référent de l'équipe.")
  }

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

export interface UserTeamMembershipHistoryEntry {
  teamId: string
  teamName: string
  joinedAt: string
  leftAt: string | null
  /** Équipe archivée depuis (`teams.deleted_at`) — reste dans l'historique,
   *  ne doit jamais être présentée comme une appartenance actuelle. */
  teamArchived: boolean
}

/**
 * Historique COMPLET (actuel + passé) d'appartenance de cet user aux équipes,
 * avec `left_at` réel (jamais fabriqué, cf. `removeMemberFromTeam`). Jamais
 * une preuve de présence sur une intervention — uniquement une composition
 * déclarée dans le temps.
 *
 * Une équipe archivée (`teams.deleted_at`) fait partie du passé réel et reste
 * donc dans l'historique (`teamArchived: true`) — la supprimer effacerait une
 * tranche entière de la vie de la personne. Seul le classement actuelle/
 * ancienne (fait par l'appelant) doit tenir compte de `teamArchived`.
 *
 * FAIL-CLOSED multi-org, même doctrine que `loadPersonDrawerData.ts` : une
 * équipe hors `orgIds` (organisations accessibles au viewer) n'apparaît
 * jamais, même pour un user par ailleurs visible.
 */
export async function listTeamMembershipHistoryForUser(
  userId: string,
  orgIds: string[],
): Promise<UserTeamMembershipHistoryEntry[]> {
  if (!orgIds.length) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    // Hint `!team_id` obligatoire : deux FK team_members → teams existent
    // (cf. listOrphanUsers plus bas).
    .select('joined_at, left_at, team:teams!team_id!inner(id, name, deleted_at, organization_id)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
  if (error) throw error

  type TeamLite = { id: string; name: string; deleted_at: string | null; organization_id: string | null }
  return ((data ?? []) as Array<{ joined_at: string; left_at: string | null; team: TeamLite | TeamLite[] | null }>)
    .map((r) => ({
      team: Array.isArray(r.team) ? r.team[0] ?? null : r.team,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
    }))
    .filter((r): r is { team: TeamLite; joinedAt: string; leftAt: string | null } =>
      !!r.team && !!r.team.organization_id && orgIds.includes(r.team.organization_id),
    )
    .map((r) => ({
      teamId: r.team.id,
      teamName: r.team.name,
      joinedAt: r.joinedAt,
      leftAt: r.leftAt,
      teamArchived: !!r.team.deleted_at,
    }))
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
 * compte système admin) qui ne sont membres actifs d'aucune équipe ACTIVE.
 * Sert à afficher le bandeau « ⚠ X personnes pas dans une équipe » sur la
 * page Équipes.
 *
 * FIX C (revue ChatGPT/Vincent, 08e355e2) — un membership actif dans une
 * équipe désactivée ou supprimée ne compte plus comme « en équipe » : avant
 * ce correctif, la seule condition était `left_at IS NULL`, sans jamais
 * vérifier l'état de l'équipe elle-même.
 *
 * FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — la population candidate
 * et le calcul « en équipe » utilisaient `users.organization_id`, une colonne
 * qui n'est plus qu'une organisation par défaut/legacy dès qu'un compte a
 * plusieurs appartenances (cf. lib/auth/memberships.ts). Source canonique
 * désormais : `organization_memberships` ACTIVE pour la population, et
 * `teams.organization_id` pour décider si un membership « compte » dans le
 * périmètre du viewer — une équipe active d'une organisation hors `orgIds`
 * ne doit ni faire disparaître, ni faire apparaître personne ici.
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

  // 1) Population candidate : appartenances ACTIVES dans les organisations du
  //    viewer, jamais `users.organization_id`.
  const { data: activeMemberships, error: amErr } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('status', 'active')
    .in('organization_id', orgIds)
  if (amErr) throw amErr
  const candidateUserIds = Array.from(new Set((activeMemberships ?? []).map((m) => m.user_id)))
  if (candidateUserIds.length === 0) return []

  // 2) Profils non archivés, hors compte système admin.
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .neq('role', SYSTEM_ROLE_EXCLUDED_FROM_TEAMS)
    .is('deleted_at', null)
    .in('id', candidateUserIds)
  if (uErr) throw uErr
  if (!users || users.length === 0) return []

  // 3) Tous les userIds qui ont au moins un membership actif dans une équipe
  //    elle-même active, non supprimée, ET dans une organisation du viewer.
  // INCIDENT /equipes (2026-09-30) — hint `!team_id` obligatoire : team_members
  // a DEUX FK vers teams (team_id seul, et (team_id, organization_id) depuis la
  // migration 237). Sans hint, PostgREST refuse l'embed (PGRST201, ambiguïté).
  const { data: memberships, error: mErr } = await supabase
    .from('team_members')
    .select('user_id, team:teams!team_id!inner(active, deleted_at, organization_id)')
    .is('left_at', null)
    .in('user_id', users.map((u) => u.id))
  if (mErr) throw mErr

  type TeamLite = { active: boolean; deleted_at: string | null; organization_id: string | null }
  const memberSet = new Set(
    ((memberships ?? []) as Array<{ user_id: string; team: TeamLite | TeamLite[] | null }>)
      .filter((m) => {
        const t = Array.isArray(m.team) ? m.team[0] ?? null : m.team
        return !!t && t.active && !t.deleted_at && !!t.organization_id && orgIds.includes(t.organization_id)
      })
      .map((m) => m.user_id),
  )
  return users
    .filter((u) => !memberSet.has(u.id))
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
    }))
}

// ----------------------------------------------------------------------------
// Orphan field contacts — pendant terrain de listOrphanUsers()
// ----------------------------------------------------------------------------

export interface OrphanContact {
  id: string
  fullName: string
  job: string | null
  companyName: string | null
  isInternalAgent: boolean
}

/**
 * Contacts terrain (company_contacts, sans compte applicatif) de l'org qui ne
 * sont membres actifs d'aucune équipe ACTIVE — pendant de `listOrphanUsers()`
 * pour l'autre population (cf. `countOrphanContacts` dans team-pulse.ts, qui
 * applique le même filtre mais ne renvoie qu'un compte). Deux populations
 * disjointes, jamais fusionnées par nom ou email : une personne terrain et un
 * compte applicatif restent deux identités distinctes même si le bandeau
 * « sans équipe » de la page Équipes les affiche désormais côte à côte.
 */
export async function listOrphanContacts(): Promise<OrphanContact[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → personne.
  if (orgIds.length === 0) return []

  const { data: contacts, error: cErr } = await supabase
    .from('company_contacts')
    .select('id, full_name, function, company_id, is_internal_agent')
    .is('deleted_at', null)
    .in('organization_id', orgIds)
  if (cErr) throw cErr
  if (!contacts || contacts.length === 0) return []

  const { data: teamRows, error: tErr } = await supabase
    .from('teams')
    .select('id')
    .eq('active', true)
    .is('deleted_at', null)
    .in('organization_id', orgIds)
  if (tErr) throw tErr
  const activeTeamIds = ((teamRows ?? []) as Array<{ id: string }>).map((t) => t.id)

  let memberSet = new Set<string>()
  if (activeTeamIds.length > 0) {
    const { data: fieldRows, error: fErr } = await supabase
      .from('team_field_members')
      .select('contact_id')
      .in('team_id', activeTeamIds)
      .is('left_at', null)
    if (fErr) throw fErr
    memberSet = new Set(((fieldRows ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))
  }

  type ContactRow = {
    id: string
    full_name: string
    function: string | null
    company_id: string | null
    is_internal_agent: boolean
  }
  const orphanContacts = (contacts as ContactRow[]).filter((c) => !memberSet.has(c.id))
  if (orphanContacts.length === 0) return []

  // Résolution des noms d'entreprise en un seul appel (même patron que
  // listFieldMembersOfTeam dans team-field-members.ts).
  const companyIds = [...new Set(orphanContacts.map((c) => c.company_id).filter((id): id is string => !!id))]
  const nameOf = new Map<string, string>()
  if (companyIds.length > 0) {
    const { data: cos } = await supabase.from('companies').select('id, name').in('id', companyIds)
    for (const c of (cos ?? []) as Array<{ id: string; name: string }>) nameOf.set(c.id, c.name)
  }

  return orphanContacts.map((c) => ({
    id: c.id,
    fullName: c.full_name,
    job: c.function,
    companyName: c.company_id ? nameOf.get(c.company_id) ?? null : null,
    isInternalAgent: c.is_internal_agent,
  }))
}
