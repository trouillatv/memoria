// Phase 9 — Vue Semaine & Équipes (Slice 9.1)
//
// Helpers DB pour la vue semaine : liste interventions sur une semaine ISO,
// agrégées en lignes (Site × Jour) ou (Équipe × Jour).
//
// Doctrine V2 imperative — `docs/superpowers/doctrines/planning-doctrine.md` :
//
//   - Pas de slots horaires précis dans l'UX. On expose `slot` nommé
//     (morning/afternoon/evening), JAMAIS d'heure.
//   - Vue Site × Jour = PRIMAIRE. Vue Équipe × Jour = secondaire/utilitaire.
//   - `member_count` sur TeamRow est descriptif (« Alpha · 4 personnes »),
//     JAMAIS un KPI. Aucun ratio mission/membre, aucune charge équipe.
//   - "Non-affecté" apparaît en DERNIÈRE position dans `getWeekByTeam` —
//     bandeau ambre discret côté UI.
//   - Aucune métrique inter-équipes. Aucune comparaison. Aucun classement.
//
// INTERDIT explicitement dans ce fichier :
//
//   - getCoverageRate / getCompletionByTeam / getProductivityByTeam
//   - getOverdueInterventions / getLateInterventions
//   - Toute fonction qui agrège un KPI par personne ou par équipe.

import { createAdminClient } from '@/lib/supabase/admin'
import { isSystemMissionName } from '@/lib/db/system-missions'

// ----------------------------------------------------------------------------
// Types publics
// ----------------------------------------------------------------------------

export interface WeekRange {
  /** Lundi yyyy-mm-dd UTC. */
  weekStart: string
  /** Dimanche yyyy-mm-dd UTC. */
  weekEnd: string
  /** Numéro de semaine ISO 8601 (1-53). */
  weekNumber: number
  /** Année ISO 8601 (année du jeudi de la semaine). */
  year: number
}

export interface WeekInterventionCell {
  id: string
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string
  contract_name: string
  scheduled_for: string
  slot: string | null
  status: string
  skipped_at: string | null
  assigned_team_id: string | null
  assigned_team_name: string | null
  assigned_team_color: string | null
  // V6.1 — heure précise (ancrage prestation, jamais pointage personne).
  planned_start: string | null
  planned_end: string | null
}

export interface SiteRow {
  site_id: string
  site_name: string
  contract_id: string
  contract_name: string
  /** Map yyyy-mm-dd → interventions du jour. */
  days: Record<string, WeekInterventionCell[]>
}

export interface TeamRow {
  /** null = "Non-affecté" (toujours rangée en dernier). */
  team_id: string | null
  team_name: string
  team_color: string | null
  /** Effectif courant — info descriptive, jamais KPI. */
  member_count: number
  days: Record<string, WeekInterventionCell[]>
}

// ----------------------------------------------------------------------------
// getWeekRange — ISO 8601 (Lundi=1 → Dimanche=7)
// ----------------------------------------------------------------------------

/**
 * Calcule la semaine ISO 8601 contenant la date de référence.
 *
 * - Lundi est le 1er jour (1), Dimanche est le 7e (7).
 * - `weekNumber` est calculé selon ISO 8601 : la semaine 1 contient le
 *   premier jeudi de l'année.
 * - L'`year` retourné est l'année ISO du jeudi de la semaine (peut différer
 *   de l'année civile en bord d'année).
 *
 * Travaille en UTC pour éviter les drifts de timezone côté serveur.
 */
export function getWeekRange(ref: Date | string): WeekRange {
  const d = typeof ref === 'string' ? new Date(ref + 'T00:00:00Z') : new Date(ref)
  d.setUTCHours(0, 0, 0, 0)
  const day = d.getUTCDay() // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const target = new Date(monday)
  target.setUTCDate(target.getUTCDate() + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const weekNumber =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        (firstThursday.getUTCDay() || 7)) /
        7
    )
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
    weekNumber,
    year: target.getUTCFullYear(),
  }
}

// ----------------------------------------------------------------------------
// parseWeekParam / formatWeekParam — URL `?week=2026-W20`
// ----------------------------------------------------------------------------

const WEEK_PARAM_RE = /^(\d{4})-W(\d{1,2})$/

/**
 * Parse un paramètre `?week=YYYY-Www` (ISO 8601) en `WeekRange`.
 *
 * - `undefined` ou chaîne vide → semaine courante (aujourd'hui).
 * - Format invalide → semaine courante (fail-safe pour ne pas casser l'UI).
 */
