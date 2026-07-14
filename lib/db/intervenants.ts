// Page Intervenants — helpers DB.
//
// Vincent 2026-05-21 — TRANSGRESSION ASSUMÉE (cf. mémoire projet
// `page-personne-pivot-transgression`). Ce fichier est l'ALLOWLIST EXPLICITE
// pour les agrégats descriptifs par user_id. Toute autre agrégation user_id
// dans le code reste interdite par les tripwires existants.
//
// Garde-fous techniques appliqués :
//   #2 Pas de score numérique calculé — chiffres descriptifs uniquement
//      (compteurs, dates, listes). Aucune moyenne, aucun ratio évaluatif.
//   #3 Pas de comparaison côte à côte — chaque fonction prend UN seul
//      intervenantId, retourne SA propre vue. Jamais 2 sujets sur même retour.
//   #4 Wording descriptif — aucun adjectif qualificatif dans les libellés.
//   #6 Tripwire allowlist — ce fichier est la liste blanche documentée.
//
// Convention nommage : on évite `*ByUser` / `*ByAgent` (interdits par
// `forbidden-symbols.test.ts`) au profit de `*Intervenant`.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import type { DbUser } from '@/types/db'

// ----------------------------------------------------------------------------
// Types exposés
// ----------------------------------------------------------------------------

export interface IntervenantOverview {
  id: string
  full_name: string | null
  email: string
  role: string
  created_at: string
  /** Champs profil étendus (migration 076, Vincent 2026-05-21). */
  phone: string | null
  commune: string | null
  employment_type: 'cdi' | 'cdd' | 'cdi_chantier' | null
  /** Migration 081 (Sprint E) — sert à anticiper la passation. Pas RH. */
  contract_end_date: string | null
  /** Compteurs descriptifs uniquement. */
  counters: {
    interventionsParticipated: number
    sitesKnown: number
    contractsKnown: number
    notesLeft: number
    anomaliesSignaled: number
    photosTaken: number
    voiceNotesRecorded: number
  }
  /** Équipes actives de l'intervenant (left_at IS NULL). */
  teams: Array<{ team_id: string; team_name: string; team_color: string | null }>
}

export interface IntervenantSiteAccumulated {
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  interventionCount: number
  firstParticipationDate: string | null
  lastParticipationDate: string | null
  /** Thumbnails (jusqu'à 4) des photos déposées par cet intervenant sur ce site. */
  recentPhotoIds: string[]
}

export interface IntervenantContractKnown {
  contract_id: string
  contract_name: string
  client_name: string | null
  interventionCount: number
  firstParticipationDate: string | null
  lastParticipationDate: string | null
}

export interface IntervenantInterventionEntry {
  intervention_id: string
  mission_name: string
  site_name: string
  site_id: string
  scheduled_for: string | null
  status: string
  /** Plage horaire de prestation (V6.1) — par intervention, jamais cumulée. */
  planned_start: string | null
  planned_end: string | null
  slot: string | null
}

export interface IntervenantTracesSummary {
  notesLeft: number
  anomaliesSignaled: number
  photosTaken: number
  voiceNotesRecorded: number
  lastTraceAt: string | null
}

/** Cellule du heatmap calendrier : 1 entrée par date avec un nombre d'interventions. */
export interface IntervenantHeatmapCell {
  /** yyyy-mm-dd */
  date: string
  count: number
}

/** Jour du rythme récent — équivalent SiteRhythmDay pour un intervenant. */
export interface IntervenantRhythmDay {
  date: string
  weekdayLabel: string
  dayMonthLabel: string
  isToday: boolean
  isWeekend: boolean
  count: number
  /** Tooltip : 1 ligne par intervention ce jour-là (mission · site). */
  tooltipLines: string[]
}

/** Équipe fréquentée (active ou passée) sur la fenêtre demandée. */
export interface IntervenantTeamHistoryEntry {
  team_id: string
  team_name: string
  team_color: string | null
  /** Date `joined_at` du `team_members`. */
  joinedAt: string | null
  /** Date `left_at` (NULL = actuellement dans l'équipe). */
  leftAt: string | null
  /** True si actuellement dans l'équipe (left_at IS NULL). */
  isCurrent: boolean
  /** Nombre d'interventions documentées de cette équipe pendant la fenêtre. */
  interventionsCount: number
}

/** Collègue ayant partagé une équipe avec l'intervenant. */
export interface IntervenantCollaborator {
  user_id: string
  full_name: string | null
  email: string
  /** Équipes partagées (noms). */
  sharedTeams: string[]
  /** Présence partagée actuelle (left_at IS NULL pour les deux). */
  currentlySharedTeam: boolean
}

/** Anomalie signalée sur une intervention où cet intervenant a participé. */
export interface IntervenantIncidentPresence {
  anomaly_id: string
  intervention_id: string
  site_id: string
  site_name: string
  scheduled_for: string | null
  description: string
  /** True si signalée PAR cet intervenant lui-même. */
  signaledBySelf: boolean
}

/** Photo récente déposée par l'intervenant — pour la galerie thumbnails. */
export interface IntervenantPhotoEntry {
  id: string
  signedUrl: string
  caption: string | null
  kind: string
  takenAt: string
  interventionId: string
  /** Site sur lequel la photo a été prise (pour grouper par site dans l'UI). */
  siteId: string | null
  siteName: string | null
}

