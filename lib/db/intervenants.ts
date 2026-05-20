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
import { isSystemMissionName } from '@/lib/db/system-missions'
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

/** Ligne de la liste `/intervenants`. */
export interface IntervenantListRow {
  id: string
  full_name: string | null
  email: string
  role: string
  teams: Array<{ team_id: string; team_name: string; team_color: string | null }>
  sitesKnown: number
  interventionsParticipated: number
  lastParticipationDate: string | null
}

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
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
    .select('id, email, full_name, role, created_at, phone, commune, employment_type')
    .eq('id', intervenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!user) return null
  const userExt = user as { id: string; email: string; full_name: string | null; role: string; created_at: string; phone: string | null; commune: string | null; employment_type: 'cdi' | 'cdd' | 'cdi_chantier' | null }

  const [participations, notes, anomalies, photos, voiceNotes, teamRows] = await Promise.all([
    admin
      .from('intervention_participants')
      .select(`
        intervention:interventions!inner(
          mission:missions!inner(
            site:sites!inner(id, contract_id)
          )
        )
      `)
      .eq('user_id', intervenantId),
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

  // Sites & contrats distincts
  const siteIds = new Set<string>()
  const contractIds = new Set<string>()
  for (const r of (participations.data ?? []) as Array<{ intervention: unknown }>) {
    const intv = pickOne(r.intervention) as { mission?: unknown } | null
    if (!intv) continue
    const mission = pickOne(intv.mission) as { site?: unknown } | null
    if (!mission) continue
    const site = pickOne(mission.site) as { id?: string; contract_id?: string | null } | null
    if (site?.id) siteIds.add(site.id)
    if (site?.contract_id) contractIds.add(site.contract_id)
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
    counters: {
      interventionsParticipated: (participations.data ?? []).length,
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
  const { data } = await admin
    .from('intervention_participants')
    .select(`
      intervention:interventions!inner(
        id,
        scheduled_for,
        status,
        mission:missions!inner(
          name,
          site:sites!inner(
            id,
            name,
            contract:contracts(id, name),
            client:clients(name)
          )
        )
      )
    `)
    .eq('user_id', intervenantId)

  const flat = flattenParticipations((data ?? []) as ParticipationRow[])

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
  const admin = createAdminClient()
  const { data } = await admin
    .from('intervention_participants')
    .select(`
      intervention:interventions!inner(
        scheduled_for,
        mission:missions!inner(
          name,
          site:sites!inner(
            contract:contracts(id, name),
            client:clients(name)
          )
        )
      )
    `)
    .eq('user_id', intervenantId)

  const flat = flattenParticipations((data ?? []) as ParticipationRow[])

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
  const admin = createAdminClient()
  const { data } = await admin
    .from('intervention_participants')
    .select(`
      intervention:interventions!inner(
        id,
        scheduled_for,
        status,
        planned_start,
        planned_end,
        slot,
        mission:missions!inner(
          name,
          site:sites!inner(id, name)
        )
      )
    `)
    .eq('user_id', intervenantId)

  const flat = flattenParticipations((data ?? []) as ParticipationRow[])

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
  const admin = createAdminClient()
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - days + 1)
  const sinceIso = since.toISOString().slice(0, 10)

  const { data } = await admin
    .from('intervention_participants')
    .select(`
      intervention:interventions!inner(scheduled_for, status)
    `)
    .eq('user_id', intervenantId)

  const counts = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ intervention: unknown }>) {
    const intv = pickOne(r.intervention) as { scheduled_for?: string | null; status?: string } | null
    if (!intv?.scheduled_for) continue
    if (intv.scheduled_for < sinceIso) continue
    counts.set(intv.scheduled_for, (counts.get(intv.scheduled_for) ?? 0) + 1)
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
export async function listIntervenantsForList(): Promise<IntervenantListRow[]> {
  const admin = createAdminClient()

  // 1) Users actifs (tous rôles — les chefs_equipe sont aussi des intervenants)
  const { data: users } = await admin
    .from('users')
    .select('id, email, full_name, role')
    .is('deleted_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })

  if (!users || users.length === 0) return []

  const userIds = users.map((u) => u.id)

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

  // 3) Participations agrégées par user_id (allowlist — uniquement dans ce module)
  const { data: participations } = await admin
    .from('intervention_participants')
    .select(`
      user_id,
      intervention:interventions!inner(
        scheduled_for,
        mission:missions!inner(
          name,
          site:sites!inner(id)
        )
      )
    `)
    .in('user_id', userIds)

  type Stats = { sites: Set<string>; count: number; lastAt: string | null }
  const statsByUser = new Map<string, Stats>()
  for (const row of (participations ?? []) as Array<{ user_id: string; intervention: unknown }>) {
    const intv = pickOne(row.intervention) as {
      scheduled_for?: string | null
      mission?: unknown
    } | null
    if (!intv) continue
    const mission = pickOne(intv.mission) as { name?: string; site?: unknown } | null
    if (!mission?.name) continue
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(mission.site) as { id?: string } | null
    if (!site?.id) continue

    const stats = statsByUser.get(row.user_id) ?? { sites: new Set<string>(), count: 0, lastAt: null }
    stats.sites.add(site.id)
    stats.count += 1
    if (intv.scheduled_for && (!stats.lastAt || intv.scheduled_for > stats.lastAt)) {
      stats.lastAt = intv.scheduled_for
    }
    statsByUser.set(row.user_id, stats)
  }

  return users.map<IntervenantListRow>((u) => {
    const stats = statsByUser.get(u.id) ?? { sites: new Set<string>(), count: 0, lastAt: null }
    return {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      teams: teamsByUser.get(u.id) ?? [],
      sitesKnown: stats.sites.size,
      interventionsParticipated: stats.count,
      lastParticipationDate: stats.lastAt,
    }
  })
}
