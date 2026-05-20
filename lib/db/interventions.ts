import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteNotes } from '@/lib/db/sites'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import { buildScheduledAt, slotFromScheduledAt, buildPlannedTimestamp } from '@/lib/time/prestation-slot'
import { anomalyLabel } from '@/lib/anomaly-labels'
import type {
  DbIntervention, InterventionStatus, InterventionSlot,
  DbInterventionChecklistItem, DbInterventionPhoto, PhotoKind,
  DbInterventionAnomaly, AnomalyCategory, AnomalyStatus,
  DbInterventionValidation,
  DbSiteNote,
} from '@/types/db'

export async function listInterventionsByMission(missionId: string): Promise<DbIntervention[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .eq('mission_id', missionId)
    .order('scheduled_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ===== Supervisor list query (cross-contract) =====

export type SupervisorDateRange = 'today' | '7d' | '30d' | 'all'

export interface SupervisorInterventionsQuery {
  /** Filtre date par fenêtre prédéfinie. `all` = pas de borne basse, `today` = jour courant. */
  dateRange?: SupervisorDateRange
  /** Filtre statut intervention. */
  status?: InterventionStatus
  /** Filtre site (mission.site_id). */
  siteId?: string
  /** Phase 10 — filtre par mission spécifique. */
  missionId?: string
  /** 0-based offset. */
  offset?: number
  /** Max items returned. */
  limit?: number
}

export interface SupervisorInterventionRow {
  id: string
  scheduled_at: string
  scheduled_for: string | null
  slot: InterventionSlot | null
  status: string
  mission_id: string
  skipped_reason: string | null
  /** Équipe affectée (organisation prévue, doctrine V3). Null si non affectée. */
  assigned_team_id: string | null
  team: { id: string; name: string; color: string | null } | null
  mission?: {
    name: string
    site?: {
      name: string
      contract?: { id: string; name: string; client_name: string } | null
    } | null
  } | null
}

export interface SupervisorInterventionsResult {
  items: SupervisorInterventionRow[]
  total: number
}

/**
 * Liste paginée d'interventions pour la vue superviseur cross-contract.
 * Supporte les filtres date, statut, site + pagination.
 *
 * Note : pour le filtre site, on filtre côté DB via `missions.site_id`. Sans
 * possibilité native d'inner-join filter en PostgREST simple, on résout le set
 * d'ids missions d'abord.
 */
export async function listInterventionsSupervisor(
  query: SupervisorInterventionsQuery = {},
): Promise<SupervisorInterventionsResult> {
  const supabase = createAdminClient()

  // Compute date lower bound from dateRange
  const dateRange = query.dateRange ?? 'all'
  let scheduledFromIso: string | null = null
  if (dateRange === 'today') {
    scheduledFromIso = `${todayLocalIso()}T00:00:00`
  } else if (dateRange === '7d') {
    scheduledFromIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  } else if (dateRange === '30d') {
    scheduledFromIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  }

  // Resolve mission ids if siteId filter is present (can't filter on join in PostgREST).
  let missionIdsForSite: string[] | null = null
  if (query.siteId) {
    const { data: missions, error: mErr } = await supabase
      .from('missions')
      .select('id')
      .eq('site_id', query.siteId)
      .is('deleted_at', null)
    if (mErr) throw mErr
    missionIdsForSite = (missions ?? []).map((m) => m.id)
    if (missionIdsForSite.length === 0) {
      // No missions on this site → empty result
      return { items: [], total: 0 }
    }
  }

  let q = supabase
    .from('interventions')
    .select(
      `
      id, scheduled_at, scheduled_for, slot, status, mission_id, skipped_reason,
      assigned_team_id,
      team:teams(id, name, color),
      mission:missions(id, name, site_id, site:sites(id, name, contract_id, contract:contracts(id, name, client_name)))
    `,
      { count: 'exact' },
    )
    .order('scheduled_at', { ascending: true })

  if (scheduledFromIso) q = q.gte('scheduled_at', scheduledFromIso)
  if (query.status) q = q.eq('status', query.status)
  if (missionIdsForSite) q = q.in('mission_id', missionIdsForSite)
  if (query.missionId) q = q.eq('mission_id', query.missionId)

  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? 50)
  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error

  type RawIntervention = {
    id: string
    scheduled_at: string
    scheduled_for: string | null
    slot: InterventionSlot | null
    status: string
    mission_id: string
    skipped_reason: string | null
    assigned_team_id: string | null
    team?: unknown
    mission?: unknown
  }

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const raw = (data ?? []) as unknown as RawIntervention[]
  const items: SupervisorInterventionRow[] = raw.map((r) => {
    const missionRaw = pickOne<{ name: string; site?: unknown }>(r.mission)
    const siteRaw = missionRaw ? pickOne<{ name: string; contract?: unknown }>(missionRaw.site) : null
    const contractRaw = siteRaw
      ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract)
      : null
    const teamRaw = pickOne<{ id: string; name: string; color: string | null }>(r.team)
    return {
      id: r.id,
      scheduled_at: r.scheduled_at,
      scheduled_for: r.scheduled_for,
      slot: r.slot,
      status: r.status,
      mission_id: r.mission_id,
      skipped_reason: r.skipped_reason,
      assigned_team_id: r.assigned_team_id,
      team: teamRaw,
      mission: missionRaw
        ? {
            name: missionRaw.name,
            site: siteRaw ? { name: siteRaw.name, contract: contractRaw } : null,
          }
        : null,
    }
  })

  return { items, total: count ?? 0 }
}

