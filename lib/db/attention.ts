// lib/db/attention.ts
//
// « Ce qui mérite votre attention » — agrégation TRANSVERSE des détecteurs
// opérationnels déjà existants (actions en retard / anciennes, réserves ouvertes)
// sur TOUS les chantiers visibles de l'organisation. Pas « ses chantiers » (pas de
// doctrine RH/responsabilité). 100 % DÉTERMINISTE, zéro LLM, zéro score de personne.
//
// Sujet = le CHANTIER qui mérite l'attention, jamais la performance d'un acteur.
// Chaque item répond à : QUOI · POURQUOI maintenant · OÙ cliquer. Plafonné.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { OrganisationAmbigueError } from '@/lib/auth/organisation-ambigue'
import { listOpenSiteActions, actionHealth, type SiteActionRow } from '@/lib/db/site-actions'
import { todayLocalIso } from '@/lib/time/local-date'
import { getWeekRange } from '@/lib/week-planning-helpers'
import { getWeekBySite } from '@/lib/db/week-planning'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { detectClosureConflicts } from '@/lib/planning/conflicts'
import { listKeptInterventionIds } from '@/lib/db/closure-decisions'
import {
  buildConflictItems,
  buildDebriefItems,
  buildClosedToday,
  type ClosedSite,
  type PendingDebrief,
} from '@/lib/attention/digest-items'

export type AttentionTier = 'red' | 'orange'
export interface AttentionItem {
  tier: AttentionTier
  /** QUOI — « 2 actions en retard ». */
  what: string
  /** OÙ — nom du chantier. */
  where: string
  /** POURQUOI maintenant — « la plus en retard : « … » (+12 j) ». */
  why: string
  href: string
  /** M3 — provenance PAR ÉLÉMENT (compte multi-org). Deux actions de deux
   *  organisations dans le même bloc gardent chacune la leur. */
  organizationId: string
}
export interface AttentionDigest {
  red: AttentionItem[]
  orange: AttentionItem[]
  /** Chantiers sans aucune alerte rouge/orange (« en rythme »). */
  greenSites: number
  totalSites: number
  /** Fermés aujourd'hui. Un fait de la journée, PAS une alerte. */
  closedToday: ClosedSite[]
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}
function trunc(s: string, n = 48): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

