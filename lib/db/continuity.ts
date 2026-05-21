// Page Continuité — helpers DB.
//
// Vincent 2026-05-22 — Sprint E (continuité de mémoire anticipée).
//
// TRANSGRESSION ASSUMÉE — cf. [[doctrine-rh]] et [[continuite-de-memoire-anticipee]].
// Cette page rend visible les fins de contrat à venir pour permettre
// d'anticiper la PASSATION DE LA MÉMOIRE OPÉRATIONNELLE portée par ces
// personnes. Le sujet de l'analyse est TOUJOURS la mémoire, jamais la
// personne.
//
// Garde-fous techniques appliqués :
//   #1 Allowlist user_id confinée — ce fichier est l'unique endroit où
//      on peut agréger des informations par user_id pour la continuité.
//      Toute autre tentative dans le code fait échouer forbidden-symbols.
//   #2 Pas de score, pas de notation, pas de prédiction de départ
//   #3 Self-exclu — une personne ne voit pas sa propre fin de contrat
//   #4 Kill switch ENV — CONTINUITY_PAGE_ENABLED (cf. lib/continuity/access.ts)
//   #5 Audit log obligatoire sur chaque consultation
//
// Le sujet grammatical des retours est la MÉMOIRE / le SITE.
// Wording autorisé : "sites portent une mémoire", "passation".
// Wording interdit : "risque de départ", "agent critique", "remplacement".

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'
import type { EmploymentType } from '@/types/db'

// ----------------------------------------------------------------------------
// Types exposés
// ----------------------------------------------------------------------------

export type ContinuityTimeBucket = 'j7' | 'j14' | 'j30'

export interface ContinuityEntry {
  /** ID de la personne dont le contrat se termine (sujet administratif). */
  subject_user_id: string
  subject_label: string
  employment_type: EmploymentType | null
  /** ISO date YYYY-MM-DD. */
  contract_end_date: string
  /** Nombre de jours restants (peut être négatif si dépassé). */
  daysRemaining: number
  /** Bucket temporel pour affichage. */
  bucket: ContinuityTimeBucket
  /** Sites actuellement couverts par les équipes actives de cette personne. */
  sitesCovered: Array<{ site_id: string; site_name: string; contract_name: string | null }>
  /** Équipes actives. */
  activeTeams: Array<{ team_id: string; team_name: string }>
  /** True si un brief de passage de témoin a déjà été créé (draft / shared / acknowledged). */
  briefAlreadyPrepared: boolean
}

export interface ContinuityRisks {
  /** Entrées triées par date d'échéance croissante. */
  entries: ContinuityEntry[]
  /** Compteurs par bucket. */
  counts: {
    j7: number
    j14: number
    j30: number
  }
}

// ----------------------------------------------------------------------------
// listContinuityRisks — fonction principale
// ----------------------------------------------------------------------------

function bucketFor(daysRemaining: number): ContinuityTimeBucket | null {
  if (daysRemaining <= 7) return 'j7'
  if (daysRemaining <= 14) return 'j14'
  if (daysRemaining <= 30) return 'j30'
  return null
}

