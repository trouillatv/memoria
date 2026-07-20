// ── PAGE INTERVENANTS (pilotage) — agrégateur PUR ────────────────────────────
// Projection de la vue existante vers un leaderboard + KPIs. Ne RÉIMPLÉMENTE PAS
// buildIntervenantPeople : il consomme ses `IntervenantPerson` et n'ajoute que le
// spécifique « vue d'ensemble » (engagements, tri, classement). Les KPIs sont
// calculés depuis LES MÊMES lignes que le tableau (jamais une source parallèle).
// Aucune dépendance serveur → testable en vitest.

import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'

/** Seuil « sans activité récente » — le MÊME partout (KPI et badge). */
export const IDLE_DAYS = 30

export interface IntervenantRow {
  intervenantId: string
  contactId: string | null
  isPerson: boolean
  name: string
  role: string
  companyName: string
  openActions: number
  lateActions: number
  decisionsCount: number
  openObligationsCount: number
  /** Engagements ACTIFS = actions ouvertes + obligations ouvertes (pas les décisions,
   *  qui sont un historique porté, pas une charge active). */
  engagementsActifs: number
  citedVisitsCount: number
  lastActivity: string | null
  daysSinceActivity: number | null
  isIdle: boolean
  otherSitesCount: number
  isMultiSite: boolean
  /** Ouvre la fiche existante (deep-link ?person=). */
  href: string
}

export interface IntervenantsDashboardKpis {
  engagementsActifs: number
  lateTotal: number
  latePeople: number
  idleCount: number
  multiSiteCount: number
  validatedCount: number
}

export interface IntervenantsDashboard {
  siteId: string
  rows: IntervenantRow[]
  kpis: IntervenantsDashboardKpis
  /** Personnes citées en attente de validation (pipeline IA, JAMAIS mêlé au leaderboard). */
  toIdentifyCount: number
}

function toUtcDay(d: string): number {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / 86_400_000)
}

/** Projection : `IntervenantPerson[]` (vérité partagée avec la fiche) → leaderboard trié + KPIs. */
export function buildIntervenantsDashboard(
  siteId: string, people: IntervenantPerson[], toIdentifyCount: number, today: string,
): IntervenantsDashboard {
  const rows: IntervenantRow[] = people.map((p) => {
    const openActions = p.assignedActions.length
    const lateActions = p.assignedActions.filter((a) => a.isLate).length
    const engagementsActifs = openActions + p.openObligationsCount
    const daysSinceActivity = p.lastActivity ? daysBetween(p.lastActivity, today) : null
    const otherSitesCount = p.elsewhere.length
    return {
      intervenantId: p.intervenantId,
      contactId: p.contactId,
      isPerson: p.isPerson,
      name: p.name,
      role: p.role,
      companyName: p.companyName,
      openActions,
      lateActions,
      decisionsCount: p.decisionsCount,
      openObligationsCount: p.openObligationsCount,
      engagementsActifs,
      citedVisitsCount: p.citedVisits.length,
      lastActivity: p.lastActivity,
      daysSinceActivity,
      isIdle: daysSinceActivity !== null && daysSinceActivity > IDLE_DAYS,
      otherSitesCount,
      isMultiSite: otherSitesCount > 0,
      href: `/sites/${siteId}/intervenant/${p.intervenantId}`,
    }
  })

  // Tri : engagements desc, puis retards desc, puis nom, puis id — DÉTERMINISTE
  // même à égalité (pas de « saut » d'un rechargement à l'autre).
  rows.sort((a, b) =>
    b.engagementsActifs - a.engagementsActifs
    || b.lateActions - a.lateActions
    || a.name.localeCompare(b.name, 'fr')
    || a.intervenantId.localeCompare(b.intervenantId),
  )

  // KPIs calculés depuis LES MÊMES lignes (jamais une requête parallèle).
  const kpis: IntervenantsDashboardKpis = {
    engagementsActifs: rows.reduce((n, r) => n + r.engagementsActifs, 0),
    lateTotal: rows.reduce((n, r) => n + r.lateActions, 0),
    latePeople: rows.filter((r) => r.lateActions > 0).length,
    idleCount: rows.filter((r) => r.isIdle).length,
    multiSiteCount: rows.filter((r) => r.isMultiSite).length,
    validatedCount: rows.length,
  }

  return { siteId, rows, kpis, toIdentifyCount }
}
