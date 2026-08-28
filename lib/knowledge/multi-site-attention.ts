// P0-D — Moteur d'attention multi-site
//
// Classe les chantiers de l'utilisateur par niveau d'attention requis.
// Doctrine : Aujourd'hui classe les CHANTIERS, pas les sujets.
// Les sujets servent à expliquer pourquoi un chantier est remonté.
//
// Score = topSubjectScore + modifiers temporels et volumétriques.
// Gravité d'abord (sujet le plus urgent du chantier), contexte ensuite.
// Zéro LLM. Zéro score affiché à l'utilisateur.

import 'server-only'
import { TERRAIN_VISIT_ORIGINS } from '@/lib/field/visit-origins'

import { createAdminClient } from '@/lib/supabase/admin'
import { listSites } from '@/lib/db/sites'
import { deriveCanonicalAttentionItems, type CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SiteAttentionScore {
  siteId: string
  siteName: string
  score: number
  contributions: {
    topSubjectScore: number
    highCountBoost: number
    overdueObjectBoost: number
    pendingDebriefBoost: number
    upcomingVisitBoost: number
    longNoVisitBoost: number
  }
  /** Urgence du sujet le plus grave — dicte l'affichage du badge site */
  urgency: 'critical' | 'high' | 'medium' | 'low' | 'none'
  /** 1-2 sujets représentatifs pour expliquer le classement */
  topSubjects: CanonicalAttentionItem[]
  lastVisitAt: string | null
  nextVisitAt: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86_400_000)
}

// Classe basée sur l'ancienneté de la dernière visite — pas de croissance linéaire.
// récent (≤30j) → 0 / à revoir (31-90j) → 5 / très ancien (>90j ou aucune visite) → 8
function computeLongNoVisitBoost(lastVisitAt: string | null, today: string): number {
  if (!lastVisitAt) return 8
  const days = daysBetween(lastVisitAt.slice(0, 10), today)
  if (days <= 30) return 0
  if (days <= 90) return 5
  return 8
}