/** Ligne de la liste `/intervenants`. */
export interface IntervenantListRow {
  id: string
  full_name: string | null
  email: string
  role: string
  teams: Array<{ team_id: string; team_name: string; team_color: string | null }>
  sitesKnown: number
  /** Noms des lieux les plus suivis (max 2), par fréquence — « territoires connus ». */
  topSites: string[]
  interventionsParticipated: number
  lastParticipationDate: string | null
  /**
   * Le compte a été créé mais la personne ne s'est jamais connectée.
   *
   * C'est l'« invitation en attente » que Guillaume réclamait : elle n'avait pas
   * besoin d'une table, le fait était déjà en base. `must_change_password` est
   * posé à la création et ne retombe qu'au premier login réussi — tant qu'il est
   * vrai, la personne n'a jamais ouvert MemorIA.
   *
   * Fait administratif (le compte n'est pas arrivé), jamais un jugement sur la
   * personne : on ne mesure pas son activité, on constate qu'elle n'est pas entrée.
   */
  neverOpened: boolean
}

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

export function getDemoClientScopeForViewerEmail(email: string | null | undefined): string | null {
  switch ((email ?? '').trim().toLowerCase()) {
    case 'adrien@memoria.nc':
      return 'BatiSud Construction'
    default:
      return null
  }
}

export function filterIntervenantUsersForScope<T extends { id: string }>(
  users: T[],
  allowedUserIds: Set<string> | null,
): T[] {
  if (!allowedUserIds) return users
  return users.filter((user) => allowedUserIds.has(user.id))
}

async function resolveIntervenantScopeUserIds(input: {
  viewerId: string
  viewerEmail: string
}): Promise<Set<string> | null> {
  const clientName = getDemoClientScopeForViewerEmail(input.viewerEmail)
  if (!clientName) return null

  const admin = createAdminClient()
  const allowed = new Set<string>([input.viewerId])

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id')
    .eq('name', clientName)
    .is('deleted_at', null)
    .maybeSingle()
  if (clientErr) throw clientErr
  if (!client) return allowed

  const { data: sites, error: siteErr } = await admin
    .from('sites')
    .select('id')
    .eq('client_id', client.id)
    .is('deleted_at', null)
  if (siteErr) throw siteErr
  const siteIds = (sites ?? []).map((site) => site.id as string)
  if (siteIds.length === 0) return allowed

  const { data: missions, error: missionErr } = await admin
    .from('missions')
    .select('id')
    .in('site_id', siteIds)
    .is('deleted_at', null)
  if (missionErr) throw missionErr
  const missionIds = (missions ?? []).map((mission) => mission.id as string)
  if (missionIds.length === 0) return allowed

  const { data: interventions, error: interventionErr } = await admin
    .from('interventions')
    .select('assigned_team_id')
    .in('mission_id', missionIds)
    .not('assigned_team_id', 'is', null)
  if (interventionErr) throw interventionErr
  const teamIds = Array.from(
    new Set((interventions ?? []).map((row) => row.assigned_team_id as string).filter(Boolean)),
  )
  if (teamIds.length === 0) return allowed

  const { data: memberships, error: memberErr } = await admin
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds)
    .is('left_at', null)
  if (memberErr) throw memberErr
  for (const row of memberships ?? []) {
    if (row.user_id) allowed.add(row.user_id as string)
  }

  return allowed
}

export async function canViewerAccessIntervenantInScope(input: {
  viewerId: string
  viewerEmail: string
  targetUserId: string
}): Promise<boolean> {
  if (input.viewerId === input.targetUserId) return true
  const allowedUserIds = await resolveIntervenantScopeUserIds({
    viewerId: input.viewerId,
    viewerEmail: input.viewerEmail,
  })
  if (!allowedUserIds) return true
  return allowedUserIds.has(input.targetUserId)
}

// ----------------------------------------------------------------------------
// fetchUserParticipations — source unique des participations d'un intervenant
// ----------------------------------------------------------------------------
//
// Vincent 2026-05-21 (fix « tout à 0 ») : `intervention_participants` est une
// table V3 prévue pour la « vraie composition jour-J » mais peu peuplée en
// pratique. Le pattern qui fonctionne dans le reste du projet (cf.
// `getSiteTeamPresences`, `getSiteHumanContinuity`) = passer par
// `team_members` → `interventions.assigned_team_id`.
//
// On adopte ce pattern ici pour que les compteurs reflètent l'usage réel.