export function parseWeekParam(raw: string | undefined | null): WeekRange {
  if (!raw) return getWeekRange(new Date())
  const m = WEEK_PARAM_RE.exec(raw.trim())
  if (!m) return getWeekRange(new Date())
  const year = Number(m[1])
  const week = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) {
    return getWeekRange(new Date())
  }
  // ISO 8601 : le jeudi de la semaine est dans l'année ISO. On prend le 4 jan
  // de `year`, qui est toujours dans la semaine 1 ISO, puis on shift de
  // (week - 1) semaines, puis on recalcule via getWeekRange pour normaliser.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  jan4.setUTCDate(jan4.getUTCDate() + (week - 1) * 7)
  return getWeekRange(jan4)
}

/** Inverse de `parseWeekParam` : produit la chaîne canonique `YYYY-Www`. */
export function formatWeekParam(range: WeekRange): string {
  return `${range.year}-W${String(range.weekNumber).padStart(2, '0')}`
}

// ----------------------------------------------------------------------------
// listInterventionsForWeek — fetch des interventions de la fenêtre
// ----------------------------------------------------------------------------

type RawIntervention = {
  id: string
  mission_id: string
  scheduled_for: string | null
  slot: string | null
  status: string
  skipped_at: string | null
  assigned_team_id: string | null
  mission: unknown
  team: unknown
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return value
}

/**
 * Charge toutes les interventions de la semaine [weekStart, weekEnd] avec
 * leurs jointures mission/site/contract/team.
 *
 * Garde-fous :
 * - Filtre `scheduled_for BETWEEN weekStart AND weekEnd` (date pure UTC).
 * - Ignore les interventions sans `scheduled_for` (mission "à date inconnue").
 * - Ignore les interventions dont la mission ou le site ont été soft-deleted
 *   (on ne veut pas exposer une mission archivée dans la grille semaine).
 */