function scoreToUrgency(score: number): SiteAttentionScore['urgency'] {
  if (score === 0) return 'none'
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

// ── Moteur ────────────────────────────────────────────────────────────────────

export async function deriveMultiSiteAttention(
  opts: {
    limit?: number
    concurrency?: number
    today?: string
    /** Bypass listSites() — pour les scripts CLI hors Next.js request scope */
    siteIds?: string[]
  } = {},
): Promise<SiteAttentionScore[]> {
  const limit = opts.limit ?? 10
  const concurrencyLimit = Math.min(opts.concurrency ?? 8, 10)
  const today = opts.today ?? todayIso()
  const admin = createAdminClient()

  // ── 1. Chantiers — via listSites() (Next.js request) ou siteIds directs ──
  let sites: Array<{ id: string; name: string }>
  if (opts.siteIds && opts.siteIds.length > 0) {
    const { data } = await admin
      .from('sites')
      .select('id, name')
      .in('id', opts.siteIds)
      .is('deleted_at', null)
      .order('name')
    sites = (data ?? []) as Array<{ id: string; name: string }>
  } else {
    sites = await listSites()
  }
  if (sites.length === 0) return []
  const siteIds = sites.map(s => s.id)

  // ── 2. Round A — données temporelles batchées ─────────────────────────────
  // (a) Dernières visites + IDs rapports pour débriefs
  // (b) Missions pour résoudre les interventions planifiées
  type SiteReportRow = { id: string; site_id: string; started_at: string | null }
  type MissionRow    = { id: string; site_id: string }

  const [siteReportRes, missionRes] = await Promise.all([
    admin
      .from('site_reports')
      .select('id, site_id, started_at')
      .in('site_id', siteIds)
      // Dernière VISITE TERRAIN par site : un import historique ne prouve pas une visite (P0.5-Vérité).
      .in('origin', TERRAIN_VISIT_ORIGINS)
      .not('ended_at', 'is', null)
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(Math.max(40, siteIds.length * 5)),
    admin
      .from('missions')
      .select('id, site_id')
      .in('site_id', siteIds)
      .is('deleted_at', null),
  ])

  const reports = (siteReportRes.data ?? []) as SiteReportRow[]
  const lastVisitBySite = new Map<string, string>()
  for (const r of reports) {
    if (r.started_at && !lastVisitBySite.has(r.site_id)) {
      lastVisitBySite.set(r.site_id, r.started_at)
    }
  }

  const missionToSite = new Map<string, string>()
  for (const m of (missionRes.data ?? []) as MissionRow[]) {
    missionToSite.set(m.id, m.site_id)
  }

  // ── 3. Round B — visites imminentes + débriefs en attente ─────────────────
  const missionIds = [...missionToSite.keys()]
  const reportIds  = reports.slice(0, 40).map(r => r.id)

  type InterventionRow = { mission_id: string; scheduled_at: string | null }
  type CaptureRow      = { report_id: string }

  const [nextVisitRes, captureRes] = await Promise.all([
    missionIds.length > 0
      ? admin
          .from('interventions')
          .select('mission_id, scheduled_at')
          .in('mission_id', missionIds)
          .eq('status', 'planned')
          .gte('scheduled_at', today)
          .lt('scheduled_at', addDays(today, 3))   // ≤48h depuis le début de aujourd'hui
          .order('scheduled_at', { ascending: true })
      : Promise.resolve({ data: null }),
    reportIds.length > 0
      ? admin
          .from('visit_capture')
          .select('report_id')
          .in('report_id', reportIds)
          .eq('status', 'captured')
      : Promise.resolve({ data: null }),
  ])

  const nextVisitBySite = new Map<string, string>()
  for (const r of (nextVisitRes.data ?? []) as InterventionRow[]) {
    const siteId = r.mission_id ? missionToSite.get(r.mission_id) : undefined
    if (!siteId || !r.scheduled_at || nextVisitBySite.has(siteId)) continue
    nextVisitBySite.set(siteId, r.scheduled_at)
  }

  // Débriefs en attente par site
  const pendingByReport = new Map<string, number>()
  for (const c of (captureRes.data ?? []) as CaptureRow[]) {
    pendingByReport.set(c.report_id, (pendingByReport.get(c.report_id) ?? 0) + 1)
  }
  const pendingDebriefBySite = new Map<string, number>()
  for (const r of reports.slice(0, 40)) {
    const n = pendingByReport.get(r.id) ?? 0
    if (n > 0) pendingDebriefBySite.set(r.site_id, (pendingDebriefBySite.get(r.site_id) ?? 0) + n)
  }

  // ── 4. Score par chantier (appel canonical attention en parallèle) ─────────
  const scored: SiteAttentionScore[] = []

  for (let i = 0; i < sites.length; i += concurrencyLimit) {
    const batch = sites.slice(i, i + concurrencyLimit)
    const batchResults = await Promise.all(
      batch.map(async (site) => {
        const items = await deriveCanonicalAttentionItems(site.id, { limit: 5, today }).catch(() => [] as CanonicalAttentionItem[])
        if (items.length === 0) return null

        const top = items[0]
        const topSubjectScore = top.score

        // Volume HIGH+ : chaque sujet high ou critique au-delà du premier ajoute 3 pts, max +15
        const highCount = items.filter(it => it.score >= 65).length
        const highCountBoost = Math.min(highCount * 3, 15)

        // Objets en retard : actions overdue dans les sujets retenus, max +15
        const overdueCount = items.filter(it => it.signals.includes('action_overdue')).length
        const overdueObjectBoost = Math.min(overdueCount * 5, 15)

        // Débrief en attente : visite terminée avec captures non triées
        const debriefs = pendingDebriefBySite.get(site.id) ?? 0
        const pendingDebriefBoost = debriefs === 0 ? 0 : debriefs === 1 ? 5 : 10

        // Visite imminente (≤48h) : légère hausse de pertinence — jamais déterminant
        const nextVisitAt = nextVisitBySite.get(site.id) ?? null
        const upcomingVisitBoost = nextVisitAt ? 8 : 0

        // Ancienneté de la dernière visite (classe, pas croissance linéaire)
        const lastVisitAt = lastVisitBySite.get(site.id) ?? null
        const longNoVisitBoost = computeLongNoVisitBoost(lastVisitAt, today)

        const score = topSubjectScore + highCountBoost + overdueObjectBoost + pendingDebriefBoost + upcomingVisitBoost + longNoVisitBoost

        return {
          siteId: site.id,
          siteName: site.name,
          score,
          contributions: { topSubjectScore, highCountBoost, overdueObjectBoost, pendingDebriefBoost, upcomingVisitBoost, longNoVisitBoost },
          urgency: scoreToUrgency(topSubjectScore),
          topSubjects: items.slice(0, 2),
          lastVisitAt,
          nextVisitAt,
        } satisfies SiteAttentionScore
      }),
    )
    for (const r of batchResults) {
      if (r) scored.push(r)
    }
  }

  // ── 5. Tri déterministe : score DESC → nom ASC ────────────────────────────
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.siteName.localeCompare(b.siteName)
  })

  return scored.slice(0, limit)
}