function displayLabel(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

/**
 * Liste les passations à préparer dans les `horizonDays` à venir.
 *
 * Par défaut, horizon = 30 jours. Inclut aussi les contrats déjà expirés dans
 * les 7 derniers jours (grâce administrative — on a quand même intérêt à
 * documenter qu'une passation n'a peut-être pas eu lieu).
 *
 * @param viewerUserId  Si fourni, l'entrée correspondante est exclue (self-exclu).
 */
export async function listContinuityRisks(input: {
  horizonDays?: number
  viewerUserId?: string | null
} = {}): Promise<ContinuityRisks> {
  const horizon = input.horizonDays ?? 30
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const horizonDate = new Date(today.getTime() + horizon * 24 * 60 * 60 * 1000)
  const horizonIso = horizonDate.toISOString().slice(0, 10)
  // Grâce 7 jours en arrière pour les expirations récentes non encore traitées
  const graceDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const graceIso = graceDate.toISOString().slice(0, 10)

  const admin = createAdminClient()

  // 1. Récupérer les users avec contract_end_date dans la fenêtre
  const { data: users, error: uErr } = await admin
    .from('users')
    .select('id, full_name, email, employment_type, contract_end_date, deleted_at')
    .gte('contract_end_date', graceIso)
    .lte('contract_end_date', horizonIso)
    .is('deleted_at', null)
  if (uErr) throw uErr
  if (!users || users.length === 0) {
    return { entries: [], counts: { j7: 0, j14: 0, j30: 0 } }
  }

  type UserRow = {
    id: string
    full_name: string | null
    email: string
    employment_type: EmploymentType | null
    contract_end_date: string
    deleted_at: string | null
  }
  // Self-exclu — une personne ne voit pas sa propre fin de contrat
  const filteredUsers = (users as UserRow[]).filter(
    (u) => u.id !== input.viewerUserId,
  )

  const userIds = filteredUsers.map((u) => u.id)
  if (userIds.length === 0) {
    return { entries: [], counts: { j7: 0, j14: 0, j30: 0 } }
  }

  // 2. Équipes actives de chaque user (left_at IS NULL)
  const { data: memberships, error: mErr } = await admin
    .from('team_members')
    .select('user_id, team:teams(id, name, deleted_at)')
    .in('user_id', userIds)
    .is('left_at', null)
  if (mErr) throw mErr

  type TeamLite = { id: string; name: string; deleted_at: string | null }
  type MembershipRow = { user_id: string; team: TeamLite | TeamLite[] | null }
  const teamsPerUser = new Map<string, Array<{ team_id: string; team_name: string }>>()
  for (const m of (memberships ?? []) as MembershipRow[]) {
    const team = Array.isArray(m.team) ? m.team[0] ?? null : m.team
    if (!team || team.deleted_at) continue
    const arr = teamsPerUser.get(m.user_id) ?? []
    arr.push({ team_id: team.id, team_name: team.name })
    teamsPerUser.set(m.user_id, arr)
  }

  // 3. Pour chaque équipe, sites couverts (via interventions assigned_team_id)
  const allTeamIds = Array.from(
    new Set(
      Array.from(teamsPerUser.values()).flatMap((arr) => arr.map((t) => t.team_id)),
    ),
  )
  type SiteByTeam = Map<string, Array<{ site_id: string; site_name: string; contract_name: string | null }>>
  const sitesByTeam: SiteByTeam = new Map()
  if (allTeamIds.length > 0) {
    const { data: interventions } = await admin
      .from('interventions')
      .select(`
        assigned_team_id,
        mission:missions!inner(
          name,
          site:sites!inner(
            id, name,
            contract:contracts(name)
          )
        )
      `)
      .in('assigned_team_id', allTeamIds)
      .in('status', ['planned', 'in_progress', 'completed', 'validated'])

    type IntervRow = {
      assigned_team_id: string
      mission: unknown
    }
    type MissionLite = {
      name: string
      site: { id: string; name: string; contract: unknown } | { id: string; name: string; contract: unknown }[]
    }
    type SiteLite = { id: string; name: string; contract: unknown }
    type ContractLite = { name: string }
    const pickOne = <T,>(v: T | T[] | null | undefined): T | null => {
      if (v === null || v === undefined) return null
      return Array.isArray(v) ? (v[0] as T) ?? null : v
    }
    for (const i of (interventions ?? []) as unknown as IntervRow[]) {
      const mission = pickOne(i.mission as MissionLite | MissionLite[])
      if (!mission || isSystemMissionName(mission.name)) continue
      const site = pickOne(mission.site as SiteLite | SiteLite[])
      if (!site?.id) continue
      const contract = pickOne(site.contract as ContractLite | ContractLite[])
      const arr = sitesByTeam.get(i.assigned_team_id) ?? []
      // Dedup par site_id
      if (!arr.find((s) => s.site_id === site.id)) {
        arr.push({
          site_id: site.id,
          site_name: site.name,
          contract_name: contract?.name ?? null,
        })
      }
      sitesByTeam.set(i.assigned_team_id, arr)
    }
  }

  // 4. Briefs déjà préparés (handover_briefs avec subject_user_id matchant, non archivés)
  const { data: briefs } = await admin
    .from('handover_briefs')
    .select('subject_user_id, status')
    .in('subject_user_id', userIds)
    .neq('status', 'archived')
    .is('deleted_at', null)
  const briefBySubject = new Set(
    ((briefs ?? []) as Array<{ subject_user_id: string | null; status: string }>)
      .filter((b) => b.subject_user_id)
      .map((b) => b.subject_user_id as string),
  )

  // 5. Construire les entrées
  const entries: ContinuityEntry[] = []
  for (const u of filteredUsers) {
    const endDate = new Date(u.contract_end_date)
    const daysRemaining = Math.ceil(
      (endDate.getTime() - new Date(todayIso).getTime()) / (1000 * 60 * 60 * 24),
    )
    const bucket = bucketFor(daysRemaining)
    if (!bucket) continue

    const teams = teamsPerUser.get(u.id) ?? []
    const sitesSet = new Map<string, { site_id: string; site_name: string; contract_name: string | null }>()
    for (const t of teams) {
      for (const s of sitesByTeam.get(t.team_id) ?? []) {
        sitesSet.set(s.site_id, s)
      }
    }

    entries.push({
      subject_user_id: u.id,
      subject_label: displayLabel(u.full_name, u.email),
      employment_type: u.employment_type,
      contract_end_date: u.contract_end_date,
      daysRemaining,
      bucket,
      sitesCovered: Array.from(sitesSet.values()),
      activeTeams: teams,
      briefAlreadyPrepared: briefBySubject.has(u.id),
    })
  }

  // Tri par jours restants (le plus proche en premier)
  entries.sort((a, b) => a.daysRemaining - b.daysRemaining)

  const counts = {
    j7: entries.filter((e) => e.bucket === 'j7').length,
    j14: entries.filter((e) => e.bucket === 'j14').length,
    j30: entries.filter((e) => e.bucket === 'j30').length,
  }

  return { entries, counts }
}

// ----------------------------------------------------------------------------
// updateContractEndDate — server-side helper utilisé par l'action
// ----------------------------------------------------------------------------

export async function updateContractEndDate(
  userId: string,
  date: string | null,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('users')
    .update({ contract_end_date: date })
    .eq('id', userId)
  if (error) throw error
}