export async function listInterventionsForWeek(
  range: WeekRange
): Promise<WeekInterventionCell[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('interventions')
    .select(
      `
      id,
      mission_id,
      scheduled_for,
      slot,
      status,
      skipped_at,
      assigned_team_id,
      planned_start,
      planned_end,
      mission:missions!inner(
        id,
        name,
        site:sites!inner(
          id,
          name,
          contract:contracts(id, name)
        )
      ),
      team:teams(id, name, color)
    `
    )
    .gte('scheduled_for', range.weekStart)
    .lte('scheduled_for', range.weekEnd)
    .order('scheduled_for', { ascending: true })
    .order('slot', { ascending: true, nullsFirst: true })

  if (error) throw error

  const out: WeekInterventionCell[] = []
  for (const r of (data ?? []) as RawIntervention[]) {
    if (!r.scheduled_for) continue
    const mission = pickOne(r.mission as { name: string; site: unknown } | Array<{ name: string; site: unknown }>)
    if (!mission) continue
    // V5.1 — Exclure les missions système (Traces libres du site) du planning.
    // Ces missions servent uniquement de container pour les traces déposées
    // spontanément côté mobile, elles n'ont jamais à apparaître dans la vue
    // semaine ni dans aucun planning. Cf. lib/db/system-missions.ts.
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(
      mission.site as
        | { id: string; name: string; contract: unknown }
        | Array<{ id: string; name: string; contract: unknown }>
        | null
    )
    if (!site) continue
    const contract = pickOne(
      site.contract as
        | { id: string; name: string }
        | Array<{ id: string; name: string }>
        | null
    )
    const team = pickOne(
      r.team as
        | { id: string; name: string; color: string | null }
        | Array<{ id: string; name: string; color: string | null }>
        | null
    )

    out.push({
      id: r.id,
      mission_id: r.mission_id,
      mission_name: mission.name,
      site_id: site.id,
      site_name: site.name,
      contract_id: contract?.id ?? '',
      contract_name: contract?.name ?? '—',
      scheduled_for: r.scheduled_for,
      slot: r.slot,
      status: r.status,
      skipped_at: r.skipped_at,
      assigned_team_id: r.assigned_team_id,
      assigned_team_name: team?.name ?? null,
      assigned_team_color: team?.color ?? null,
      planned_start: (r as { planned_start?: string | null }).planned_start ?? null,
      planned_end: (r as { planned_end?: string | null }).planned_end ?? null,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// Helper interne : énumération des 7 dates yyyy-mm-dd (Lun → Dim)
// ----------------------------------------------------------------------------

function enumerateWeekDays(weekStart: string): string[] {
  const out: string[] = []
  const start = new Date(weekStart + 'T00:00:00Z')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// ----------------------------------------------------------------------------
// getWeekBySite — agrégation primaire (vue par défaut)
// ----------------------------------------------------------------------------

/**
 * Renvoie une ligne par site, avec une map `days` couvrant les 7 jours de la
 * semaine (clés = `yyyy-mm-dd`, valeurs = tableau d'interventions, possiblement vide).
 *
 * Tri : contract_name ASC, puis site_name ASC.
 */
export async function getWeekBySite(range: WeekRange): Promise<SiteRow[]> {
  const cells = await listInterventionsForWeek(range)
  const days = enumerateWeekDays(range.weekStart)

  // group by site_id
  const bySite = new Map<string, SiteRow>()
  for (const c of cells) {
    let row = bySite.get(c.site_id)
    if (!row) {
      row = {
        site_id: c.site_id,
        site_name: c.site_name,
        contract_id: c.contract_id,
        contract_name: c.contract_name,
        days: Object.fromEntries(days.map((d) => [d, []])),
      }
      bySite.set(c.site_id, row)
    }
    const bucket = row.days[c.scheduled_for]
    if (bucket) bucket.push(c)
  }

  return Array.from(bySite.values()).sort((a, b) => {
    const c = a.contract_name.localeCompare(b.contract_name, 'fr', { sensitivity: 'base' })
    if (c !== 0) return c
    return a.site_name.localeCompare(b.site_name, 'fr', { sensitivity: 'base' })
  })
}

// ----------------------------------------------------------------------------
// getWeekByTeam — agrégation secondaire ("Non-affecté" en dernier)
// ----------------------------------------------------------------------------

/**
 * Renvoie une ligne par équipe avec une map `days` couvrant les 7 jours.
 *
 * - Inclut TOUTES les équipes actives (non archivées), même celles sans
 *   intervention dans la semaine (utile pour visualiser une équipe non sollicitée
 *   sans pour autant en faire un KPI — c'est de l'info descriptive).
 * - La ligne "Non-affecté" (`team_id = null`) regroupe les interventions sans
 *   `assigned_team_id` et apparaît TOUJOURS en DERNIER (bandeau ambre côté UI).
 * - `member_count` est descriptif, JAMAIS utilisé comme métrique.
 */
export async function getWeekByTeam(range: WeekRange): Promise<TeamRow[]> {
  const supabase = createAdminClient()
  const cells = await listInterventionsForWeek(range)
  const days = enumerateWeekDays(range.weekStart)

  // 1) Fetch équipes actives + comptage membres en parallèle
  const [teamsRes, membersRes] = await Promise.all([
    supabase
      .from('teams')
      .select('id, name, color')
      .is('deleted_at', null)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('team_members')
      .select('team_id')
      .is('left_at', null),
  ])
  if (teamsRes.error) throw teamsRes.error
  if (membersRes.error) throw membersRes.error

  const memberCounts = new Map<string, number>()
  for (const m of membersRes.data ?? []) {
    memberCounts.set(m.team_id, (memberCounts.get(m.team_id) ?? 0) + 1)
  }

  const rows = new Map<string, TeamRow>()

  // Initialiser une ligne par équipe active (même celles vides)
  for (const t of (teamsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>) {
    rows.set(t.id, {
      team_id: t.id,
      team_name: t.name,
      team_color: t.color,
      member_count: memberCounts.get(t.id) ?? 0,
      days: Object.fromEntries(days.map((d) => [d, []])),
    })
  }

  // Bucket "Non-affecté"
  const unaffected: TeamRow = {
    team_id: null,
    team_name: 'Non-affecté',
    team_color: null,
    member_count: 0,
    days: Object.fromEntries(days.map((d) => [d, []])),
  }

  // 2) Distribuer les interventions
  for (const c of cells) {
    if (c.assigned_team_id) {
      let row = rows.get(c.assigned_team_id)
      if (!row) {
        // L'équipe est archivée mais conserve des interventions historiques
        // (statuts non-planned) — on l'expose quand même mais en bas, juste
        // avant "Non-affecté", pour transparence (la ligne sera affichée en
        // grisé côté UI).
        row = {
          team_id: c.assigned_team_id,
          team_name: c.assigned_team_name ?? 'Équipe archivée',
          team_color: c.assigned_team_color,
          member_count: 0,
          days: Object.fromEntries(days.map((d) => [d, []])),
        }
        rows.set(c.assigned_team_id, row)
      }
      const bucket = row.days[c.scheduled_for]
      if (bucket) bucket.push(c)
    } else {
      const bucket = unaffected.days[c.scheduled_for]
      if (bucket) bucket.push(c)
    }
  }

  // 3) Tri : équipes par nom (fr, insensible casse), "Non-affecté" en DERNIER
  const teamRows = Array.from(rows.values()).sort((a, b) =>
    a.team_name.localeCompare(b.team_name, 'fr', { sensitivity: 'base' })
  )
  return [...teamRows, unaffected]
}