export async function listInterventionsByContract(contractId: string): Promise<DbIntervention[]> {
  // Through sites and missions
  const supabase = createAdminClient()
  const { data: sites } = await supabase.from('sites').select('id').eq('contract_id', contractId).is('deleted_at', null)
  if (!sites?.length) return []
  const { data: missions } = await supabase.from('missions').select('id').in('site_id', sites.map((s) => s.id)).is('deleted_at', null)
  if (!missions?.length) return []
  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .in('mission_id', missions.map((m) => m.id))
    .order('scheduled_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data ?? []
}

export async function getIntervention(id: string): Promise<DbIntervention | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('interventions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/**
 * Crée une intervention `planned`.
 *
 * Deux modes d'appel :
 *   - Mode RECOMMANDÉ : passer `scheduled_for` (date YYYY-MM-DD) + `slot`
 *     (matin/après-midi/soir). Doctrine V2 — créneaux nommés explicites,
 *     jamais d'heures précises. Le `scheduled_at` (timestamp UTC) est dérivé
 *     mécaniquement pour rester en cohérence avec les colonnes existantes.
 *   - Mode legacy : passer `scheduled_at` (timestamp UTC). `scheduled_for`
 *     et `slot` sont dérivés depuis l'heure UTC. Fragile en multi-timezone
 *     mais conservé pour compat (seed, scripts dev).
 *
 * Sans `scheduled_for` ni `scheduled_at`, throws.
 */
// Mapping slot ↔ heure : module canonique `@/lib/time/prestation-slot`
// (Constat fondateur V6.1 — fin des 3 mappings divergents 6/12/18,
// 7/13/18, 8/14/19). `buildScheduledAt` / `slotFromScheduledAt` importés.

export async function createIntervention(input: {
  mission_id: string
  /** Mode legacy — déconseillé sauf seed/scripts dev. */
  scheduled_at?: string
  /** Mode recommandé — date pure YYYY-MM-DD. */
  scheduled_for?: string
  /** Mode recommandé — créneau explicite. */
  slot?: 'morning' | 'afternoon' | 'evening'
  /** V6.1 (Vincent 2026-05-20 — demande Guillaume) : heure précise de début
   *  au format "HH:MM" (heure locale Nouméa). Optionnel : si absent, le
   *  `planned_start` reste l'ancrage canonique slot→heure (07/14/19). */
  planned_start_hhmm?: string
  /** V6.1 : heure précise de fin "HH:MM". Optionnel ; demande une `planned_start_hhmm`. */
  planned_end_hhmm?: string
  team?: string[]
  created_by: string | null
}): Promise<string> {
  let scheduled_for: string
  let slot: 'morning' | 'afternoon' | 'evening'
  let scheduled_at: string

  if (input.scheduled_for && input.slot) {
    scheduled_for = input.scheduled_for
    slot = input.slot
    scheduled_at = buildScheduledAt(scheduled_for, slot)
  } else if (input.scheduled_at) {
    scheduled_at = input.scheduled_at
    const d = new Date(scheduled_at)
    scheduled_for = d.toISOString().slice(0, 10)
    slot = slotFromScheduledAt(scheduled_at)
  } else {
    throw new Error(
      'createIntervention : fournir (scheduled_for + slot) ou scheduled_at',
    )
  }

  // V6.1 — heures précises optionnelles. Si fournies, écrasent l'ancrage
  // grossier slot→heure. Sinon planned_start = scheduled_at (= 07/14/19).
  // Le `slot` reste calculé à partir de l'heure réelle (reverse non
  // destructif via `slotFromUtcHour`), pour cohérence avec les vues
  // groupées par slot existantes.
  let planned_start: string = scheduled_at
  let planned_end: string | null = null
  if (input.planned_start_hhmm) {
    const ts = buildPlannedTimestamp(scheduled_for, input.planned_start_hhmm)
    if (!ts) throw new Error('planned_start_hhmm invalide (attendu HH:MM)')
    planned_start = ts
    // Si l'heure précise est fournie, on relit le slot depuis cette heure.
    slot = slotFromScheduledAt(planned_start)
    scheduled_at = planned_start
    if (input.planned_end_hhmm) {
      const tsEnd = buildPlannedTimestamp(scheduled_for, input.planned_end_hhmm)
      if (!tsEnd) throw new Error('planned_end_hhmm invalide (attendu HH:MM)')
      if (new Date(tsEnd).getTime() <= new Date(planned_start).getTime()) {
        throw new Error('planned_end_hhmm doit être après planned_start_hhmm')
      }
      planned_end = tsEnd
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      mission_id: input.mission_id,
      scheduled_at,
      scheduled_for,
      slot,
      // V6.1 — ancrage honnête de la prestation. JAMAIS pointage personne
      // (pare-feu : ne jamais agréger par user_id, verrou test doctrine).
      planned_start,
      planned_end,
      team: input.team ?? [],
      status: 'planned' as InterventionStatus,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateInterventionStatus(
  id: string,
  status: InterventionStatus,
  executed_at?: string
): Promise<void> {
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = { status }
  if (executed_at !== undefined) updates.executed_at = executed_at
  const { error } = await supabase.from('interventions').update(updates).eq('id', id)
  if (error) throw error
}

// ===== Créneaux libres pour une équipe (J → J+7) =====
//
// Retourne la liste des (date, slot) sur les 7 prochains jours où l'équipe
// n'a aucune intervention planifiée/en cours. L'intervention à décaler est
// exclue (sinon son propre slot apparaîtrait comme "pris").

export type AvailableSlot = {
  date: string                                       // 'YYYY-MM-DD'
  slot: 'morning' | 'afternoon' | 'evening'
}

export async function getAvailableSlotsForTeam(
  teamId: string,
  _excludeInterventionId: string,  // legacy : conservé pour compat appel
  daysAhead = 7,
): Promise<AvailableSlot[]> {
  const supabase = createAdminClient()
  const todayStr = todayLocalIso()
  const endStr = addDaysLocal(todayStr, daysAhead)

  // NB : on INCLUT l'intervention elle-même dans la requête de conflit. Son
  // slot actuel doit apparaître comme "pris" pour empêcher un décalage no-op
  // (sélectionner la même date + slot que l'actuel). Les AUTRES slots de la
  // même date restent disponibles.
  const { data: existing } = await supabase
    .from('interventions')
    .select('scheduled_for, slot')
    .eq('assigned_team_id', teamId)
    .in('status', ['planned', 'in_progress'])
    .gte('scheduled_for', todayStr)
    .lt('scheduled_for', endStr)

  const taken = new Set<string>()
  for (const e of (existing ?? []) as Array<{ scheduled_for: string; slot: string | null }>) {
    if (e.slot) taken.add(`${e.scheduled_for}|${e.slot}`)
  }

  const slots: AvailableSlot[] = []
  for (let i = 0; i < daysAhead; i++) {
    const dateStr = addDaysLocal(todayStr, i)
    for (const slot of ['morning', 'afternoon', 'evening'] as const) {
      if (!taken.has(`${dateStr}|${slot}`)) {
        slots.push({ date: dateStr, slot })
      }
    }
  }
  return slots
}

// ===== Décaler une intervention (changement de date + slot) =====
export async function rescheduleIntervention(
  id: string,
  newDate: string,           // 'YYYY-MM-DD'
  newSlot: 'morning' | 'afternoon' | 'evening',
): Promise<void> {
  const supabase = createAdminClient()
  // scheduled_at : timestamp UTC à minuit pour cohérence avec la création
  const scheduledAt = new Date(`${newDate}T00:00:00.000Z`).toISOString()
  const { error } = await supabase
    .from('interventions')
    .update({ scheduled_for: newDate, slot: newSlot, scheduled_at: scheduledAt })
    .eq('id', id)
  if (error) throw error
}

// ----- Checklist items -----
export async function listChecklistItemsByIntervention(interventionId: string): Promise<DbInterventionChecklistItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_checklist_items')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('position')
  if (error) throw error
  return data ?? []
}

export async function bulkInsertChecklistItems(items: Array<{
  intervention_id: string
  engagement_id: string | null
  label: string
  position: number
  required: boolean
}>): Promise<DbInterventionChecklistItem[]> {
  if (items.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_checklist_items')
    .insert(items.map((i) => ({ ...i, done: false })))
    .select('*')
  if (error) throw error
  return data ?? []
}

export async function markChecklistItemDone(id: string, userId: string | null): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_checklist_items')
    .update({ done: true, done_at: new Date().toISOString(), done_by: userId })
    .eq('id', id)
  if (error) throw error
}

// ----- Photos -----
export async function listPhotosByIntervention(interventionId: string): Promise<DbInterventionPhoto[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('taken_at')
  if (error) throw error
  return data ?? []
}

/**
 * Count photos for a batch of interventions in a single query.
 * Returns a Map<intervention_id, count>. Missing IDs = 0.
 * Utile sur /dashboard pour éviter le N+1 (1 query par intervention finie).
 */
export async function countPhotosByInterventions(
  interventionIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (interventionIds.length === 0) return result

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .select('intervention_id')
    .in('intervention_id', interventionIds)
  if (error) throw error

  for (const row of data ?? []) {
    const id = (row as { intervention_id: string }).intervention_id
    result.set(id, (result.get(id) ?? 0) + 1)
  }
  return result
}

export async function insertPhoto(input: {
  intervention_id: string
  checklist_item_id: string | null
  anomaly_id?: string | null
  storage_path: string
  kind: PhotoKind
  caption: string | null
  taken_by: string | null
  // Intégrité cryptographique (migration 040 — Phase 1.1)
  sha256?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  client_timestamp?: string | null
  hash_origin?: 'verified' | 'retroactive' | 'unknown'
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .insert(input)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updatePhotoAiCaption(photoId: string, caption: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('intervention_photos')
    .update({ ai_caption: caption })
    .eq('id', photoId)
}

// ----- Anomalies -----
export async function listAnomaliesByIntervention(interventionId: string): Promise<DbInterventionAnomaly[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_anomalies')
    .select('*')
    .eq('intervention_id', interventionId)
    .neq('status', 'ignored')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createAnomaly(input: {
  intervention_id: string
  engagement_id?: string | null
  category: AnomalyCategory
  category_other?: string | null
  description?: string | null
  reported_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_anomalies')
    .insert({
      intervention_id: input.intervention_id,
      engagement_id: input.engagement_id ?? null,
      category: input.category,
      category_other: input.category_other ?? null,
      description: input.description ?? null,
      status: 'open' as AnomalyStatus,
      reported_by: input.reported_by,
    })
    .select('id')
    .single()
  if (error) throw error

  // Fire-and-forget embedding — silencieux si pas de clé API configurée.
  if (input.description?.trim()) {
    const anomalyId = data.id
    const interventionId = input.intervention_id
    const text = input.description.trim()
    import('@/lib/ai/embed-trace').then(({ embedAnomalyTrace }) =>
      embedAnomalyTrace({ anomalyId, interventionId, text })
    ).catch(() => {})
  }

  return data.id
}

// ----- Validations -----
export async function getValidationByIntervention(interventionId: string): Promise<DbInterventionValidation | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_validations')
    .select('*')
    .eq('intervention_id', interventionId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createValidation(input: {
  intervention_id: string
  validated_by: string
  comment?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_validations')
    .insert({
      intervention_id: input.intervention_id,
      validated_by: input.validated_by,
      comment: input.comment ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Liste les interventions visibles par l'utilisateur sur sa vue mobile
 * opérationnelle (/m). C'est une query de **visibilité opérationnelle** :
 * "qu'est-ce que ce chef d'équipe doit voir aujourd'hui ?", PAS une query
 * analytique "que fait Pierre ?".
 *
 * Doctrine V3 — Asymétrie événement vs personne :
 *   - le résultat est borné dans une fenêtre temporelle courte (J-1 → J+7)
 *   - il n'existe AUCUN écran qui exploite ce helper pour produire un
 *     historique global, un dashboard agent, ou des stats individuelles
 *   - tout usage hors `/m` doit être refusé en revue de code
 *
 * Renommé en Slice 10.1 (depuis `listInterventionsByAgent`) pour clarifier la
 * sémantique opérationnelle vs analytique. Voir tests/doctrine/forbidden-symbols.test.ts.
 *
 * Slice 6.4 : les interventions « skipped » (Pas aujourd'hui) sont conservées
 * dans la liste — la doctrine veut un affichage grisé + badge, pas une
 * disparition. Le rendu côté UI applique le style.
 */
export async function listInterventionsVisibleToUser(userId: string): Promise<DbIntervention[]> {
  const supabase = createAdminClient()

  // V5.1 fix : récupérer les team_ids actives de l'user.
  // Les interventions doctrine V2 utilisent `assigned_team_id` (pas le legacy
  // `team` array). Sans ce join, Moana / les chefs ne voient AUCUNE
  // intervention même quand ils sont membres actifs d'une équipe affectée.
  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .is('left_at', null)
  const teamIds = (memberships ?? []).map((m) => m.team_id)

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const inOneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // V5.1 — join missions pour filtrer les missions système ("Traces libres
  // du site", cadence='on_demand') qui polluent /m.
  let q = supabase
    .from('interventions')
    .select('*, mission_cadence:missions!inner(cadence, name)')
    .gte('scheduled_at', yesterday)
    .lte('scheduled_at', inOneWeek)
    .order('scheduled_at', { ascending: true })

  if (teamIds.length > 0) {
    // Combine : user dans le team[] legacy OU assigned_team_id ∈ teams actives
    q = q.or(
      `team.cs.{${userId}},assigned_team_id.in.(${teamIds.join(',')})`,
    )
  } else {
    // Pas de team active : fallback sur le legacy team[]
    q = q.contains('team', [userId])
  }

  const { data, error } = await q
  if (error) throw error

  // V5.1 — exclure les interventions sur missions système (Traces libres du site)
  type RawWithMission = DbIntervention & {
    mission_cadence?:
      | { cadence?: string | null; name?: string | null }
      | Array<{ cadence?: string | null; name?: string | null }>
      | null
  }
  const filtered = (data ?? []).filter((r: unknown) => {
    const row = r as RawWithMission
    const m = Array.isArray(row.mission_cadence) ? row.mission_cadence[0] : row.mission_cadence
    if (!m) return true
    return m.cadence !== 'on_demand'
  })

  // Strip the joined field pour préserver le type DbIntervention
  return filtered.map((r: unknown) => {
    const { mission_cadence: _omit, ...rest } = r as RawWithMission
    return rest as DbIntervention
  })
}

// =================================
// Mémoire des lieux — Sprint 2 doctrine V5 (Mode reprise)
//
// Contexte de reprise pour un utilisateur qui revient sur un site après absence.
// AUCUNE recommandation — uniquement des faits descriptifs (verrou V4).
// La logique reste **opérationnelle** : "qu'est-ce qui s'est passé ici" et non
// "qu'est-ce que Joseph fait habituellement". On lit le dernier passage du
// user courant pour calibrer la fenêtre, jamais pour comparer ou mesurer.
// =================================

export interface SiteResumeAnomaly {
  id: string
  description: string
  resolved_at: string | null
  created_at: string
}

export interface SiteResumeContext {
  /** Nombre de jours depuis le dernier passage validé du user sur ce site. null = jamais venu. */
  daysSinceLastVisit: number | null
  /** ISO de la dernière intervention completed/validated du user sur ce site. */
  lastVisitAt: string | null
  /** Notes du site créées dans les 30 derniers jours (max 10, tri desc). */
  recentSiteNotes: DbSiteNote[]
  /** Anomalies sur ce site dans les 30 derniers jours (max 10, tri desc). */
  recentAnomalies: SiteResumeAnomaly[]
}

/**
 * Calcule le contexte de reprise d'un site pour un user donné.
 * Utilisé sur /m/intervention/[id] pour afficher l'encart « Reprise » quand
 * daysSinceLastVisit est null ou > 7.
 *
 * Doctrine : on lit l'historique du **site**, pas l'historique de la personne.
 * Le filtre par user sert UNIQUEMENT à calibrer la fenêtre de reprise (a-t-il
 * besoin d'un rappel ?), jamais à produire un score ou un ratio par agent.
 */
export async function getSiteResumeContext(
  siteId: string,
  userId: string,
): Promise<SiteResumeContext> {
  const supabase = createAdminClient()
  const now = new Date()
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Dernière intervention du user sur ce site, completed ou validated.
  //    On passe par missions.site_id → interventions.mission_id.
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)

  let lastVisitAt: string | null = null
  if (missionIds.length > 0) {
    const { data: lastIntv } = await supabase
      .from('interventions')
      .select('executed_at, scheduled_at, status')
      .in('mission_id', missionIds)
      .contains('team', [userId])
      .in('status', ['completed', 'validated'])
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const row = lastIntv?.[0]
    if (row) {
      lastVisitAt = row.executed_at ?? row.scheduled_at ?? null
    }
  }

  const daysSinceLastVisit = lastVisitAt
    ? Math.floor((now.getTime() - new Date(lastVisitAt).getTime()) / (1000 * 60 * 60 * 24))
    : null

  // 2. site_notes des 30 derniers jours (max 10). On filtre côté JS sur la fenêtre
  //    pour réutiliser listSiteNotes (tri desc déjà appliqué côté DB).
  const allNotes = await listSiteNotes(siteId, 20)
  const recentSiteNotes = allNotes.filter((n) => n.created_at >= thirtyDaysAgoIso).slice(0, 10)

  // 3. anomalies des 30 derniers jours sur ce site (via missions).
  let recentAnomalies: SiteResumeAnomaly[] = []
  if (missionIds.length > 0) {
    // Récupère les ids interventions du site.
    const { data: siteInterventions } = await supabase
      .from('interventions')
      .select('id')
      .in('mission_id', missionIds)
    const intvIds = (siteInterventions ?? []).map((i) => i.id)

    if (intvIds.length > 0) {
      const { data: anomalies } = await supabase
        .from('intervention_anomalies')
        .select('id, description, category, category_other, resolved_at, created_at')
        .in('intervention_id', intvIds)
        .gte('created_at', thirtyDaysAgoIso)
        .order('created_at', { ascending: false })
        .limit(10)

      recentAnomalies = (anomalies ?? []).map((a) => {
        const raw = a as {
          id: string
          description: string | null
          category: string
          category_other: string | null
          resolved_at: string | null
          created_at: string
        }
        return {
          id: raw.id,
          description: anomalyLabel(raw.description, raw.category_other, raw.category),
          resolved_at: raw.resolved_at,
          created_at: raw.created_at,
        }
      })
    }
  }

  return {
    daysSinceLastVisit,
    lastVisitAt,
    recentSiteNotes,
    recentAnomalies,
  }
}
