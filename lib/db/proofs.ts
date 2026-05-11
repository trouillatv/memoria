// Slice B.0 — Dossier de preuves : helper de recherche transversal.
//
// Doctrine impérative :
//   - Wedge émotionnel : <30s entre « j'ai pas la preuve » et « la voilà ».
//     Donc requête optimisée pour le retour rapide (objectif <500ms).
//   - Anonymisation par défaut : on ne retourne JAMAIS d'identifiants d'agents.
//     `team[]` reste interne à la DB, hors de cette surface.
//   - Sobriété calme : aucun champ de score, de performance, de jugement.
//     Uniquement des FAITS : compteurs photos / anomalies / validations.
//   - Ordre antichronologique : le DG regarde « la dernière intervention sur
//     ce site », pas « la première de 2022 ». Le plus récent en haut, point.
//
// Stratégie technique :
//   1) Resolve siteIds matchant le filtre site OU le mot-clé (sur site.name) ;
//      si filtre site exact présent, on ne mappe que celui-là.
//   2) Resolve missionIds via sites (filtre site + recherche site.name).
//   3) Query interventions avec un select join missions→sites→contracts.
//      Filtre OR sur mission.name OR site.name (résolu côté code en pré-set
//      de mission_ids) — PostgREST ne supporte pas le OR cross-table fluide.
//   4) Compute counts photos/anomalies/validations groupés par intervention_id
//      via deux requêtes séparées (group by) puis map côté code.
//
// On garde la logique en TS simple et lisible, quitte à faire 4 requêtes au
// lieu d'1 SQL exotique. C'est plus testable et reste très rapide tant que
// le résultat tient en quelques centaines de lignes.

import { createAdminClient } from '@/lib/supabase/admin'

// ----------------------------------------------------------------------------
// Types publics
// ----------------------------------------------------------------------------

export interface ProofSearchInput {
  /** Mot-clé matché sur mission.name OU site.name (ILIKE, anchored par %). */
  search?: string
  /** Filtre site exact (UUID). */
  siteId?: string
  /** Borne basse inclusive (yyyy-mm-dd). Comparée à COALESCE(scheduled_for,
   * scheduled_at::date, executed_at::date). */
  dateFrom?: string
  /** Borne haute inclusive (yyyy-mm-dd). */
  dateTo?: string
  /** Filtre status intervention (planned | in_progress | completed | validated | skipped). */
  status?: string
  /** Pagination offset (0-based). */
  offset?: number
  /** Pagination limit (default 50, max 200). */
  limit?: number
}

export interface ProofIntervention {
  id: string
  /** Titre affichable : mission.name (fallback "Intervention"). */
  title: string
  /** Date logique (yyyy-mm-dd) si disponible. */
  scheduled_for: string | null
  /** Horodatage planifié (timestamptz). */
  scheduled_at: string
  /** Horodatage exécuté (timestamptz) si présent. */
  executed_at: string | null
  status: string
  skipped_at: string | null
  skipped_reason: string | null
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
  photosCount: number
  anomaliesCount: number
  anomaliesResolvedCount: number
  validationsCount: number
}

export interface ProofSearchResult {
  items: ProofIntervention[]
  total: number
}

