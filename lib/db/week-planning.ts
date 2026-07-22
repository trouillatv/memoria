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
import { enumerateRangeDays } from '@/lib/planning/scale'
import type { ProjectableTemplate } from '@/lib/planning/projection'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { isSystemMissionName, PONCTUEL_MISSION_NAME } from '@/lib/db/system-missions'

// Types + helpers PURS (client-safe) extraits dans lib/week-planning-helpers.ts
// pour casser la chaîne d'import qui faisait remonter `admin` (server-only)
// dans le bundle client via WeekNavigation.tsx — vu par Turbopack en build prod.
// Ce fichier reste server-only ; re-export pour la compat des appelants serveur.
export {
  type WeekRange,
  type WeekInterventionCell,
  type SiteRow,
  type TeamRow,
  getWeekRange,
  parseWeekParam,
  formatWeekParam,
} from '@/lib/week-planning-helpers'

import type { WeekRange, WeekInterventionCell, SiteRow, TeamRow } from '@/lib/week-planning-helpers'

// ----------------------------------------------------------------------------
// listInterventionsForWeek — fetch des interventions de la fenêtre
// ----------------------------------------------------------------------------

type RawIntervention = {
  id: string
  mission_id: string
  template_id: string | null
  scheduled_for: string | null
  slot: string | null
  status: string
  skipped_at: string | null
  assigned_team_id: string | null
  /** Objet court d'une intervention ponctuelle (mig 189) — l'affichage. */
  label: string | null
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
  range: WeekRange,
  /** M3 — scope multi-org. Fourni : agrège sur ces organisations (chemin /dashboard).
   *  Omis : résolu via `getOrgIdsOfUser()` — agrège aussi sur toutes les orgs de
   *  l'utilisateur (/semaine, /mois). Fail-closed sur liste vide. */
  orgIds?: string[],
): Promise<WeekInterventionCell[]> {
  const supabase = createAdminClient()
  // FAIL-CLOSED : aucune org → semaine vide, jamais les interventions de tous les tenants.
  let scopeOrgIds: string[]
  if (orgIds) {
    scopeOrgIds = orgIds
  } else {
    const oids = await getOrgIdsOfUser()
    if (oids.length === 0) return []
    scopeOrgIds = oids
  }
  if (scopeOrgIds.length === 0) return []
  const qWeek = supabase
    .from('interventions')
    .select(
      `
      id,
      mission_id,
      template_id,
      scheduled_for,
      slot,
      status,
      skipped_at,
      assigned_team_id,
      planned_start,
      planned_end,
      label,
      mission:missions!inner(
        id,
        name,
        site:sites!inner(
          id,
          name,
          client:clients(name),
          contract:contracts(id, name)
        )
      ),
      team:teams(id, name, color)
    `
    )
    .gte('scheduled_for', range.weekStart)
    .lte('scheduled_for', range.weekEnd)
    .order('scheduled_for', { ascending: true })
    // V6.1 (Vincent 2026-05-20) : ordre par planned_start (heure de
    // prestation honnête) plutôt que slot grossier. Une intervention 06h30
    // se place AVANT une 07h00 ancrage matin (auparavant : même slot →
    // ordre indéterminé). planned_start est non-null pour toutes les rows
    // depuis le backfill migration 071. Fallback NULLS LAST pour les
    // éventuelles legacy qui auraient échappé.
    .order('planned_start', { ascending: true, nullsFirst: false })
    .in('organization_id', scopeOrgIds)

  const { data, error } = await qWeek
  if (error) throw error

  const out: WeekInterventionCell[] = []
  for (const r of (data ?? []) as RawIntervention[]) {
    if (!r.scheduled_for) continue
    const mission = pickOne(r.mission as { name: string; site: unknown } | Array<{ name: string; site: unknown }>)
    if (!mission) continue
    // V5.1 — Exclure les « Traces libres du site » du planning : de simples
    // dépôts spontanés, jamais des prestations. MAIS PAS les « Interventions
    // ponctuelles » (mig 189) : leur MISSION est un conteneur technique
    // invisible comme concept, leurs interventions sont de VRAIS événements
    // terrain — le Mois les comptait, la Semaine les taisait (bug signalé par
    // Vincent, 2026-07-15 : « on ne voit pas le Discount le 13 »).
    if (isSystemMissionName(mission.name) && mission.name !== PONCTUEL_MISSION_NAME) continue
    const site = pickOne(
      mission.site as
        | { id: string; name: string; client: unknown; contract: unknown }
        | Array<{ id: string; name: string; client: unknown; contract: unknown }>
        | null
    )
    if (!site) continue
    const client = pickOne(site.client as { name: string } | Array<{ name: string }> | null)
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
      // Une ponctuelle s'affiche par son OBJET (« Remise en état hall B »),
      // jamais par le nom de son conteneur technique (doctrine mig 189).
      mission_name: r.label?.trim() || mission.name,
      site_id: site.id,
      site_name: site.name,
      client_name: client?.name ?? null,
      contract_id: contract?.id ?? '',
      contract_name: contract?.name ?? '—',
      scheduled_for: r.scheduled_for,
      slot: r.slot,
      status: r.status,
      skipped_at: r.skipped_at,
      assigned_team_id: r.assigned_team_id,
      assigned_team_name: team?.name ?? null,
      assigned_team_color: team?.color ?? null,
      template_id: r.template_id ?? null,
      planned_start: (r as { planned_start?: string | null }).planned_start ?? null,
      planned_end: (r as { planned_end?: string | null }).planned_end ?? null,
    })
  }
  return out
}

