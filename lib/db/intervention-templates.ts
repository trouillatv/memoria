// Phase 6 — Récurrence simple — Slice 6.1
//
// Helpers DB pour intervention_templates + génération paresseuse idempotente.
//
// Doctrine impérative :
//   - Génération paresseuse, max 7 jours d'avance (hard cap). Empêche la
//     pré-matérialisation longue durée.
//   - Idempotente via UNIQUE (template_id, scheduled_for, slot) + ON CONFLICT
//     DO NOTHING (l'INSERT bulk filtre automatiquement les doublons grâce à
//     `upsert(..., { onConflict, ignoreDuplicates: true })` côté supabase-js).
//   - Skip individuel : markInterventionSkipped traite UN skip à la fois.
//   - Une intervention générée porte template_id ET mission_id (chaîne
//     doctrinale Engagement → Mission → Intervention → Preuve).
//   - Aucun champ d'assignation, planning d'agents, roulements, ni jours fériés
//     (cf. doctrine planning §1-6 — signaux ROUGE STOP).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import { buildScheduledAt, slotFromUtcHour } from '@/lib/time/prestation-slot'
import type {
  DbInterventionTemplate,
  InterventionFrequency,
  InterventionSlot,
  InterventionStatus,
} from '@/types/db'

// ----------------------------------------------------------------------------
// Types d'input
// ----------------------------------------------------------------------------

export interface CreateTemplateInput {
  mission_id: string
  title: string
  description?: string | null
  frequency: InterventionFrequency
  slots?: InterventionSlot[] | null
  day_of_week?: number | null // 1-7, requis si frequency='weekly'
  day_of_month?: number | null // 1-31, requis si frequency='monthly'
  planned_start_hhmm?: string | null // 'HH:MM' — heure précise des occurrences
  planned_end_hhmm?: string | null
  starts_on: string // date ISO yyyy-mm-dd
  ends_on?: string | null
  created_by?: string | null
}

export interface UpdateTemplateInput {
  title?: string
  description?: string | null
  frequency?: InterventionFrequency
  slots?: InterventionSlot[] | null
  day_of_week?: number | null
  day_of_month?: number | null
  planned_start_hhmm?: string | null
  planned_end_hhmm?: string | null
  starts_on?: string
  ends_on?: string | null
  active?: boolean
}

// ----------------------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------------------