export async function getAttentionDigest(limit = 5): Promise<AttentionDigest> {
  const sb = createAdminClient()
  // M3 — était `getOrgId().catch(() => null)` : en multi-org, `null` → AUCUN
  // filtre → lecture INTER-TENANTS (fuite). Désormais agrégé + fail-closed.
  const orgIds = await getOrgIdsOfUser()

  const { data: siteRows } = await sb
    .from('sites').select('id, name, organization_id').is('deleted_at', null).in('organization_id', orgIds)
  const sites = (siteRows ?? []) as Array<{ id: string; name: string; organization_id: string }>
  const totalSites = sites.length
  if (totalSites === 0)
    return { red: [], orange: [], greenSites: 0, totalSites: 0, closedToday: [] }

  const siteIds = sites.map((s) => s.id)
  const nameOf = new Map(sites.map((s) => [s.id, s.name]))
  const orgOf = new Map(sites.map((s) => [s.id, s.organization_id])) // provenance par chantier
  const today = todayLocalIso()

  // La semaine en cours : c'est l'horizon du matin. Un conflit dans trois
  // semaines n'a rien à faire ici.
  const week = getWeekRange(new Date())

  // M3 — on PASSE `orgIds` aux helpers qui, sinon, appelleraient `getOrgId()` et
  // lèveraient `OrganisationAmbigueError` en multi-org. Après cette transmission,
  // l'erreur de PORTÉE est IMPOSSIBLE sur ce chemin : si elle réapparaissait, elle
  // doit REMONTER (échec franc, régression visible), jamais devenir une liste vide.
  // Le catch n'absorbe qu'une VRAIE panne technique, et la trace.
  const guard = <T>(label: string, fallback: T) => (e: unknown): T => {
    if (e instanceof OrganisationAmbigueError) throw e // faute de portée → jamais masquée
    console.error(`[attention] ${label}`, e)
    return fallback
  }
  const [actions, reservesRes, weekRows, closuresBySite, pendingDebriefs] = await Promise.all([
    listOpenSiteActions({ siteIds, orgIds }).catch(guard('actions', [] as SiteActionRow[])),
    sb.from('site_reserve').select('site_id, label, created_at').in('site_id', siteIds).eq('status', 'open'),
    getWeekBySite(week, orgIds).catch(guard('semaine', [] as Awaited<ReturnType<typeof getWeekBySite>>)),
    listActiveClosuresForSites(siteIds, week.weekStart, week.weekEnd).catch(guard('clôtures', {} as Record<string, SiteClosure[]>)),
    listPendingDebriefs(siteIds).catch(guard('débriefs', [] as PendingDebrief[])),
  ])

  type Agg = { overdue: SiteActionRow[]; oldOpen: SiteActionRow[]; reserves: Array<{ created_at: string }> }
  const agg = new Map<string, Agg>()
  const get = (id: string): Agg => {
    let a = agg.get(id); if (!a) { a = { overdue: [], oldOpen: [], reserves: [] }; agg.set(id, a) } return a
  }
  for (const a of actions) {
    if (a.due_date && a.due_date < today) get(a.site_id).overdue.push(a)
    else if (actionHealth(a.created_at) === 'critique') get(a.site_id).oldOpen.push(a)
  }
  for (const r of (reservesRes.data ?? []) as Array<{ site_id: string; created_at: string }>) get(r.site_id).reserves.push(r)

  const red: AttentionItem[] = []
  const orange: AttentionItem[] = []
  const flagged = new Set<string>()

  // 🔴 CONFLITS — le même détecteur que la vue Semaine (PL3). Une seule vérité.
  //
  // ⚠️ Y COMPRIS LES DÉCISIONS. Sans cette lecture, une prestation MAINTENUE
  // continuerait d'alerter ici alors que la semaine, elle, se tairait : deux
  // écrans qui se contredisent sur le même fait. Le matin, c'est le pire endroit
  // pour crier une alerte déjà tranchée.
  const rowsInScope = weekRows.filter((r) => siteIds.includes(r.site_id))
  const keptInterventionIds = await listKeptInterventionIds(
    rowsInScope.flatMap((r) => Object.values(r.days).flat().map((c) => c.id)),
  ).catch(() => new Set<string>())

  const conflictsBySite = detectClosureConflicts({
    rows: rowsInScope,
    closuresBySite,
    keptInterventionIds,
  })
  for (const item of buildConflictItems(conflictsBySite, nameOf, orgOf)) red.push(item)
  for (const siteId of Object.keys(conflictsBySite)) flagged.add(siteId)

  // 🟠 DÉBRIEFS EN ATTENTE — une visite finie dont les captures dorment.
  for (const item of buildDebriefItems(pendingDebriefs, nameOf, today, orgOf)) orange.push(item)
  for (const p of pendingDebriefs) if (p.remaining > 0) flagged.add(p.siteId)

  for (const [siteId, a] of agg) {
    const where = nameOf.get(siteId) ?? '—'
    const organizationId = orgOf.get(siteId) ?? ''

    // 🔴 Actions en retard.
    if (a.overdue.length > 0) {
      flagged.add(siteId)
      const oldest = a.overdue.reduce((o, x) => ((x.due_date ?? '') < (o.due_date ?? '') ? x : o))
      const late = oldest.due_date ? ageDays(oldest.due_date) : 0
      red.push({
        tier: 'red',
        what: `${a.overdue.length} action${a.overdue.length > 1 ? 's' : ''} en retard`,
        where,
        why: `la plus en retard : « ${trunc(oldest.title)} » (+${late} j)`,
        href: `/sites/${siteId}/actions`,
        organizationId,
      })
    }

    // Réserves ouvertes → 🔴 si la plus ancienne ≥ 30 j, sinon 🟠.
    if (a.reserves.length > 0) {
      flagged.add(siteId)
      const oldest = a.reserves.reduce((o, x) => (x.created_at < o.created_at ? x : o))
      const age = ageDays(oldest.created_at)
      const item: AttentionItem = {
        tier: age >= 30 ? 'red' : 'orange',
        what: `${a.reserves.length} réserve${a.reserves.length > 1 ? 's' : ''} ouverte${a.reserves.length > 1 ? 's' : ''}`,
        where,
        why: `la plus ancienne depuis ${age} j`,
        href: `/sites/${siteId}/reserves`,
        organizationId,
      }
      ;(item.tier === 'red' ? red : orange).push(item)
    }

    // 🟠 Actions anciennes (pas encore en retard mais qui traînent).
    if (a.oldOpen.length > 0) {
      flagged.add(siteId)
      const oldest = a.oldOpen.reduce((o, x) => (x.created_at < o.created_at ? x : o))
      orange.push({
        tier: 'orange',
        what: `${a.oldOpen.length} action${a.oldOpen.length > 1 ? 's' : ''} ancienne${a.oldOpen.length > 1 ? 's' : ''}`,
        where,
        why: `ouverte depuis ${ageDays(oldest.created_at)} j`,
        href: `/sites/${siteId}/actions`,
        organizationId,
      })
    }
  }

  // Plafond : rouge d'abord, puis orange, total = limit.
  const cappedRed = red.slice(0, limit)
  const cappedOrange = orange.slice(0, Math.max(0, limit - cappedRed.length))

  // Fermés aujourd'hui : dit, jamais alarmé — et ne compte pas comme « flaggé ».
  const closedToday = buildClosedToday(closuresBySite, nameOf, today)

  const greenSites = Math.max(0, totalSites - [...flagged].filter((id) => nameOf.has(id)).length)
  return { red: cappedRed, orange: cappedOrange, greenSites, totalSites, closedToday }
}

/**
 * Les visites TERMINÉES dont des captures sont restées non triées, sur les
 * chantiers de l'organisation. Fait déclaré, jamais une inférence sur qui aurait
 * dû débriefer.
 */
async function listPendingDebriefs(siteIds: string[]): Promise<PendingDebrief[]> {
  const sb = createAdminClient()

  const { data: reportRows } = await sb
    .from('site_reports')
    .select('id, site_id, ended_at')
    .in('site_id', siteIds)
    .not('origin', 'is', null) // une visite (une réunion a origin null)
    .not('ended_at', 'is', null)
    .is('deleted_at', null)
    .order('ended_at', { ascending: false })
    .limit(40)

  const reports = (reportRows ?? []) as Array<{ id: string; site_id: string; ended_at: string | null }>
  if (reports.length === 0) return []

  // Une seule requête pour toutes les captures — pas un compte par visite.
  const { data: captureRows } = await sb
    .from('visit_capture')
    .select('report_id')
    .in('report_id', reports.map((r) => r.id))
    .eq('status', 'captured')

  const remaining = new Map<string, number>()
  for (const c of (captureRows ?? []) as Array<{ report_id: string }>) {
    remaining.set(c.report_id, (remaining.get(c.report_id) ?? 0) + 1)
  }

  return reports
    .filter((r) => (remaining.get(r.id) ?? 0) > 0)
    .map((r) => ({
      reportId: r.id,
      siteId: r.site_id,
      remaining: remaining.get(r.id) ?? 0,
      endedAt: r.ended_at,
    }))
}