// ----------------------------------------------------------------------------
// Helper interne : énumération des 7 dates yyyy-mm-dd (Lun → Dim)
// ----------------------------------------------------------------------------

/**
 * Les jours de la plage — bornes incluses.
 *
 * Cette fonction ignorait `weekEnd` et comptait sept jours à partir du lundi :
 * c'était LE verrou qui clouait le chargeur à la semaine. La plage décide
 * désormais. Pour une semaine, le résultat est rigoureusement identique — sept
 * jours, du lundi au dimanche.
 */
function enumerateWeekDays(range: WeekRange): string[] {
  return enumerateRangeDays({ start: range.weekStart, end: range.weekEnd })
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
export async function getWeekBySite(range: WeekRange, orgIds?: string[]): Promise<SiteRow[]> {
  const cells = await listInterventionsForWeek(range, orgIds)
  const days = enumerateWeekDays(range)

  // group by site_id
  const bySite = new Map<string, SiteRow>()
  for (const c of cells) {
    let row = bySite.get(c.site_id)
    if (!row) {
      row = {
        site_id: c.site_id,
        site_name: c.site_name,
        client_name: c.client_name ?? null,
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
  // M3 — agrégé sur les organisations de l'utilisateur. FAIL-CLOSED : aucune
  // appartenance → aucune ligne, jamais les équipes de tous les tenants.
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  const cells = await listInterventionsForWeek(range, orgIds)
  const days = enumerateWeekDays(range)

  // 1) Fetch équipes actives DES ORGANISATIONS + comptage membres en parallèle
  const [teamsRes, membersRes] = await Promise.all([
    supabase
      .from('teams')
      .select('id, name, color')
      .is('deleted_at', null)
      .eq('active', true)
      .in('organization_id', orgIds)
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


// ── PL exceptions — les RYTHMES dont les occurrences affichées sont issues ──
//
// Pour dire « ceci est une exception », il faut comparer l'occurrence à ce que
// son rythme prescrit. Une requête pour toute la grille.

// Le MEME contrat que le moteur de projection : c'est lui qui compare
// l'occurrence au rythme. Un type parallele divergerait un jour.
export interface WeekTemplate extends ProjectableTemplate {
  assigned_team_id: string | null
}

export async function listTemplatesByIds(ids: string[]): Promise<Record<string, WeekTemplate>> {
  if (ids.length === 0) return {}
  const { data, error } = await createAdminClient()
    .from('intervention_templates')
    .select(
      'id, mission_id, frequency, slots, day_of_week, day_of_month, planned_start_hhmm, planned_end_hhmm, starts_on, ends_on, cycle_length_weeks, anchor_date, week_index, assigned_team_id',
    )
    .in('id', [...new Set(ids)])
  if (error) return {}

  const out: Record<string, WeekTemplate> = {}
  for (const r of (data ?? []) as WeekTemplate[]) out[r.id] = r
  return out
}