export async function listTemplatesForMission(missionId: string): Promise<DbInterventionTemplate[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_templates')
    .select('*')
    .eq('mission_id', missionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listTemplatesForSite(siteId: string): Promise<DbInterventionTemplate[]> {
  // intervention_templates → missions(site_id)
  const supabase = createAdminClient()
  const { data: missions, error: mErr } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  if (mErr) throw mErr
  if (!missions || missions.length === 0) return []
  const missionIds = missions.map((m) => m.id)

  const { data, error } = await supabase
    .from('intervention_templates')
    .select('*')
    .in('mission_id', missionIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listTemplatesForContract(contractId: string): Promise<DbInterventionTemplate[]> {
  // intervention_templates → missions(site_id) → sites(contract_id)
  const supabase = createAdminClient()
  const { data: sites, error: sErr } = await supabase
    .from('sites')
    .select('id')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
  if (sErr) throw sErr
  if (!sites || sites.length === 0) return []

  const { data: missions, error: mErr } = await supabase
    .from('missions')
    .select('id')
    .in('site_id', sites.map((s) => s.id))
    .is('deleted_at', null)
  if (mErr) throw mErr
  if (!missions || missions.length === 0) return []

  const { data, error } = await supabase
    .from('intervention_templates')
    .select('*')
    .in('mission_id', missions.map((m) => m.id))
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getTemplate(id: string): Promise<DbInterventionTemplate | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_templates')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createTemplate(input: CreateTemplateInput): Promise<DbInterventionTemplate> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('intervention_templates')
    .insert({
      mission_id: input.mission_id,
      title: input.title,
      description: input.description ?? null,
      frequency: input.frequency,
      slots: input.slots ?? null,
      day_of_week: input.day_of_week ?? null,
      day_of_month: input.day_of_month ?? null,
      planned_start_hhmm: input.planned_start_hhmm ?? null,
      planned_end_hhmm: input.planned_end_hhmm ?? null,
      starts_on: input.starts_on,
      ends_on: input.ends_on ?? null,
      created_by: input.created_by ?? null,
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DbInterventionTemplate
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput
): Promise<DbInterventionTemplate> {
  const supabase = createAdminClient()
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.frequency !== undefined) patch.frequency = input.frequency
  if (input.slots !== undefined) patch.slots = input.slots
  if (input.day_of_week !== undefined) patch.day_of_week = input.day_of_week
  if (input.day_of_month !== undefined) patch.day_of_month = input.day_of_month
  if (input.planned_start_hhmm !== undefined) patch.planned_start_hhmm = input.planned_start_hhmm
  if (input.planned_end_hhmm !== undefined) patch.planned_end_hhmm = input.planned_end_hhmm
  if (input.starts_on !== undefined) patch.starts_on = input.starts_on
  if (input.ends_on !== undefined) patch.ends_on = input.ends_on
  if (input.active !== undefined) patch.active = input.active

  const { data, error } = await supabase
    .from('intervention_templates')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as DbInterventionTemplate
}

/** Soft-delete via deleted_at — l'historique des interventions générées reste préservé. */
export async function archiveTemplate(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_templates')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id)
  if (error) throw error
}

// ----------------------------------------------------------------------------
// Génération paresseuse
// ----------------------------------------------------------------------------

export interface GenerationResult {
  generated: number // nombre d'interventions effectivement créées
  skipped: number // nombre de tuples déjà présents (idempotence via ON CONFLICT)
  templatesProcessed: number
}

const MAX_GENERATION_DAYS = 7

// Mapping slot → heure : déplacé dans le module canonique
// `@/lib/time/prestation-slot` (Constat fondateur V6.1 — fin des mappings
// divergents). `buildScheduledAt` est désormais importé.

/** ISO day-of-week : 1=Monday, ..., 7=Sunday. */
function isoDayOfWeek(date: Date): number {
  // getUTCDay() : 0=Sun, 1=Mon, ..., 6=Sat
  const d = date.getUTCDay()
  return d === 0 ? 7 : d
}

function isoDayOfMonth(date: Date): number {
  return date.getUTCDate()
}

/**
 * Vrai si la date matche la fréquence du template.
 * Travaille en UTC pour éviter les drifts TZ.
 */
function matchesFrequency(template: DbInterventionTemplate, date: Date): boolean {
  const dateIso = date.toISOString().slice(0, 10)

  // ends_on check (déjà fait par range mais on garde la garde locale)
  if (template.ends_on && dateIso > template.ends_on) return false
  if (dateIso < template.starts_on) return false

  switch (template.frequency) {
    case 'daily':
      return true
    case 'weekdays':
      return isoDayOfWeek(date) >= 1 && isoDayOfWeek(date) <= 5
    case 'weekly':
      return template.day_of_week !== null && isoDayOfWeek(date) === template.day_of_week
    case 'monthly':
      return template.day_of_month !== null && isoDayOfMonth(date) === template.day_of_month
    case 'one_shot':
      return dateIso === template.starts_on
    default:
      return false
  }
}

/** Énumère les dates yyyy-mm-dd de fromIso à toIso inclus (UTC). */
function enumerateDates(fromIso: string, toIso: string): Date[] {
  const out: Date[] = []
  const from = new Date(`${fromIso}T00:00:00.000Z`)
  const to = new Date(`${toIso}T00:00:00.000Z`)
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    out.push(new Date(d))
  }
  return out
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime()
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime()
  return Math.round((to - from) / (24 * 60 * 60 * 1000))
}

/**
 * Génère les interventions pour les templates actifs sur la période [fromDate, toDate].
 * Limite stricte : (toDate - fromDate) <= 7 jours.
 * Idempotent via UNIQUE (template_id, scheduled_for, slot) + ON CONFLICT DO NOTHING.
 *
 * Scope obligatoire (au moins un) :
 *   - siteId : génère pour les templates des missions de ce site
 *   - missionId : génère pour les templates de cette mission
 *   - templateIds : génère pour cette liste précise
 */
export async function generateInterventionsFromTemplates(params: {
  fromDate: string // yyyy-mm-dd
  toDate: string // yyyy-mm-dd
  siteId?: string
  missionId?: string
  templateIds?: string[]
}): Promise<GenerationResult> {
  // 1. Validation du range
  const rangeDays = daysBetween(params.fromDate, params.toDate)
  if (rangeDays < 0) {
    throw new Error('Generation range invalid: toDate before fromDate')
  }
  if (rangeDays > MAX_GENERATION_DAYS - 1) {
    // (toDate - fromDate) jours; max 6 entre les bornes = 7 jours générés au total.
    // Ex : from=2026-05-12, to=2026-05-18 → 7 jours, accepté.
    // Ex : from=2026-05-12, to=2026-05-19 → 8 jours, refusé.
    throw new Error(`Generation range cannot exceed ${MAX_GENERATION_DAYS} days`)
  }

  // 2. Validation du scope
  const hasScope =
    !!params.siteId || !!params.missionId || (params.templateIds && params.templateIds.length > 0)
  if (!hasScope) {
    throw new Error('Must provide siteId, missionId, or templateIds')
  }

  const supabase = createAdminClient()
  const orgId = await getOrgId()

  // 3. Résoudre la liste des mission_id ciblées (si siteId fourni)
  let scopedMissionIds: string[] | null = null
  if (params.missionId) {
    scopedMissionIds = [params.missionId]
  } else if (params.siteId) {
    const { data: missions, error: mErr } = await supabase
      .from('missions')
      .select('id')
      .eq('site_id', params.siteId)
      .is('deleted_at', null)
    if (mErr) throw mErr
    scopedMissionIds = (missions ?? []).map((m) => m.id)
    if (scopedMissionIds.length === 0) {
      return { generated: 0, skipped: 0, templatesProcessed: 0 }
    }
  }

  // 4. Fetch templates actifs concernés sur la fenêtre
  let query = supabase
    .from('intervention_templates')
    .select('*')
    .eq('active', true)
    .is('deleted_at', null)
    .lte('starts_on', params.toDate)

  // ends_on IS NULL OR ends_on >= fromDate
  query = query.or(`ends_on.is.null,ends_on.gte.${params.fromDate}`)

  if (params.templateIds && params.templateIds.length > 0) {
    query = query.in('id', params.templateIds)
  } else if (scopedMissionIds) {
    query = query.in('mission_id', scopedMissionIds)
  }

  const { data: templatesData, error: tErr } = await query
  if (tErr) throw tErr
  const templates = (templatesData ?? []) as DbInterventionTemplate[]
  if (templates.length === 0) {
    return { generated: 0, skipped: 0, templatesProcessed: 0 }
  }

  // 4b. Fetch missions' default_team[] + assigned_team_id — les interventions
  //    générées héritent du team par défaut de leur mission (legacy) et de
  //    l'assigned_team_id (V2). Sans assigned_team_id sur l'intervention générée,
  //    listInterventionsVisibleToUser ne la retourne pas pour les chefs d'équipe
  //    V2 dont la mission utilise assigned_team_id au lieu de default_team.
  const missionIdsForTeam = Array.from(new Set(templates.map((t) => t.mission_id)))
  const teamByMission = new Map<string, string[]>()
  const assignedTeamByMission = new Map<string, string | null>()
  if (missionIdsForTeam.length > 0) {
    const { data: missionsTeam, error: mtErr } = await supabase
      .from('missions')
      .select('id, default_team, assigned_team_id')
      .in('id', missionIdsForTeam)
    if (mtErr) throw mtErr
    for (const m of (missionsTeam ?? []) as Array<{ id: string; default_team: unknown; assigned_team_id: string | null }>) {
      teamByMission.set(m.id, Array.isArray(m.default_team) ? m.default_team : [])
      assignedTeamByMission.set(m.id, m.assigned_team_id ?? null)
    }
  }

  // 5. Construire les rows à insérer
  type Row = {
    mission_id: string
    template_id: string
    scheduled_at: string
    scheduled_for: string
    slot: InterventionSlot | null
    planned_start: string
    planned_end: string | null
    status: InterventionStatus
    team: string[]
    assigned_team_id?: string
  }
  const rowsToInsert: Row[] = []

  for (const tpl of templates) {
    // Fenêtre effective = intersection [fromDate,toDate] ∩ [starts_on, ends_on?]
    const effectiveStart = tpl.starts_on > params.fromDate ? tpl.starts_on : params.fromDate
    const effectiveEnd =
      tpl.ends_on && tpl.ends_on < params.toDate ? tpl.ends_on : params.toDate
    if (effectiveStart > effectiveEnd) continue

    const dates = enumerateDates(effectiveStart, effectiveEnd)
    // V6.2 — heure précise : un seul créneau DÉRIVÉ de l'heure de début (pour la
    // grille + l'index d'unicité). Sinon : créneaux du template (legacy) ou null.
    const hasTime =
      typeof tpl.planned_start_hhmm === 'string' && /^\d{2}:\d{2}$/.test(tpl.planned_start_hhmm)
    const slots: (InterventionSlot | null)[] = hasTime
      ? [slotFromUtcHour(Number(tpl.planned_start_hhmm!.slice(0, 2)))]
      : tpl.slots && tpl.slots.length > 0
        ? tpl.slots
        : [null]
    const inheritedTeam = teamByMission.get(tpl.mission_id) ?? []
    const inheritedAssignedTeamId = assignedTeamByMission.get(tpl.mission_id) ?? null

    for (const date of dates) {
      if (!matchesFrequency(tpl, date)) continue
      const dateIso = date.toISOString().slice(0, 10)
      for (const slot of slots) {
        const plannedStart = hasTime
          ? `${dateIso}T${tpl.planned_start_hhmm}:00.000Z`
          : buildScheduledAt(dateIso, slot)
        const plannedEnd =
          hasTime && tpl.planned_end_hhmm ? `${dateIso}T${tpl.planned_end_hhmm}:00.000Z` : null
        rowsToInsert.push({
          mission_id: tpl.mission_id,
          template_id: tpl.id,
          scheduled_at: plannedStart,
          scheduled_for: dateIso,
          slot,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          status: 'planned',
          team: inheritedTeam,
          ...(inheritedAssignedTeamId ? { assigned_team_id: inheritedAssignedTeamId } : {}),
          ...(orgId ? { organization_id: orgId } : {}),
        })
      }
    }
  }

  if (rowsToInsert.length === 0) {
    return { generated: 0, skipped: 0, templatesProcessed: templates.length }
  }

  // 6. Pré-filtrage côté serveur : l'unique index est PARTIEL
  //    (WHERE template_id IS NOT NULL), donc supabase-js `upsert(...onConflict)`
  //    ne peut pas le cibler (PostgREST ne génère pas le prédicat WHERE).
  //    On compense par un SELECT préalable des tuples (template_id,
  //    scheduled_for, slot) déjà présents sur la fenêtre, puis INSERT bulk
  //    filtré. L'unique partial index reste filet de sécurité au niveau DB en
  //    cas de course concurrente.
  const templateIdsToCheck = Array.from(new Set(rowsToInsert.map((r) => r.template_id)))
  const { data: existing, error: exErr } = await supabase
    .from('interventions')
    .select('template_id, scheduled_for, slot')
    .in('template_id', templateIdsToCheck)
    .gte('scheduled_for', params.fromDate)
    .lte('scheduled_for', params.toDate)
  if (exErr) throw exErr

  // Clé composite (template_id|scheduled_for|slot) ; slot peut être null.
  const keyOf = (r: { template_id: string | null; scheduled_for: string | null; slot: string | null }) =>
    `${r.template_id ?? ''}|${r.scheduled_for ?? ''}|${r.slot ?? '∅'}`

  const existingKeys = new Set((existing ?? []).map(keyOf))
  const rowsFiltered = rowsToInsert.filter((r) => !existingKeys.has(keyOf(r)))

  if (rowsFiltered.length === 0) {
    return {
      generated: 0,
      skipped: rowsToInsert.length,
      templatesProcessed: templates.length,
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('interventions')
    .insert(rowsFiltered)
    .select('id')
  if (insErr) throw insErr

  const generated = (inserted ?? []).length
  const skipped = rowsToInsert.length - generated

  return { generated, skipped, templatesProcessed: templates.length }
}

// ----------------------------------------------------------------------------
// Stats par template (Slice 6.5)
// ----------------------------------------------------------------------------

/**
 * Stats aggregate d'un template — jamais d'identité d'agent. Les chiffres
 * servent au superviseur pour lire l'état de la récurrence d'un coup d'œil.
 *
 * - lastInterventionDate : date de la dernière intervention passée (<= today),
 *   y compris executed / validated / planned / skipped.
 * - lastInterventionStatus : status correspondant à lastInterventionDate.
 * - nextInterventionDate : date de la prochaine intervention future (>= today)
 *   non sautée.
 * - interventionsThisWeek : nombre d'interventions planifiées entre today et
 *   today+6 (inclus), hors skipped.
 */
export interface TemplateStats {
  lastInterventionDate: string | null
  lastInterventionStatus: InterventionStatus | null
  nextInterventionDate: string | null
  interventionsThisWeek: number
}

// Alias des helpers centralisés (zone Pacific/Noumea).
const todayUtcIso = todayLocalIso
const addDaysIso = addDaysLocal

/** Stats pour un template unique. */
export async function getTemplateStats(templateId: string): Promise<TemplateStats> {
  const batch = await getTemplateStatsBatch([templateId])
  return (
    batch.get(templateId) ?? {
      lastInterventionDate: null,
      lastInterventionStatus: null,
      nextInterventionDate: null,
      interventionsThisWeek: 0,
    }
  )
}

/**
 * Stats batchées — évite le N+1 sur la liste superviseur.
 *
 * Fetch UNE SEULE requête `interventions WHERE template_id IN (...)` puis
 * réduit en mémoire (last/next/thisWeek). Coût ~ O(N) lignes pour la fenêtre
 * de vie des templates listés ; acceptable pour un superviseur avec quelques
 * dizaines de templates max.
 */
export async function getTemplateStatsBatch(
  templateIds: string[]
): Promise<Map<string, TemplateStats>> {
  const out = new Map<string, TemplateStats>()
  if (templateIds.length === 0) return out

  // Initialisation par défaut pour chaque templateId
  for (const id of templateIds) {
    out.set(id, {
      lastInterventionDate: null,
      lastInterventionStatus: null,
      nextInterventionDate: null,
      interventionsThisWeek: 0,
    })
  }

  const today = todayUtcIso()
  const inSixDays = addDaysIso(today, 6)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .select('template_id, scheduled_for, status, skipped_at')
    .in('template_id', templateIds)
  if (error) throw error

  type Row = {
    template_id: string | null
    scheduled_for: string | null
    status: InterventionStatus | null
    skipped_at: string | null
  }
  for (const r of (data ?? []) as Row[]) {
    if (!r.template_id || !r.scheduled_for) continue
    const stats = out.get(r.template_id)
    if (!stats) continue

    // Last : <= today, max date — tous statuts confondus
    if (r.scheduled_for <= today) {
      if (
        stats.lastInterventionDate === null ||
        r.scheduled_for > stats.lastInterventionDate
      ) {
        stats.lastInterventionDate = r.scheduled_for
        stats.lastInterventionStatus = r.status ?? null
      }
    }

    // Next : >= today, hors skipped (skipped_at non null OU status='skipped')
    const isSkipped = r.skipped_at !== null || r.status === 'skipped'
    if (r.scheduled_for >= today && !isSkipped) {
      if (
        stats.nextInterventionDate === null ||
        r.scheduled_for < stats.nextInterventionDate
      ) {
        stats.nextInterventionDate = r.scheduled_for
      }
    }

    // ThisWeek : [today, today+6], hors skipped
    if (r.scheduled_for >= today && r.scheduled_for <= inSixDays && !isSkipped) {
      stats.interventionsThisWeek += 1
    }
  }

  return out
}

// ----------------------------------------------------------------------------
// Skip — un par appel, raison obligatoire
// ----------------------------------------------------------------------------

/**
 * Marque une intervention comme « Pas aujourd'hui ». L'intervention reste
 * visible dans la liste (grisée). Pas de mass-skip : un appel = un skip.
 */
export async function markInterventionSkipped(
  interventionId: string,
  reason: string,
  skippedBy?: string | null
): Promise<void> {
  const trimmed = (reason ?? '').trim()
  if (!trimmed) {
    throw new Error('Skip reason is required (geste conscient)')
  }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('interventions')
    .update({
      status: 'skipped' as InterventionStatus,
      skipped_at: new Date().toISOString(),
      skipped_reason: trimmed,
      skipped_by: skippedBy ?? null,
    })
    .eq('id', interventionId)
  if (error) throw error
}
