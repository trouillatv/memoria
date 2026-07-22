// Phase 9 — Vue Semaine · Sprint 1 : agrégateur de SIGNAUX opérationnels
//
// Lecture seule. Ce module ne crée, ne modifie, ne planifie RIEN. Il fenêtre
// sur une semaine ISO les signaux déjà saisis ailleurs et les présente par site,
// afin que la grille Site × Jour puisse, plus tard, poser un repère DISCRET et
// INDICATIF. Deux natures de signal, volontairement séparées :
//
//   - `days`     : ÉVÉNEMENTS PONCTUELS datés → posés sur une cellule jour.
//                  (réunion de chantier, échéance d'action, livraison)
//   - `standing` : CONDITIONS EN COURS sur la semaine, sans jour propre, avec
//                  une ANCIENNETÉ (`since`) → « ouverte depuis 47 jours ».
//                  (blocage en cours, réserve encore ouverte)
//
// Un conducteur de travaux veut voir une réserve ouverte depuis 3 semaines, pas
// seulement celles créées dans la fenêtre : une condition pèse tant qu'elle dure.
// C'est pourquoi blocages et réserves ne sont PAS fenêtrés sur leur date de
// création mais sur leur état (en cours / ouvert) — leur date sert d'ancienneté.
//
// ─────────────────────────────────────────────────────────────────────────────
// 3 RÈGLES GRAVÉES (ne pas transgresser, ni ici ni chez les appelants) :
//
//   1. LECTURE SEULE. Aucune mutation. On ne touche ni à l'UI existante ni au
//      drag du planning. Un signal n'altère JAMAIS une intervention, ne déplace
//      rien, ne bloque aucun glisser-déposer. Indicatif, jamais bloquant.
//
//   2. SUJET = LIEU. Le grain est le SITE (et le jour). Jamais une personne :
//      aucun score, aucun %, aucun classement, aucune imputation, aucune charge
//      par équipe ni par individu. On compte des signaux d'un lieu, pas des gens.
//
//   3. PROJECTION, PAS VÉRITÉ. Ces signaux DOCUMENTENT un état connu ; ils ne le
//      décrètent pas. On ne réinvente pas la donnée (la météo reste dans
//      site_day_log, la réserve reste « ouverte » tant que non levée). On fenêtre
//      et on pointe — on ne recopie ni ne dérive un nouvel état autoritaire.
// ─────────────────────────────────────────────────────────────────────────────
//
// Scoping : par `site_id IN (sites de l'org)`. On ne parie pas sur
// `organization_id` peuplé sur chaque table de signal — on dérive d'abord la
// liste des sites de l'org (source de vérité du périmètre), puis on fenêtre
// chaque couche par cette liste.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import type { WeekRange } from '@/lib/week-planning-helpers'

// Types + helpers PURS (client-safe) extraits dans week-operational-signals-helpers
// pour ne pas faire remonter `admin` (server-only) dans un bundle client qui
// importerait ces types. Ce fichier reste server-only ; re-export pour compat.
export {
  type WeekDayKind,
  type WeekStandingKind,
  type WeekSignalKind,
  type WeekOperationalSignal,
  type SiteWeekSignals,
  ageInDays,
} from '@/lib/week-operational-signals-helpers'

import type {
  WeekOperationalSignal,
  SiteWeekSignals,
} from '@/lib/week-operational-signals-helpers'

// Énumération des 7 dates yyyy-mm-dd (Lun → Dim) — même logique que week-planning.
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

// Dégradation gracieuse si une migration de couche n'est pas encore appliquée
// (ex. blocages mig 160, livraisons mig 109) — couche vide plutôt qu'échec global.
// IMPORTANT : PostgREST signale une table absente via le code `PGRST205` et le
// message « Could not find the table … in the schema cache » — qui ne contient
// NI `42P01` NI `does not exist`. On couvre les deux mondes (Postgres direct +
// PostgREST/schema-cache), comme les helpers site-blocages / site-delivery.
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = (error.message ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  )
}

