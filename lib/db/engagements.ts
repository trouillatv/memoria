import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type {
  DbEngagement,
  EngagementCategory,
  EngagementDestination,
  EngagementEvidence,
  EngagementSourceType,
  EngagementStatus,
} from '@/types/db'
import { suggestDestination } from '@/lib/engagements/destination'

export async function listEngagementsByTender(tenderId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listEngagementsByContract(contractId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('contract_id', contractId)
    .in('status', ['active', 'completed'])
    .order('category')
  if (error) throw error
  return data ?? []
}

export async function listAllEngagements(): Promise<DbEngagement[]> {
  // Used by debug page only
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('engagements').select('*').order('created_at', { ascending: false }).limit(200)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/** Counts active+completed engagements per contract — single query, no N+1. */
export async function countEngagementsByContracts(
  contractIds: string[]
): Promise<Map<string, number>> {
  if (contractIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('contract_id')
    .in('contract_id', contractIds)
    .in('status', ['active', 'completed'])
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (!row.contract_id) continue
    counts.set(row.contract_id, (counts.get(row.contract_id) ?? 0) + 1)
  }
  return counts
}

export async function bulkInsertEngagements(input: {
  tender_id: string
  created_by: string | null
  engagements: Array<{
    source_type: EngagementSourceType
    source_excerpt: string
    source_ref: Record<string, unknown> | null
    category: EngagementCategory
    short_label: string
    measurable: boolean
    ai_confidence: number | null
  }>
}): Promise<DbEngagement[]> {
  if (input.engagements.length === 0) return []
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const rows = input.engagements.map((e) => ({
    tender_id: input.tender_id,
    created_by: input.created_by,
    status: 'extracted' as EngagementStatus,
    source_type: e.source_type,
    source_excerpt: e.source_excerpt,
    source_ref: e.source_ref,
    category: e.category,
    short_label: e.short_label,
    measurable: e.measurable,
    ai_confidence: e.ai_confidence,
    // Destination SUGGÉRÉE (déterministe, explicable) — l'humain valide à la
    // curation. Défaut = obligation de contrat.
    destination: suggestDestination({
      category: e.category,
      sourceExcerpt: e.source_excerpt,
      shortLabel: e.short_label,
    }).destination,
    ...(orgId ? { organization_id: orgId } : {}),
  }))
  const { data, error } = await supabase.from('engagements').insert(rows).select('*')
  if (error) throw error
  return data ?? []
}

export async function curateEngagement(
  id: string,
  patch: {
    short_label?: string
    category?: EngagementCategory
    measurable?: boolean
    proof_requirement?: 'photo' | 'anomaly_documented' | 'none'
    destination?: EngagementDestination
  }
): Promise<void> {
  const supabase = createAdminClient()

  // Fetch current status to decide whether to advance it or keep it.
  const { data: current, error: fetchErr } = await supabase
    .from('engagements')
    .select('status')
    .eq('id', id)
    .in('status', ['extracted', 'curated', 'active'])
    .maybeSingle()
  if (fetchErr) throw fetchErr
  if (!current) throw new Error('Engagement introuvable ou non modifiable')

  const nextStatus: EngagementStatus = current.status === 'extracted' ? 'curated' : current.status as EngagementStatus
  const updates: Record<string, unknown> = { status: nextStatus }
  if (patch.short_label !== undefined) updates.short_label = patch.short_label
  if (patch.category !== undefined) updates.category = patch.category
  if (patch.measurable !== undefined) updates.measurable = patch.measurable
  if (patch.proof_requirement !== undefined) updates.proof_requirement = patch.proof_requirement
  if (patch.destination !== undefined) updates.destination = patch.destination

  const { error } = await supabase
    .from('engagements')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function createEngagementManual(input: {
  tender_id?: string | null
  contract_id?: string | null
  short_label: string
  category: EngagementCategory
  created_by: string | null
}): Promise<DbEngagement> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  // status is 'active' when directly linked to a contract, otherwise 'extracted'
  const status: EngagementStatus = input.contract_id ? 'active' : 'extracted'
  const { data, error } = await supabase
    .from('engagements')
    .insert({
      tender_id: input.tender_id ?? null,
      contract_id: input.contract_id ?? null,
      source_type: 'manual' as EngagementSourceType,
      source_excerpt: input.short_label,
      source_ref: null,
      category: input.category,
      short_label: input.short_label,
      measurable: false,
      ai_confidence: null,
      status,
      created_by: input.created_by,
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function rejectEngagements(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('engagements')
    .delete()
    .in('id', ids)
    .eq('status', 'extracted')
  if (error) throw error
}

export async function activateEngagementsForContract(
  tenderId: string,
  contractId: string
): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .update({ contract_id: contractId, status: 'active' as EngagementStatus })
    .eq('tender_id', tenderId)
    .in('status', ['extracted', 'curated'])
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

export async function archiveEngagement(id: string, reason?: string): Promise<void> {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = { status: 'archived' as EngagementStatus }
  if (reason) {
    updates.source_ref = { archived_reason: reason, archived_at: new Date().toISOString() }
  }
  const { error } = await supabase
    .from('engagements')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

/** Vérifie si un engagement a au moins une intervention in_progress/completed/validated liée. */
export async function hasLinkedInterventions(engagementId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .contains('engagement_ids', [engagementId])
    .is('deleted_at', null)
  if (!missions || missions.length === 0) return false
  const { count } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('mission_id', missions.map((m) => m.id))
    .in('status', ['in_progress', 'completed', 'validated'])
  return (count ?? 0) > 0
}

// ============================================================================
// Cross-tender matching — Phase 4 (pg_trgm similarity)
// ============================================================================

export interface SimilarEngagementMatch {
  engagement: DbEngagement
  similarity: number // 0-1, higher = more similar
}

/**
 * Find past engagements (active or completed) whose source_excerpt or short_label
 * is similar to the input query text.
 *
 * Uses Postgres pg_trgm trigram similarity via the `find_similar_engagements`
 * RPC function (cf. migration 020). Threshold 0.3 by default = moderate match.
 *
 * If `excludeTenderId` is provided, engagements from that tender are filtered
 * out — used when a Resp. AO writes a new tender response and we don't want to
 * match the current tender's own engagements.
 *
 * Engagements with status extracted/curated/archived are NEVER returned : only
 * active/completed past engagements count as "preuves".
 *
 * Returns at most `limit` matches, sorted by similarity descending.
 */
export async function findSimilarEngagements(input: {
  query: string
  excludeTenderId?: string | null
  threshold?: number
  limit?: number
}): Promise<SimilarEngagementMatch[]> {
  const query = input.query.trim()
  if (query.length < 10) return [] // too short to match meaningfully

  const threshold = input.threshold ?? 0.3
  const limit = input.limit ?? 10
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('find_similar_engagements', {
    p_query: query,
    p_threshold: threshold,
    p_limit: limit,
    p_exclude_tender_id: input.excludeTenderId ?? null,
  })
  if (error) throw error
  if (!data) return []

  type RpcRow = DbEngagement & { similarity: number }
  return (data as RpcRow[]).map((row) => {
    const { similarity, ...engagement } = row
    return { engagement: engagement as DbEngagement, similarity }
  })
}

/**
 * Découpe un mémoire technique long en chunks sémantiques (paragraphes /
 * sections markdown) et lance findSimilarEngagements() sur chacun. Aggrège les
 * résultats en gardant la **similarité MAX** par engagement.
 *
 * Justification : pg_trgm.similarity() est sensible à la longueur. Un mémoire
 * de 3000 chars renvoie 0 match au threshold 0.25, alors qu'un paragraphe de
 * 80-150 chars dépasse facilement 0.5. Le chunking est la stratégie qui
 * préserve la sémantique du panneau (un seul matchThreshold côté UI).
 */
export async function findSimilarEngagementsForMemo(input: {
  memo: string
  excludeTenderId?: string | null
  threshold?: number
  limit?: number
}): Promise<SimilarEngagementMatch[]> {
  const memo = (input.memo ?? '').trim()
  if (memo.length < 10) return []

  const threshold = input.threshold ?? 0.3
  const limit = input.limit ?? 10

  // Split on markdown headings + blank lines, then by sentences. Trim empties.
  const rough = memo
    .split(/\n{2,}|(?=^#{1,6}\s)/m)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)

  const chunks: string[] = []
  for (const block of rough) {
    if (block.length <= 220) {
      chunks.push(block)
      continue
    }
    // Long block → split by sentence (FR-friendly : « . », « ! », « ? »
    // followed by whitespace). Keep chunks 40-220 chars.
    const sentences = block.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
    for (const s of sentences) {
      if (s.length >= 30 && s.length <= 260) chunks.push(s)
      else if (s.length > 260) {
        // Fallback : hard cut every 200 chars
        for (let i = 0; i < s.length; i += 200) chunks.push(s.slice(i, i + 200))
      }
    }
  }

  // Cap : avoid pathological N queries on huge memos.
  const MAX_CHUNKS = 30
  const queryChunks = chunks.slice(0, MAX_CHUNKS)
  if (queryChunks.length === 0) return []

  // Run all chunk queries in parallel — small overlap, max latency = single RPC.
  const results = await Promise.all(
    queryChunks.map((chunk) =>
      findSimilarEngagements({
        query: chunk,
        excludeTenderId: input.excludeTenderId,
        threshold,
        limit, // each chunk may surface up to `limit` matches
      })
    )
  )

  // Aggregate : keep max similarity per engagement_id
  const bestByEngagement = new Map<string, SimilarEngagementMatch>()
  for (const matchList of results) {
    for (const m of matchList) {
      const prev = bestByEngagement.get(m.engagement.id)
      if (!prev || m.similarity > prev.similarity) {
        bestByEngagement.set(m.engagement.id, m)
      }
    }
  }

  return Array.from(bestByEngagement.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

// ============================================================================
// Evidence aggregator — Phase 4 Slice 4.1
// ============================================================================

const COMPLETED_STATUSES = ['completed', 'validated'] as const

/**
 * Compute evidence stats for a single engagement.
 *
 * Returns counts (interventions executed, photos, anomalies, validations) and
 * temporal context (first/last executed dates).
 *
 * Wording doctrine : these are aggregate facts per engagement — NEVER converted
 * to individual scores or RH dashboards (cf. planning-doctrine.md §5).
 */
export async function getEvidenceForEngagement(engagementId: string): Promise<EngagementEvidence> {
  const supabase = createAdminClient()

  // 1) Get the engagement + linked contract
  const { data: engagement, error: engErr } = await supabase
    .from('engagements')
    .select('id, contract_id, status')
    .eq('id', engagementId)
    .maybeSingle()
  if (engErr) throw engErr
  if (!engagement) {
    return emptyEvidence(engagementId)
  }

  // 2) Find missions covering this engagement
  const { data: missions, error: missionsErr } = await supabase
    .from('missions')
    .select('id, site_id')
    .contains('engagement_ids', [engagementId])
    .is('deleted_at', null)
  if (missionsErr) throw missionsErr
  if (!missions || missions.length === 0) {
    return emptyEvidence(engagementId)
  }
  const missionIds = missions.map((m) => m.id)

  // 3) Get interventions for these missions (single query)
  const { data: interventions, error: intvErr } = await supabase
    .from('interventions')
    .select('id, status, executed_at, mission_id')
    .in('mission_id', missionIds)
  if (intvErr) throw intvErr
  const allInterventions = interventions ?? []
  const executedInterventions = allInterventions.filter((i) =>
    COMPLETED_STATUSES.includes(i.status as 'completed' | 'validated')
  )
  const validatedInterventions = allInterventions.filter((i) => i.status === 'validated')

  // 4) Get photos count + anomalies counts in parallel
  const interventionIds = executedInterventions.map((i) => i.id)
  const [photosResult, anomaliesResult, contractsResult] = await Promise.all([
    interventionIds.length === 0
      ? Promise.resolve({ count: 0 })
      : supabase
          .from('intervention_photos')
          .select('id', { count: 'exact', head: true })
          .in('intervention_id', interventionIds),
    interventionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ status: string }> })
      : supabase
          .from('intervention_anomalies')
          .select('status')
          .in('intervention_id', interventionIds),
    // Get contract names — through missions.site_id → sites.contract_id → contracts.name
    (async () => {
      const siteIds = Array.from(new Set(missions.map((m) => m.site_id)))
      if (siteIds.length === 0) return { data: [] as Array<{ name: string; id: string }> }
      const { data: sites } = await supabase
        .from('sites')
        .select('contract_id')
        .in('id', siteIds)
        .is('deleted_at', null)
      const contractIds = Array.from(
        new Set((sites ?? []).map((s) => s.contract_id).filter((id): id is string => !!id))
      )
      if (contractIds.length === 0) return { data: [] as Array<{ name: string; id: string }> }
      const { data: contracts } = await supabase
        .from('contracts')
        .select('id, name')
        .in('id', contractIds)
        .is('deleted_at', null)
      return { data: contracts ?? [] }
    })(),
  ])

  const photosCount = photosResult.count ?? 0
  const anomaliesAll = anomaliesResult.data ?? []
  const anomaliesResolved = anomaliesAll.filter((a) => a.status === 'resolved').length
  const anomaliesOpen = anomaliesAll.filter((a) => a.status === 'open').length

  // 5) Compute temporal context
  const executedDates = executedInterventions
    .map((i) => i.executed_at)
    .filter((d): d is string => !!d)
    .sort()
  const firstExecutedAt = executedDates[0] ?? null
  const lastExecutedAt = executedDates[executedDates.length - 1] ?? null
  let durationDays: number | null = null
  if (firstExecutedAt && lastExecutedAt) {
    const diffMs = new Date(lastExecutedAt).getTime() - new Date(firstExecutedAt).getTime()
    durationDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
  }

  // 6) Validation rate (aggregate, not per-person)
  const validationRate = executedInterventions.length > 0
    ? validatedInterventions.length / executedInterventions.length
    : 0

  const contracts = contractsResult.data ?? []
  return {
    engagement_id: engagementId,
    interventionsExecuted: executedInterventions.length,
    photosCount,
    anomaliesResolved,
    anomaliesOpen,
    validationsCount: validatedInterventions.length,
    firstExecutedAt,
    lastExecutedAt,
    durationDays,
    validationRate,
    contractIds: contracts.map((c) => c.id),
    contractNames: contracts.map((c) => c.name),
  }
}

function emptyEvidence(engagementId: string): EngagementEvidence {
  return {
    engagement_id: engagementId,
    interventionsExecuted: 0,
    photosCount: 0,
    anomaliesResolved: 0,
    anomaliesOpen: 0,
    validationsCount: 0,
    firstExecutedAt: null,
    lastExecutedAt: null,
    durationDays: null,
    validationRate: 0,
    contractIds: [],
    contractNames: [],
  }
}

/**
 * Batch version : compute evidence for N engagements with minimal queries.
 *
 * Used by the cross-tender matching UI : when 5 similar engagements are detected,
 * we want their evidence in 1-2 queries instead of N × getEvidenceForEngagement.
 *
 * Strategy : fetch all missions covering any of these engagements, all interventions
 * for these missions, all photos/anomalies/contracts in parallel — then group
 * client-side.
 */
export async function getEvidenceForEngagements(
  engagementIds: string[]
): Promise<Map<string, EngagementEvidence>> {
  const result = new Map<string, EngagementEvidence>()
  if (engagementIds.length === 0) return result

  // Initialize each engagement with empty evidence (will be filled below)
  for (const id of engagementIds) result.set(id, emptyEvidence(id))

  const supabase = createAdminClient()

  // 1) Fetch all missions covering any of these engagements (single query with overlaps)
  const { data: missions } = await supabase
    .from('missions')
    .select('id, site_id, engagement_ids')
    .overlaps('engagement_ids', engagementIds)
    .is('deleted_at', null)
  const allMissions = missions ?? []
  if (allMissions.length === 0) return result

  // Build mission_id → engagement_ids[] map (filtered to only our queried IDs)
  const missionToEngagements = new Map<string, string[]>()
  for (const m of allMissions) {
    const overlap = (m.engagement_ids as string[]).filter((eid) => engagementIds.includes(eid))
    missionToEngagements.set(m.id, overlap)
  }

  // 2) Fetch all interventions for these missions
  const missionIds = allMissions.map((m) => m.id)
  const { data: interventions } = await supabase
    .from('interventions')
    .select('id, status, executed_at, mission_id')
    .in('mission_id', missionIds)
  const allInterventions = interventions ?? []
  const executedInterventions = allInterventions.filter((i) =>
    COMPLETED_STATUSES.includes(i.status as 'completed' | 'validated')
  )
  const executedInterventionIds = executedInterventions.map((i) => i.id)

  // 3) Fetch all photos + anomalies + contracts in parallel
  const [photosResult, anomaliesResult, contractsResult] = await Promise.all([
    executedInterventionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ intervention_id: string }> })
      : supabase
          .from('intervention_photos')
          .select('intervention_id')
          .in('intervention_id', executedInterventionIds),
    executedInterventionIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ intervention_id: string; status: string }> })
      : supabase
          .from('intervention_anomalies')
          .select('intervention_id, status')
          .in('intervention_id', executedInterventionIds),
    (async () => {
      const siteIds = Array.from(new Set(allMissions.map((m) => m.site_id)))
      if (siteIds.length === 0) return new Map<string, { contractId: string; contractName: string }>()
      const { data: sites } = await supabase
        .from('sites')
        .select('id, contract_id')
        .in('id', siteIds)
        .is('deleted_at', null)
      const siteToContract = new Map<string, string>()
      const contractIds = new Set<string>()
      for (const s of sites ?? []) {
        if (s.contract_id) {
          siteToContract.set(s.id, s.contract_id)
          contractIds.add(s.contract_id)
        }
      }
      if (contractIds.size === 0) return new Map<string, { contractId: string; contractName: string }>()
      const { data: contracts } = await supabase
        .from('contracts')
        .select('id, name')
        .in('id', Array.from(contractIds))
        .is('deleted_at', null)
      const contractById = new Map((contracts ?? []).map((c) => [c.id, c.name]))
      // Build site → { contractId, contractName } map
      const out = new Map<string, { contractId: string; contractName: string }>()
      for (const [siteId, contractId] of siteToContract.entries()) {
        const name = contractById.get(contractId)
        if (name) out.set(siteId, { contractId, contractName: name })
      }
      return out
    })(),
  ])

  const photosByIntervention = new Map<string, number>()
  for (const p of photosResult.data ?? []) {
    photosByIntervention.set(p.intervention_id, (photosByIntervention.get(p.intervention_id) ?? 0) + 1)
  }
  const anomaliesByIntervention = new Map<string, { resolved: number; open: number }>()
  for (const a of anomaliesResult.data ?? []) {
    const current = anomaliesByIntervention.get(a.intervention_id) ?? { resolved: 0, open: 0 }
    if (a.status === 'resolved') current.resolved += 1
    else if (a.status === 'open') current.open += 1
    anomaliesByIntervention.set(a.intervention_id, current)
  }
  const siteToContract = contractsResult as Map<string, { contractId: string; contractName: string }>

  // 4) Per-engagement aggregation
  for (const engagementId of engagementIds) {
    const relevantMissionIds = allMissions
      .filter((m) => missionToEngagements.get(m.id)?.includes(engagementId))
      .map((m) => m.id)
    if (relevantMissionIds.length === 0) continue

    const relevantInterventions = executedInterventions.filter((i) => relevantMissionIds.includes(i.mission_id))
    const interventionsExecuted = relevantInterventions.length
    const validatedCount = relevantInterventions.filter((i) => i.status === 'validated').length

    let photosCount = 0
    let anomaliesResolved = 0
    let anomaliesOpen = 0
    for (const intv of relevantInterventions) {
      photosCount += photosByIntervention.get(intv.id) ?? 0
      const anom = anomaliesByIntervention.get(intv.id)
      if (anom) {
        anomaliesResolved += anom.resolved
        anomaliesOpen += anom.open
      }
    }

    const executedDates = relevantInterventions
      .map((i) => i.executed_at)
      .filter((d): d is string => !!d)
      .sort()
    const firstExecutedAt = executedDates[0] ?? null
    const lastExecutedAt = executedDates[executedDates.length - 1] ?? null
    let durationDays: number | null = null
    if (firstExecutedAt && lastExecutedAt) {
      const diffMs = new Date(lastExecutedAt).getTime() - new Date(firstExecutedAt).getTime()
      durationDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))
    }

    const validationRate = interventionsExecuted > 0 ? validatedCount / interventionsExecuted : 0

    // Contracts : derived from missions.site_id → sites.contract_id
    const relevantSiteIds = allMissions
      .filter((m) => relevantMissionIds.includes(m.id))
      .map((m) => m.site_id)
    const contractMap = new Map<string, string>()
    for (const sid of relevantSiteIds) {
      const info = siteToContract.get(sid)
      if (info) contractMap.set(info.contractId, info.contractName)
    }
    const contractIds = Array.from(contractMap.keys())
    const contractNames = Array.from(contractMap.values())

    result.set(engagementId, {
      engagement_id: engagementId,
      interventionsExecuted,
      photosCount,
      anomaliesResolved,
      anomaliesOpen,
      validationsCount: validatedCount,
      firstExecutedAt,
      lastExecutedAt,
      durationDays,
      validationRate,
      contractIds,
      contractNames,
    })
  }

  return result
}