/** Liste les team_ids actuellement actifs pour cet intervenant. */
async function fetchActiveTeamIds(intervenantId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', intervenantId)
    .is('left_at', null)
  return ((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id)
}

/**
 * Récupère TOUTES les interventions auxquelles cet intervenant a participé,
 * via la jointure team_members → teams → interventions.assigned_team_id.
 *
 * Filtre les missions système. Retourne au format `ResolvedParticipation[]`
 * compatible avec les helpers existants.
 */
async function fetchUserParticipations(
  intervenantId: string,
): Promise<ResolvedParticipation[]> {
  const teamIds = await fetchActiveTeamIds(intervenantId)
  if (teamIds.length === 0) return []

  const admin = createAdminClient()
  const { data } = await admin
    .from('interventions')
    .select(`
      id,
      scheduled_for,
      status,
      planned_start,
      planned_end,
      slot,
      mission:missions!inner(
        name,
        site:sites!inner(
          id,
          name,
          contract:contracts(id, name),
          client:clients(name)
        )
      )
    `)
    .in('assigned_team_id', teamIds)

  type Row = {
    id: string
    scheduled_for: string | null
    status: string
    planned_start: string | null
    planned_end: string | null
    slot: string | null
    mission: unknown
  }

  const out: ResolvedParticipation[] = []
  for (const r of (data ?? []) as Row[]) {
    const mission = pickOne(r.mission) as { name?: string; site?: unknown } | null
    if (!mission?.name) continue
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(mission.site) as {
      id?: string
      name?: string
      contract?: unknown
      client?: unknown
    } | null
    if (!site?.id || !site.name) continue
    const contract = pickOne(site.contract) as { id?: string; name?: string } | null
    const client = pickOne(site.client) as { name?: string } | null

    out.push({
      intervention_id: r.id,
      scheduled_for: r.scheduled_for,
      status: r.status,
      planned_start: r.planned_start,
      planned_end: r.planned_end,
      slot: r.slot,
      mission_name: mission.name,
      site_id: site.id,
      site_name: site.name,
      contract_id: contract?.id ?? null,
      contract_name: contract?.name ?? null,
      client_name: client?.name ?? null,
    })
  }
  return out
}

// Type Supabase nested — on déclare une forme permissive et on parcourt.
type ParticipationRow = {
  intervention: unknown
}

interface ResolvedParticipation {
  intervention_id: string
  scheduled_for: string | null
  status: string
  planned_start: string | null
  planned_end: string | null
  slot: string | null
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
}

/**
 * Aplatit le résultat d'une jointure intervention_participants ↦ intervention
 * ↦ mission ↦ site ↦ contract ↦ client en lignes plates et typées. Filtre les
 * missions système (« Traces libres du site »).
 */
function flattenParticipations(rows: ParticipationRow[]): ResolvedParticipation[] {
  const out: ResolvedParticipation[] = []
  for (const r of rows) {
    const intv = pickOne(r.intervention) as {
      id?: string
      scheduled_for?: string | null
      status?: string
      planned_start?: string | null
      planned_end?: string | null
      slot?: string | null
      mission?: unknown
    } | null
    if (!intv?.id) continue
    const mission = pickOne(intv.mission) as {
      name?: string
      site?: unknown
    } | null
    if (!mission?.name) continue
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(mission.site) as {
      id?: string
      name?: string
      contract?: unknown
      client?: unknown
    } | null
    if (!site?.id || !site.name) continue
    const contract = pickOne(site.contract) as { id?: string; name?: string } | null
    const client = pickOne(site.client) as { name?: string } | null

    out.push({
      intervention_id: intv.id,
      scheduled_for: intv.scheduled_for ?? null,
      status: intv.status ?? 'unknown',
      planned_start: intv.planned_start ?? null,
      planned_end: intv.planned_end ?? null,
      slot: intv.slot ?? null,
      mission_name: mission.name,
      site_id: site.id,
      site_name: site.name,
      contract_id: contract?.id ?? null,
      contract_name: contract?.name ?? null,
      client_name: client?.name ?? null,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// getIntervenantOverview — identité + compteurs + équipes actives
// ----------------------------------------------------------------------------

export async function getIntervenantOverview(
  intervenantId: string,
): Promise<IntervenantOverview | null> {
  const admin = createAdminClient()
  const { data: user } = await admin
    .from('users')
    .select('id, email, full_name, role, created_at, phone, commune, employment_type, contract_end_date')
    .eq('id', intervenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!user) return null
  const userExt = user as { id: string; email: string; full_name: string | null; role: string; created_at: string; phone: string | null; commune: string | null; employment_type: 'cdi' | 'cdd' | 'cdi_chantier' | null; contract_end_date: string | null }

  // Source : team_members → interventions.assigned_team_id (cf. fix « tout à 0 »).
  const [participations, notes, anomalies, photos, voiceNotes, teamRows] = await Promise.all([
    fetchUserParticipations(intervenantId),
    admin
      .from('intervention_notes')
      .select('id', { count: 'exact', head: true })
      .eq('recorded_by', intervenantId),
    admin
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .eq('reported_by', intervenantId),
    admin
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .eq('taken_by', intervenantId),
    admin
      .from('intervention_voice_notes')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', intervenantId),
    admin
      .from('team_members')
      .select('team:teams(id, name, color)')
      .eq('user_id', intervenantId)
      .is('left_at', null),
  ])

  // Sites & contrats distincts dérivés des participations
  const siteIds = new Set<string>()
  const contractIds = new Set<string>()
  for (const p of participations) {
    if (p.site_id) siteIds.add(p.site_id)
    if (p.contract_id) contractIds.add(p.contract_id)
  }

  // Équipes actives
  const teams: Array<{ team_id: string; team_name: string; team_color: string | null }> = []
  for (const row of (teamRows.data ?? []) as Array<{ team: unknown }>) {
    const team = pickOne(row.team) as { id?: string; name?: string; color?: string | null } | null
    if (team?.id && team.name) {
      teams.push({ team_id: team.id, team_name: team.name, team_color: team.color ?? null })
    }
  }

  return {
    id: userExt.id,
    full_name: userExt.full_name,
    email: userExt.email,
    role: userExt.role,
    created_at: userExt.created_at,
    phone: userExt.phone,
    commune: userExt.commune,
    employment_type: userExt.employment_type,
    contract_end_date: userExt.contract_end_date,
    counters: {
      interventionsParticipated: participations.length,
      sitesKnown: siteIds.size,
      contractsKnown: contractIds.size,
      notesLeft: notes.count ?? 0,
      anomaliesSignaled: anomalies.count ?? 0,
      photosTaken: photos.count ?? 0,
      voiceNotesRecorded: voiceNotes.count ?? 0,
    },
    teams,
  }
}

// ----------------------------------------------------------------------------
// listIntervenantSitesAccumulated — sites où il/elle est passé
// ----------------------------------------------------------------------------

export async function listIntervenantSitesAccumulated(
  intervenantId: string,
): Promise<IntervenantSiteAccumulated[]> {
  const admin = createAdminClient()
  const flat = await fetchUserParticipations(intervenantId)

  const bySite = new Map<string, IntervenantSiteAccumulated>()
  for (const p of flat) {
    const existing = bySite.get(p.site_id)
    if (existing) {
      existing.interventionCount += 1
      if (p.scheduled_for) {
        if (!existing.firstParticipationDate || p.scheduled_for < existing.firstParticipationDate) {
          existing.firstParticipationDate = p.scheduled_for
        }
        if (!existing.lastParticipationDate || p.scheduled_for > existing.lastParticipationDate) {
          existing.lastParticipationDate = p.scheduled_for
        }
      }
    } else {
      bySite.set(p.site_id, {
        site_id: p.site_id,
        site_name: p.site_name,
        contract_id: p.contract_id,
        contract_name: p.contract_name,
        interventionCount: 1,
        firstParticipationDate: p.scheduled_for,
        lastParticipationDate: p.scheduled_for,
        recentPhotoIds: [],
      })
    }
  }

  // Charger 4 dernières photos prises PAR CET INTERVENANT sur chaque site
  const siteIds = Array.from(bySite.keys())
  if (siteIds.length > 0) {
    const { data: photoRows } = await admin
      .from('intervention_photos')
      .select(`
        id,
        intervention:interventions!inner(
          mission:missions!inner(site_id)
        )
      `)
      .eq('taken_by', intervenantId)
      .order('taken_at', { ascending: false })
      .limit(siteIds.length * 4)

    for (const row of (photoRows ?? []) as Array<{
      id: string
      intervention: unknown
    }>) {
      const intv = pickOne(row.intervention) as { mission?: unknown } | null
      if (!intv) continue
      const mission = pickOne(intv.mission) as { site_id?: string } | null
      const siteId = mission?.site_id
      if (!siteId) continue
      const target = bySite.get(siteId)
      if (target && target.recentPhotoIds.length < 4) {
        target.recentPhotoIds.push(row.id)
      }
    }
  }

  return Array.from(bySite.values()).sort((a, b) => {
    if (a.lastParticipationDate && b.lastParticipationDate) {
      return b.lastParticipationDate.localeCompare(a.lastParticipationDate)
    }
    return a.site_name.localeCompare(b.site_name, 'fr', { sensitivity: 'base' })
  })
}

// ----------------------------------------------------------------------------
// listIntervenantContractsKnown — contrats déjà travaillés
// ----------------------------------------------------------------------------

export async function listIntervenantContractsKnown(
  intervenantId: string,
): Promise<IntervenantContractKnown[]> {
  const flat = await fetchUserParticipations(intervenantId)

  const byContract = new Map<string, IntervenantContractKnown>()
  for (const p of flat) {
    if (!p.contract_id) continue
    const existing = byContract.get(p.contract_id)
    if (existing) {
      existing.interventionCount += 1
      if (p.scheduled_for) {
        if (!existing.firstParticipationDate || p.scheduled_for < existing.firstParticipationDate) {
          existing.firstParticipationDate = p.scheduled_for
        }
        if (!existing.lastParticipationDate || p.scheduled_for > existing.lastParticipationDate) {
          existing.lastParticipationDate = p.scheduled_for
        }
      }
    } else {
      byContract.set(p.contract_id, {
        contract_id: p.contract_id,
        contract_name: p.contract_name ?? '—',
        client_name: p.client_name,
        interventionCount: 1,
        firstParticipationDate: p.scheduled_for,
        lastParticipationDate: p.scheduled_for,
      })
    }
  }

  return Array.from(byContract.values()).sort((a, b) => {
    if (a.lastParticipationDate && b.lastParticipationDate) {
      return b.lastParticipationDate.localeCompare(a.lastParticipationDate)
    }
    return a.contract_name.localeCompare(b.contract_name, 'fr', { sensitivity: 'base' })
  })
}

// ----------------------------------------------------------------------------
// listIntervenantRecentInterventions — 20 dernières chronologiques
// ----------------------------------------------------------------------------

export async function listIntervenantRecentInterventions(
  intervenantId: string,
  limit: number = 20,
): Promise<IntervenantInterventionEntry[]> {
  const flat = await fetchUserParticipations(intervenantId)

  flat.sort((a, b) => {
    const ax = a.scheduled_for ?? '0000-00-00'
    const bx = b.scheduled_for ?? '0000-00-00'
    return bx.localeCompare(ax)
  })

  return flat.slice(0, limit).map((p) => ({
    intervention_id: p.intervention_id,
    mission_name: p.mission_name,
    site_name: p.site_name,
    site_id: p.site_id,
    scheduled_for: p.scheduled_for,
    status: p.status,
    planned_start: p.planned_start,
    planned_end: p.planned_end,
    slot: p.slot,
  }))
}

// ----------------------------------------------------------------------------
// getIntervenantTracesSummary — totaux artefacts laissés
// ----------------------------------------------------------------------------

export async function getIntervenantTracesSummary(
  intervenantId: string,
): Promise<IntervenantTracesSummary> {
  const admin = createAdminClient()
  const [notes, anomalies, photos, voiceNotes, lastNote, lastAnomaly, lastPhoto] = await Promise.all([
    admin.from('intervention_notes').select('id', { count: 'exact', head: true }).eq('recorded_by', intervenantId),
    admin.from('intervention_anomalies').select('id', { count: 'exact', head: true }).eq('reported_by', intervenantId),
    admin.from('intervention_photos').select('id', { count: 'exact', head: true }).eq('taken_by', intervenantId),
    admin.from('intervention_voice_notes').select('id', { count: 'exact', head: true }).eq('created_by', intervenantId),
    admin.from('intervention_notes').select('created_at').eq('recorded_by', intervenantId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('intervention_anomalies').select('created_at').eq('reported_by', intervenantId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('intervention_photos').select('taken_at').eq('taken_by', intervenantId).order('taken_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const candidates = [
    (lastNote.data as { created_at?: string } | null)?.created_at,
    (lastAnomaly.data as { created_at?: string } | null)?.created_at,
    (lastPhoto.data as { taken_at?: string } | null)?.taken_at,
  ].filter(Boolean) as string[]
  const lastTraceAt = candidates.length > 0 ? candidates.sort().pop() ?? null : null

  return {
    notesLeft: notes.count ?? 0,
    anomaliesSignaled: anomalies.count ?? 0,
    photosTaken: photos.count ?? 0,
    voiceNotesRecorded: voiceNotes.count ?? 0,
    lastTraceAt,
  }
}

// ----------------------------------------------------------------------------
// getIntervenantHeatmap — répartition par date sur N derniers jours
// ----------------------------------------------------------------------------

/**
 * Retourne le nombre d'interventions DOCUMENTÉES (status completed/validated/in_progress)
 * par jour sur les `days` derniers jours. Sert au calendrier-heatmap.
 *
 * Compteur PAR JOUR uniquement — pas un score, pas une moyenne.
 */
export async function getIntervenantHeatmap(
  intervenantId: string,
  days: number = 90,
): Promise<IntervenantHeatmapCell[]> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - days + 1)
  const sinceIso = since.toISOString().slice(0, 10)

  const participations = await fetchUserParticipations(intervenantId)

  const counts = new Map<string, number>()
  for (const p of participations) {
    if (!p.scheduled_for) continue
    if (p.scheduled_for < sinceIso) continue
    counts.set(p.scheduled_for, (counts.get(p.scheduled_for) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ----------------------------------------------------------------------------
// listIntervenantsForList — index `/intervenants` (manager+admin uniquement)
// ----------------------------------------------------------------------------

/**
 * Liste les intervenants actifs (users non soft-deleted) avec leurs équipes
 * et un aperçu : nb sites connus, nb interventions, dernier passage.
 *
 * Pas de classement — tri alphabétique uniquement. Tous les counters sont
 * descriptifs (faits cumulés), aucun score, aucune moyenne.
 */
export async function listIntervenantsForList(viewer?: {
  id: string
  email: string
} | null): Promise<IntervenantListRow[]> {
  const admin = createAdminClient()
  const [scopedUserIds, orgId] = await Promise.all([
    viewer
      ? resolveIntervenantScopeUserIds({ viewerId: viewer.id, viewerEmail: viewer.email })
      : Promise.resolve(null),
    getOrgId(),
  ])

  // 1) Users actifs intervenants — managers + chefs_equipe (les chefs_equipe
  //    sont aussi des intervenants). L'admin (compte système) est EXCLU : ce
  //    n'est pas un intervenant terrain et ne doit jamais apparaître comme
  //    sujet (Vincent 2026-05-22).
  let usersQuery = admin
    .from('users')
    .select('id, email, full_name, role, must_change_password')
    .is('deleted_at', null)
    .neq('role', 'admin')
    .order('full_name', { ascending: true, nullsFirst: false })
  if (orgId) usersQuery = usersQuery.eq('organization_id', orgId)
  if (scopedUserIds) {
    const ids = Array.from(scopedUserIds)
    if (ids.length === 0) return []
    usersQuery = usersQuery.in('id', ids)
  }
  const { data: users } = await usersQuery

  if (!users || users.length === 0) return []
  const visibleUsers = filterIntervenantUsersForScope(users, scopedUserIds)
  if (visibleUsers.length === 0) return []

  const userIds = visibleUsers.map((u) => u.id)

  // 2) Équipes actives par user
  const { data: memberRows } = await admin
    .from('team_members')
    .select('user_id, team:teams(id, name, color)')
    .in('user_id', userIds)
    .is('left_at', null)

  const teamsByUser = new Map<string, IntervenantListRow['teams']>()
  for (const row of (memberRows ?? []) as Array<{ user_id: string; team: unknown }>) {
    const team = pickOne(row.team) as { id?: string; name?: string; color?: string | null } | null
    if (!team?.id || !team.name) continue
    const arr = teamsByUser.get(row.user_id) ?? []
    arr.push({ team_id: team.id, team_name: team.name, team_color: team.color ?? null })
    teamsByUser.set(row.user_id, arr)
  }

  // 3) Participations agrégées via team_members → assigned_team_id
  // (fix « tout à 0 » Vincent 2026-05-21 : intervention_participants peu peuplée).
  // siteFreq garde le nom + la fréquence par site → « territoires connus ».
  type Stats = { siteFreq: Map<string, { name: string; count: number }>; count: number; lastAt: string | null }
  const statsByUser = new Map<string, Stats>()

  // Reverse map team_id → user_ids (pour distribuer les counts des interventions)
  const teamMembersByTeam = new Map<string, string[]>()
  for (const row of (memberRows ?? []) as Array<{ user_id: string; team: unknown }>) {
    const team = pickOne(row.team) as { id?: string } | null
    if (!team?.id) continue
    const arr = teamMembersByTeam.get(team.id) ?? []
    arr.push(row.user_id)
    teamMembersByTeam.set(team.id, arr)
  }

  const teamIdsAll = Array.from(teamMembersByTeam.keys())
  if (teamIdsAll.length > 0) {
    const { data: interventions } = await admin
      .from('interventions')
      .select(`
        assigned_team_id,
        scheduled_for,
        mission:missions!inner(
          name,
          site:sites!inner(id, name)
        )
      `)
      .in('assigned_team_id', teamIdsAll)

    for (const row of (interventions ?? []) as Array<{
      assigned_team_id: string | null
      scheduled_for: string | null
      mission: unknown
    }>) {
      if (!row.assigned_team_id) continue
      const mission = pickOne(row.mission) as { name?: string; site?: unknown } | null
      if (!mission?.name) continue
      if (isSystemMissionName(mission.name)) continue
      const site = pickOne(mission.site) as { id?: string; name?: string } | null
      if (!site?.id) continue

      const userIdsOfTeam = teamMembersByTeam.get(row.assigned_team_id) ?? []
      for (const uid of userIdsOfTeam) {
        const stats = statsByUser.get(uid) ?? { siteFreq: new Map<string, { name: string; count: number }>(), count: 0, lastAt: null }
        const prev = stats.siteFreq.get(site.id)
        if (prev) prev.count += 1
        else stats.siteFreq.set(site.id, { name: site.name ?? '—', count: 1 })
        stats.count += 1
        if (row.scheduled_for && (!stats.lastAt || row.scheduled_for > stats.lastAt)) {
          stats.lastAt = row.scheduled_for
        }
        statsByUser.set(uid, stats)
      }
    }
  }

  return visibleUsers.map<IntervenantListRow>((u) => {
    const stats = statsByUser.get(u.id) ?? { siteFreq: new Map<string, { name: string; count: number }>(), count: 0, lastAt: null }
    // Top 2 lieux par fréquence (puis alphabétique) — « territoires connus ».
    const topSites = Array.from(stats.siteFreq.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 2)
      .map((s) => s.name)
    return {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      teams: teamsByUser.get(u.id) ?? [],
      sitesKnown: stats.siteFreq.size,
      topSites,
      interventionsParticipated: stats.count,
      lastParticipationDate: stats.lastAt,
      neverOpened: (u as { must_change_password?: boolean }).must_change_password === true,
    }
  })
}

// ----------------------------------------------------------------------------
// listIntervenantRecentPhotos — galerie thumbnails
// ----------------------------------------------------------------------------

/**
 * Photos récentes déposées par l'intervenant — pour la galerie thumbnails sur
 * la page détail. Inspiré de `getSiteRecentPhotos` mais filtré par `taken_by`.
 *
 * Tri : priorité anomaly_evidence > captioned > recent.
 * Cap par défaut : 12 (grille 4×3 confortable).
 *
 * Doctrine : c'est un agrégat user_id descriptif (l'allowlist de ce module
 * l'autorise). Pas de score, pas de moyenne — juste les artefacts déposés.
 */
export async function listIntervenantRecentPhotos(
  intervenantId: string,
  limit: number = 12,
): Promise<IntervenantPhotoEntry[]> {
  const admin = createAdminClient()

  const { data: photosRaw } = await admin
    .from('intervention_photos')
    .select(`
      id,
      storage_path,
      caption,
      kind,
      taken_at,
      intervention_id,
      intervention:interventions!inner(
        mission:missions!inner(
          site:sites!inner(id, name)
        )
      )
    `)
    .eq('taken_by', intervenantId)
    .not('storage_path', 'is', null)
    .order('taken_at', { ascending: false })
    .limit(limit * 4)

  type PhotoRow = {
    id: string
    storage_path: string
    caption: string | null
    kind: string
    taken_at: string
    intervention_id: string
    intervention: unknown
  }
  const rows = (photosRaw ?? []) as PhotoRow[]
  if (rows.length === 0) return []

  // Score de pertinence (cf. pattern getSiteRecentPhotos).
  const score = (r: PhotoRow): number => {
    if (r.kind === 'anomaly_evidence' || r.kind === 'anomaly') return 0
    if (r.caption) return 1
    return 2
  }
  rows.sort((a, b) => score(a) - score(b) || b.taken_at.localeCompare(a.taken_at))
  const top = rows.slice(0, limit)

  const urlMap = await getSignedPhotoUrlsThumb(top.map((p) => p.storage_path))

  return top
    .map((p) => {
      const url = urlMap.get(p.storage_path)
      if (!url) return null
      const intv = pickOne(p.intervention) as { mission?: unknown } | null
      const mission = intv ? (pickOne(intv.mission) as { site?: unknown } | null) : null
      const site = mission ? (pickOne(mission.site) as { id?: string; name?: string } | null) : null
      const entry: IntervenantPhotoEntry = {
        id: p.id,
        signedUrl: url,
        caption: p.caption,
        kind: p.kind,
        takenAt: p.taken_at,
        interventionId: p.intervention_id,
        siteId: site?.id ?? null,
        siteName: site?.name ?? null,
      }
      return entry
    })
    .filter((p): p is IntervenantPhotoEntry => p !== null)
}

// ============================================================================
// EXTENSIONS Vincent 2026-05-21 (post-fix « tout à 0 »)
// Historique équipes 2 ans · collaborateurs · présence lors d'incidents.
// ============================================================================

/**
 * Historique des équipes fréquentées sur N derniers mois (default 24 mois = 2 ans).
 * Inclut les équipes QUITTÉES si elles ont été partagées dans la fenêtre.
 *
 * Doctrine : sujet = personne, factuel uniquement (joinedAt/leftAt). Pas de
 * « ancienneté moyenne », pas de classement entre équipes.
 */
export async function getIntervenantTeamsHistory(
  intervenantId: string,
  monthsBack: number = 24,
): Promise<IntervenantTeamHistoryEntry[]> {
  const admin = createAdminClient()
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - monthsBack)
  const sinceIso = since.toISOString()

  const { data: memberships } = await admin
    .from('team_members')
    .select('team_id, joined_at, left_at, team:teams(id, name, color, deleted_at)')
    .eq('user_id', intervenantId)
    .or('left_at.is.null,left_at.gte.' + sinceIso)

  type Row = {
    team_id: string
    joined_at: string | null
    left_at: string | null
    team: unknown
  }
  const rows = (memberships ?? []) as Row[]
  if (rows.length === 0) return []

  const teamIds = rows.map((r) => r.team_id)
  const { data: interventions } = await admin
    .from('interventions')
    .select('assigned_team_id, scheduled_for')
    .in('assigned_team_id', teamIds)
    .gte('scheduled_for', sinceIso.slice(0, 10))
    .in('status', ['completed', 'validated'])

  const countByTeam = new Map<string, number>()
  for (const i of (interventions ?? []) as Array<{ assigned_team_id: string | null }>) {
    if (!i.assigned_team_id) continue
    countByTeam.set(i.assigned_team_id, (countByTeam.get(i.assigned_team_id) ?? 0) + 1)
  }

  const out: IntervenantTeamHistoryEntry[] = []
  for (const r of rows) {
    const team = pickOne(r.team) as {
      id?: string
      name?: string
      color?: string | null
      deleted_at?: string | null
    } | null
    if (!team?.id || !team.name) continue
    out.push({
      team_id: team.id,
      team_name: team.name,
      team_color: team.color ?? null,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
      isCurrent: r.left_at === null && team.deleted_at === null,
      interventionsCount: countByTeam.get(team.id) ?? 0,
    })
  }

  return out.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
    const ax = a.leftAt ?? a.joinedAt ?? ''
    const bx = b.leftAt ?? b.joinedAt ?? ''
    return bx.localeCompare(ax)
  })
}

/**
 * Liste des collègues ayant partagé une équipe avec l'intervenant sur N mois.
 *
 * Doctrine : data sensible (« qui travaille avec qui »). Reste factuel — pas
 * de score de proximité. Tri : présents-d'abord puis alpha.
 */
export async function listIntervenantCollaborators(
  intervenantId: string,
  monthsBack: number = 24,
): Promise<IntervenantCollaborator[]> {
  const admin = createAdminClient()
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - monthsBack)
  const sinceIso = since.toISOString()

  const { data: myMemberships } = await admin
    .from('team_members')
    .select('team_id, left_at, team:teams(name)')
    .eq('user_id', intervenantId)
    .or('left_at.is.null,left_at.gte.' + sinceIso)

  type MyRow = { team_id: string; left_at: string | null; team: unknown }
  const myRows = (myMemberships ?? []) as MyRow[]
  if (myRows.length === 0) return []

  const myCurrentTeamIds = new Set<string>(
    myRows.filter((r) => r.left_at === null).map((r) => r.team_id),
  )
  const teamNameById = new Map<string, string>()
  for (const r of myRows) {
    const t = pickOne(r.team) as { name?: string } | null
    if (t?.name) teamNameById.set(r.team_id, t.name)
  }
  const teamIds = Array.from(teamNameById.keys())

  const { data: others } = await admin
    .from('team_members')
    .select('user_id, team_id, left_at, user:users(id, full_name, email, deleted_at)')
    .in('team_id', teamIds)
    .neq('user_id', intervenantId)
    .or('left_at.is.null,left_at.gte.' + sinceIso)

  type OtherRow = {
    user_id: string
    team_id: string
    left_at: string | null
    user: unknown
  }
  const rows = (others ?? []) as OtherRow[]

  type Agg = {
    user_id: string
    full_name: string | null
    email: string
    teams: Set<string>
    currentSharedTeam: boolean
  }
  const byUser = new Map<string, Agg>()
  for (const r of rows) {
    const u = pickOne(r.user) as {
      id?: string
      full_name?: string | null
      email?: string
      deleted_at?: string | null
    } | null
    if (!u?.id || !u.email) continue
    if (u.deleted_at) continue
    const teamName = teamNameById.get(r.team_id)
    if (!teamName) continue

    const existing = byUser.get(u.id) ?? {
      user_id: u.id,
      full_name: u.full_name ?? null,
      email: u.email,
      teams: new Set<string>(),
      currentSharedTeam: false,
    }
    existing.teams.add(teamName)
    if (r.left_at === null && myCurrentTeamIds.has(r.team_id)) {
      existing.currentSharedTeam = true
    }
    byUser.set(u.id, existing)
  }

  return Array.from(byUser.values())
    .map<IntervenantCollaborator>((a) => ({
      user_id: a.user_id,
      full_name: a.full_name,
      email: a.email,
      sharedTeams: Array.from(a.teams).sort((x, y) =>
        x.localeCompare(y, 'fr', { sensitivity: 'base' }),
      ),
      currentlySharedTeam: a.currentSharedTeam,
    }))
    .sort((a, b) => {
      if (a.currentlySharedTeam !== b.currentlySharedTeam) {
        return a.currentlySharedTeam ? -1 : 1
      }
      const an = a.full_name ?? a.email
      const bn = b.full_name ?? b.email
      return an.localeCompare(bn, 'fr', { sensitivity: 'base' })
    })
}

/**
 * Rythme récent de l'intervenant — 14 jours par défaut.
 * Calé sur le modèle SiteRhythm (équivalent côté personne pour cohérence
 * visuelle avec /sites/[id]).
 */
export async function getIntervenantRecentRhythm(
  intervenantId: string,
  days: number = 14,
): Promise<IntervenantRhythmDay[]> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const since = new Date(today)
  since.setUTCDate(today.getUTCDate() - days + 1)
  const sinceIso = since.toISOString().slice(0, 10)
  const todayIso = today.toISOString().slice(0, 10)

  const participations = await fetchUserParticipations(intervenantId)
  // Regrouper par date
  const byDate = new Map<string, Array<{ mission: string; site: string }>>()
  for (const p of participations) {
    if (!p.scheduled_for) continue
    if (p.scheduled_for < sinceIso) continue
    const arr = byDate.get(p.scheduled_for) ?? []
    arr.push({ mission: p.mission_name, site: p.site_name })
    byDate.set(p.scheduled_for, arr)
  }

  const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
  const out: IntervenantRhythmDay[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(since)
    d.setUTCDate(since.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    const items = byDate.get(iso) ?? []
    out.push({
      date: iso,
      weekdayLabel: WEEKDAYS[dow] ?? '',
      dayMonthLabel: String(d.getUTCDate()),
      isToday: iso === todayIso,
      isWeekend: dow === 0 || dow === 6,
      count: items.length,
      tooltipLines: items.slice(0, 4).map((it) => `${it.mission} — ${it.site}`),
    })
  }
  return out
}

/**
 * Anomalies signalées sur des interventions où cet intervenant a participé.
 *
 * Doctrine : factuel — on liste les incidents auxquels la personne était
 * exposée. Distingue signalée PAR la personne vs juste présence.
 */
export async function listIntervenantIncidentsPresence(
  intervenantId: string,
  limit: number = 20,
): Promise<IntervenantIncidentPresence[]> {
  const participations = await fetchUserParticipations(intervenantId)
  if (participations.length === 0) return []
  const interventionIds = participations.map((p) => p.intervention_id)
  const interventionMeta = new Map(
    participations.map((p) => [
      p.intervention_id,
      { site_id: p.site_id, site_name: p.site_name, scheduled_for: p.scheduled_for },
    ]),
  )

  const admin = createAdminClient()
  const { data } = await admin
    .from('intervention_anomalies')
    .select('id, intervention_id, description, reported_by, created_at')
    .in('intervention_id', interventionIds)
    .order('created_at', { ascending: false })
    .limit(limit)

  type Row = {
    id: string
    intervention_id: string
    description: string | null
    reported_by: string | null
    created_at: string
  }

  const out: IntervenantIncidentPresence[] = []
  for (const r of (data ?? []) as Row[]) {
    const meta = interventionMeta.get(r.intervention_id)
    if (!meta?.site_id || !meta.site_name) continue
    out.push({
      anomaly_id: r.id,
      intervention_id: r.intervention_id,
      site_id: meta.site_id,
      site_name: meta.site_name,
      scheduled_for: meta.scheduled_for,
      description: r.description ?? '—',
      signaledBySelf: r.reported_by === intervenantId,
    })
  }
  return out
}