/**
 * Agrège les signaux opérationnels de la semaine, par site.
 *
 * Événements datés (→ `days`, fenêtrés sur la semaine, dates pures yyyy-mm-dd) :
 *   - meeting    : next_meeting_at ∈ semaine (réunion de chantier prévue).
 *   - action_due : due_date ∈ semaine, status open|planned (échéances à venir).
 *   - delivery   : delivered_on ∈ semaine (livraison reçue / attendue).
 *
 * Conditions en cours (→ `standing`, PAS fenêtrées sur leur création) :
 *   - blocage      : chevauche la semaine (date_start ≤ fin ET date_end null|≥ début).
 *   - reserve_open : status='open' quel que soit l'âge (since = issued_on).
 *
 * Ne renvoie QUE les sites ayant ≥ 1 signal (daté OU en cours). Tri : contrat
 * puis site (fr, insensible casse), comme getWeekBySite.
 */
export async function getWeekOperationalSignals(
  range: WeekRange
): Promise<SiteWeekSignals[]> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  const { weekStart, weekEnd } = range
  const days = enumerateWeekDays(weekStart)

  // 1) Périmètre : sites de l'org (source de vérité du scope), + contrat pour le tri.
  let sitesQ = supabase
    .from('sites')
    .select('id, name, contract_id, contract:contracts(id, name)')
    .is('deleted_at', null)
  sitesQ = sitesQ.in('organization_id', orgIds)
  const { data: sitesData, error: sitesErr } = await sitesQ
  if (sitesErr) throw sitesErr

  type SiteMeta = { name: string; contractId: string | null; contractName: string | null }
  const siteMeta = new Map<string, SiteMeta>()
  const siteIds: string[] = []
  for (const s of (sitesData ?? []) as Array<{
    id: string
    name: string
    contract_id: string | null
    contract: { id: string; name: string } | { id: string; name: string }[] | null
  }>) {
    const c = Array.isArray(s.contract) ? s.contract[0] ?? null : s.contract
    siteMeta.set(s.id, {
      name: s.name,
      contractId: s.contract_id ?? c?.id ?? null,
      contractName: c?.name ?? null,
    })
    siteIds.push(s.id)
  }
  if (siteIds.length === 0) return []

  // 2) Les 5 couches, fenêtrées par site_id IN (sites de l'org), en parallèle.
  const [meetingsRes, actionsRes, deliveriesRes, blocagesRes, reservesRes] = await Promise.all([
    // — Événements datés —
    supabase
      .from('site_reports')
      .select('id, site_id, title, next_meeting_at')
      .in('site_id', siteIds)
      .not('next_meeting_at', 'is', null)
      .gte('next_meeting_at', weekStart)
      .lte('next_meeting_at', weekEnd),
    supabase
      .from('site_actions')
      .select('id, site_id, title, corps_etat, due_date, status')
      .in('site_id', siteIds)
      .in('status', ['open', 'planned'])
      .gte('due_date', weekStart)
      .lte('due_date', weekEnd),
    supabase
      .from('site_delivery')
      .select('id, site_id, supplier, material, zone, delivered_on')
      .in('site_id', siteIds)
      .gte('delivered_on', weekStart)
      .lte('delivered_on', weekEnd),
    // — Conditions en cours (PAS de fenêtrage sur la création) —
    supabase
      .from('site_blocages')
      .select('id, site_id, title, type, date_start, date_end')
      .in('site_id', siteIds)
      .lte('date_start', weekEnd)
      .or(`date_end.is.null,date_end.gte.${weekStart}`),
    supabase
      .from('site_reserve')
      .select('id, site_id, label, location, issued_on, status')
      .in('site_id', siteIds)
      .eq('status', 'open'),
  ])

  // Une couche absente (migration non appliquée) ne fait pas échouer le tout.
  for (const res of [meetingsRes, actionsRes, deliveriesRes, blocagesRes, reservesRes]) {
    if (res.error && !isMissingTable(res.error)) throw res.error
  }

  // 3) Accumulation par site.
  const rows = new Map<string, SiteWeekSignals>()
  const ensureRow = (siteId: string): SiteWeekSignals | null => {
    const meta = siteMeta.get(siteId)
    if (!meta) return null // signal d'un site hors scope/soft-deleted → ignoré
    let row = rows.get(siteId)
    if (!row) {
      row = {
        siteId,
        siteName: meta.name,
        contractId: meta.contractId,
        contractName: meta.contractName,
        days: Object.fromEntries(days.map((d) => [d, []])),
        standing: [],
        total: 0,
      }
      rows.set(siteId, row)
    }
    return row
  }
  const pushDay = (siteId: string, day: string, signal: WeekOperationalSignal) => {
    const row = ensureRow(siteId)
    if (!row) return
    const bucket = row.days[day]
    if (!bucket) return
    bucket.push(signal)
    row.total += 1
  }
  const pushStanding = (siteId: string, signal: WeekOperationalSignal) => {
    const row = ensureRow(siteId)
    if (!row) return
    row.standing.push(signal)
    row.total += 1
  }

  // — Événements datés —
  for (const m of (meetingsRes.data ?? []) as Array<{
    id: string; site_id: string | null; title: string | null; next_meeting_at: string | null
  }>) {
    if (!m.site_id || !m.next_meeting_at) continue
    pushDay(m.site_id, m.next_meeting_at, {
      id: m.id,
      kind: 'meeting',
      day: m.next_meeting_at,
      label: m.title?.trim() || 'Réunion de chantier',
      detail: null,
      since: null,
    })
  }

  for (const a of (actionsRes.data ?? []) as Array<{
    id: string; site_id: string; title: string | null; corps_etat: string | null
    due_date: string | null
  }>) {
    if (!a.due_date) continue
    pushDay(a.site_id, a.due_date, {
      id: a.id,
      kind: 'action_due',
      day: a.due_date,
      label: a.title?.trim() || 'Échéance',
      detail: a.corps_etat,
      since: null,
    })
  }

  for (const d of (deliveriesRes.data ?? []) as Array<{
    id: string; site_id: string | null; supplier: string | null; material: string | null
    zone: string | null; delivered_on: string | null
  }>) {
    if (!d.site_id || !d.delivered_on) continue
    pushDay(d.site_id, d.delivered_on, {
      id: d.id,
      kind: 'delivery',
      day: d.delivered_on,
      label: d.material?.trim() || d.supplier?.trim() || 'Livraison',
      detail: d.supplier?.trim() || d.zone,
      since: null,
    })
  }

  // — Conditions en cours —
  for (const b of (blocagesRes.data ?? []) as Array<{
    id: string; site_id: string; title: string | null; type: string | null
    date_start: string; date_end: string | null
  }>) {
    pushStanding(b.site_id, {
      id: b.id,
      kind: 'blocage',
      day: null,
      label: b.title?.trim() || 'Blocage',
      detail: b.type,
      since: b.date_start ?? null,
    })
  }

  for (const r of (reservesRes.data ?? []) as Array<{
    id: string; site_id: string; label: string | null; location: string | null
    issued_on: string | null
  }>) {
    pushStanding(r.site_id, {
      id: r.id,
      kind: 'reserve_open',
      day: null,
      label: r.label?.trim() || 'Réserve',
      detail: r.location,
      since: r.issued_on ?? null,
    })
  }

  // 4) Sites sans signal exclus ; tri contrat puis site (fr, insensible casse).
  return Array.from(rows.values()).sort((a, b) => {
    const ca = a.contractName ?? ''
    const cb = b.contractName ?? ''
    const c = ca.localeCompare(cb, 'fr', { sensitivity: 'base' })
    if (c !== 0) return c
    return a.siteName.localeCompare(b.siteName, 'fr', { sensitivity: 'base' })
  })
}