// ----------------------------------------------------------------------------
// Helper principal
// ----------------------------------------------------------------------------

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function searchProofs(input: ProofSearchInput = {}): Promise<ProofSearchResult> {
  const supabase = createAdminClient()
  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT))

  // ---- 1. Pré-résolution des mission_ids candidats si filtre site ou recherche
  //         qui peut matcher sur site.name.
  // Approche : on calcule un set d'ids missions par croisement des filtres.
  // - Si siteId fourni → set missions sur ce site (et recherche éventuelle sur mission.name).
  // - Si search fourni sans siteId → set missions dont (site.name ILIKE %s%) UNION missions
  //   dont (name ILIKE %s%).
  // - Si ni siteId ni search → pas de pré-filtrage missions (NULL = pas de restriction).

  const escaped = input.search ? escapeIlike(input.search) : null

  let candidateMissionIds: string[] | null = null

  if (input.siteId) {
    // Bound to that site, optional name match.
    let q = supabase
      .from('missions')
      .select('id, name, site_id')
      .eq('site_id', input.siteId)
      .is('deleted_at', null)
    if (escaped) q = q.ilike('name', `%${escaped}%`)
    const { data, error } = await q
    if (error) throw error
    candidateMissionIds = (data ?? []).map((m) => m.id)
    if (escaped) {
      // Un site dont le nom match peut aussi compter — mais on est borné à siteId, donc
      // si le site lui-même match, on prend toutes ses missions.
      const { data: site, error: sErr } = await supabase
        .from('sites')
        .select('id, name')
        .eq('id', input.siteId)
        .is('deleted_at', null)
        .maybeSingle()
      if (sErr) throw sErr
      if (site && site.name.toLowerCase().includes(input.search!.toLowerCase())) {
        const { data: allMissions, error: amErr } = await supabase
          .from('missions')
          .select('id')
          .eq('site_id', input.siteId)
          .is('deleted_at', null)
        if (amErr) throw amErr
        const ids = (allMissions ?? []).map((m) => m.id)
        candidateMissionIds = Array.from(new Set([...(candidateMissionIds ?? []), ...ids]))
      }
    }
    if (candidateMissionIds.length === 0) return { items: [], total: 0 }
  } else if (escaped) {
    // Sans siteId, mais recherche → résoudre via missions ET sites.
    const [missionsRes, sitesRes] = await Promise.all([
      supabase
        .from('missions')
        .select('id')
        .ilike('name', `%${escaped}%`)
        .is('deleted_at', null),
      supabase
        .from('sites')
        .select('id')
        .ilike('name', `%${escaped}%`)
        .is('deleted_at', null),
    ])
    if (missionsRes.error) throw missionsRes.error
    if (sitesRes.error) throw sitesRes.error
    const fromMissionName = (missionsRes.data ?? []).map((m) => m.id)
    const siteIds = (sitesRes.data ?? []).map((s) => s.id)
    let fromSiteName: string[] = []
    if (siteIds.length > 0) {
      const { data, error } = await supabase
        .from('missions')
        .select('id')
        .in('site_id', siteIds)
        .is('deleted_at', null)
      if (error) throw error
      fromSiteName = (data ?? []).map((m) => m.id)
    }
    candidateMissionIds = Array.from(new Set([...fromMissionName, ...fromSiteName]))
    if (candidateMissionIds.length === 0) return { items: [], total: 0 }
  }

  // ---- 2. Query interventions filtrées + select join missions/sites/contracts.
  let q = supabase
    .from('interventions')
    .select(
      `
      id,
      mission_id,
      scheduled_at,
      scheduled_for,
      executed_at,
      status,
      skipped_at,
      skipped_reason,
      mission:missions!inner(
        id,
        name,
        site:sites!inner(
          id,
          name,
          contract:contracts(id, name, client_name)
        )
      )
    `,
      { count: 'exact' },
    )
    // Ordre : antichronologique sur scheduled_at (timestamptz, toujours non nul).
    // Note : on aurait aimé COALESCE(executed_at, scheduled_at) DESC, mais
    // PostgREST ne le supporte pas natif. scheduled_at est très proche en pratique,
    // et c'est cohérent (la planification c'est l'événement, l'exécution suit).
    .order('scheduled_at', { ascending: false })

  if (candidateMissionIds) {
    q = q.in('mission_id', candidateMissionIds)
  }
  if (input.status) {
    q = q.eq('status', input.status)
  }
  if (input.dateFrom) {
    const fromIso = `${input.dateFrom}T00:00:00.000Z`
    q = q.gte('scheduled_at', fromIso)
  }
  if (input.dateTo) {
    // Inclusif : on étend au lendemain à minuit exclu.
    const dayAfter = addDaysIso(input.dateTo, 1)
    q = q.lt('scheduled_at', `${dayAfter}T00:00:00.000Z`)
  }

  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error

  type RawJoin = {
    id: string
    mission_id: string
    scheduled_at: string
    scheduled_for: string | null
    executed_at: string | null
    status: string
    skipped_at: string | null
    skipped_reason: string | null
    mission?: unknown
  }
  const raw = (data ?? []) as unknown as RawJoin[]

  if (raw.length === 0) return { items: [], total: count ?? 0 }

  const interventionIds = raw.map((r) => r.id)

  // ---- 3. Compteurs photos / anomalies / validations groupés.
  // PostgREST ne fait pas de COUNT GROUP BY natif. On récupère les rows minimales
  // et on compte côté code. Volume borné par `limit` (50 par défaut) * #photos
  // ≈ quelques centaines de rows max. OK.
  const [photosRes, anomaliesRes, validationsRes] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', interventionIds),
    supabase
      .from('intervention_anomalies')
      .select('intervention_id, status')
      .in('intervention_id', interventionIds),
    supabase
      .from('intervention_validations')
      .select('intervention_id')
      .in('intervention_id', interventionIds),
  ])
  if (photosRes.error) throw photosRes.error
  if (anomaliesRes.error) throw anomaliesRes.error
  if (validationsRes.error) throw validationsRes.error

  const photosByInt = new Map<string, number>()
  for (const p of photosRes.data ?? []) {
    const k = (p as { intervention_id: string }).intervention_id
    photosByInt.set(k, (photosByInt.get(k) ?? 0) + 1)
  }
  const anomaliesByInt = new Map<string, { total: number; resolved: number }>()
  for (const a of anomaliesRes.data ?? []) {
    const row = a as { intervention_id: string; status: string }
    const cur = anomaliesByInt.get(row.intervention_id) ?? { total: 0, resolved: 0 }
    cur.total += 1
    if (row.status === 'resolved') cur.resolved += 1
    anomaliesByInt.set(row.intervention_id, cur)
  }
  const validationsByInt = new Map<string, number>()
  for (const v of validationsRes.data ?? []) {
    const k = (v as { intervention_id: string }).intervention_id
    validationsByInt.set(k, (validationsByInt.get(k) ?? 0) + 1)
  }

  // ---- 4. Map raw rows → ProofIntervention.
  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const items: ProofIntervention[] = raw.map((r) => {
    const missionRaw = pickOne<{
      id: string
      name: string
      site?: unknown
    }>(r.mission)
    const siteRaw = missionRaw
      ? pickOne<{ id: string; name: string; contract?: unknown }>(missionRaw.site)
      : null
    const contractRaw = siteRaw
      ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract)
      : null
    const anomalies = anomaliesByInt.get(r.id) ?? { total: 0, resolved: 0 }
    return {
      id: r.id,
      title: missionRaw?.name ?? 'Intervention',
      scheduled_for: r.scheduled_for,
      scheduled_at: r.scheduled_at,
      executed_at: r.executed_at,
      status: r.status,
      skipped_at: r.skipped_at,
      skipped_reason: r.skipped_reason,
      mission_id: r.mission_id,
      mission_name: missionRaw?.name ?? '',
      site_id: siteRaw?.id ?? '',
      site_name: siteRaw?.name ?? '',
      contract_id: contractRaw?.id ?? null,
      contract_name: contractRaw?.name ?? null,
      client_name: contractRaw?.client_name ?? null,
      photosCount: photosByInt.get(r.id) ?? 0,
      anomaliesCount: anomalies.total,
      anomaliesResolvedCount: anomalies.resolved,
      validationsCount: validationsByInt.get(r.id) ?? 0,
    }
  })

  return { items, total: count ?? 0 }
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

function escapeIlike(input: string): string {
  // Échappe les caractères qui ont une signification SQL ILIKE.
  return input.replace(/[%_\\]/g, (m) => `\\${m}`)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
