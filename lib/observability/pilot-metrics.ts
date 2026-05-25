// Dashboard d'observation pilote — helpers DB.
//
// Vincent 2026-05-22 — Phase de gel observation post-Sprint E.
//
// Doctrine [[risque-deux-morts-opposees]] : on observe pour rester au
// centre. Pas de KPI productivité agent. Pas de scoring. Pas de RH.
// Métriques 100% descriptives sur USAGE PRODUIT (pas sur humains).
//
// 5 catégories de métriques :
//   1. Volumes briefs (créés / partagés / consultés / reconnus / archivés)
//   2. Qualité d'usage (délais, ratios)
//   3. Engagement Guillaume (connexions spontanées, top pages, feedbacks)
//   4. Centrage anti-deux-morts (éléments visibles dashboard, ratio
//      pages silencieuses, feedbacks "trop X")
//   5. Signaux d'alerte (règles agrégées qui déclenchent 🚨)
//
// Limitations connues — à instrumenter en V2 :
//   - Scroll depth dans /h/[token] (pas d'analytics)
//   - Latence 1er clic utile (pas de timing client → server)
//   - Top pages avec URL exacte (activity_log a entity_type pas URL)

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { collectMemorySignals } from '@/lib/memory/signals/collect'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'

// ─── Types ──────────────────────────────────────────────────────────────────

export type PeriodDays = 7 | 14 | 30

export interface BriefVolumes {
  total: number
  byStatus: { draft: number; shared: number; acknowledged: number; archived: number }
  totalAccessCount: number
  archivedWithoutConsultation: number
}

export interface BriefQuality {
  /** Délai moyen création → partage (briefs partagés uniquement). */
  avgDaysCreatedToShared: number | null
  /** Délai moyen partage → 1ère consultation (briefs partagés avec accès). */
  avgHoursSharedToFirstAccess: number | null
  /** Ratio acknowledged / shared (en %). */
  acknowledgmentRate: number | null
  /** Nb moyen de sites par brief. */
  avgSitesPerBrief: number | null
}

export interface Engagement {
  /** Distinct users qui ont consulté MemorIA sur la période (via activity_logs). */
  activeUserCount: number
  /** Top 5 entity_types les plus consultés. */
  topEntityTypes: Array<{ entity_type: string; count: number }>
  /** Total feedbacks reçus sur la période. */
  feedbackCount: number
  /** Top feedbacks ouverts. */
  recentFeedbacks: Array<{
    id: string
    page: string | null
    message: string
    created_at: string
    status: string
  }>
}

export interface CenteringMetrics {
  /** Occurrences de mots indicateurs de surconstruction dans les feedbacks. */
  feedbackTrop: number
  feedbackNonCompris: number
  feedbackAnxiogene: number
  /** Indicateurs de sous-intelligence (signaux d'inutilité). */
  feedbackInutile: number
  /** Briefs créés mais archivés sans consultation (signal de bruit). */
  briefsCreatedThenArchivedUnread: number
  /** Briefs avec >10 sites (signal "brief fantôme"). */
  briefsOversized: number
}

// Couche A — Production de mémoire : « le système se nourrit-il ? »
export interface MemoryProduction {
  aSavoirCreated: number
  anomaliesDocumented: number
  documentsUploaded: number
  documentsCold: number // memory_tier='froide' (stockés, non indexés)
}

// Couche A — Santé du moteur : signaux ACTUELLEMENT produits, par type.
// (La part « production » du moteur. Le vu/cliqué/ignoré = Couche B,
//  nécessite une instrumentation d'impressions/clics non encore en place.)
export interface EngineHealthItem {
  kind: string
  label: string
  family: string
  valence: string
  count: number
}

export interface AlertSignal {
  level: 'red' | 'amber' | 'info'
  category: 'sub-intelligence' | 'overconstruction' | 'invisible' | 'engagement'
  title: string
  detail: string
}

export interface ObservationSnapshot {
  period: PeriodDays
  periodStart: string
  periodEnd: string
  volumes: BriefVolumes
  quality: BriefQuality
  engagement: Engagement
  centering: CenteringMetrics
  production: MemoryProduction
  engineHealth: EngineHealthItem[]
  alerts: AlertSignal[]
}

// ─── Helpers privés ─────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function countMatches(strings: string[], regex: RegExp): number {
  return strings.filter((s) => regex.test(s.toLowerCase())).length
}

// ─── Volumes briefs ─────────────────────────────────────────────────────────

async function getBriefVolumes(periodStart: string): Promise<BriefVolumes> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('handover_briefs')
    .select('id, status, access_count, deleted_at, last_accessed_at')
    .gte('created_at', periodStart)
  if (error) throw error

  const byStatus = { draft: 0, shared: 0, acknowledged: 0, archived: 0 }
  let totalAccessCount = 0
  let archivedWithoutConsultation = 0

  for (const b of data ?? []) {
    if (b.deleted_at || b.status === 'archived') {
      byStatus.archived += 1
      if (!b.last_accessed_at) archivedWithoutConsultation += 1
    } else {
      const s = b.status as keyof typeof byStatus
      if (s in byStatus) byStatus[s] += 1
    }
    totalAccessCount += b.access_count ?? 0
  }

  return {
    total: (data ?? []).length,
    byStatus,
    totalAccessCount,
    archivedWithoutConsultation,
  }
}

// ─── Qualité ────────────────────────────────────────────────────────────────

async function getBriefQuality(periodStart: string): Promise<BriefQuality> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('handover_briefs')
    .select('id, status, payload, created_at, shared_at, last_accessed_at, acknowledged_at')
    .gte('created_at', periodStart)
    .is('deleted_at', null)
  if (error) throw error
  const rows = (data ?? []) as Array<{
    id: string
    status: string
    payload: { sites?: unknown[] }
    created_at: string
    shared_at: string | null
    last_accessed_at: string | null
    acknowledged_at: string | null
  }>

  const delaysCreatedToShared: number[] = []
  const delaysSharedToAccess: number[] = []
  const sitesCounts: number[] = []
  let sharedCount = 0
  let acknowledgedCount = 0

  for (const r of rows) {
    if (r.payload?.sites && Array.isArray(r.payload.sites)) {
      sitesCounts.push(r.payload.sites.length)
    }
    if (r.shared_at) {
      sharedCount += 1
      const days =
        (new Date(r.shared_at).getTime() - new Date(r.created_at).getTime()) / 86400000
      delaysCreatedToShared.push(days)
      if (r.last_accessed_at) {
        const hours =
          (new Date(r.last_accessed_at).getTime() - new Date(r.shared_at).getTime()) /
          3600000
        if (hours >= 0) delaysSharedToAccess.push(hours)
      }
    }
    if (r.status === 'acknowledged') acknowledgedCount += 1
  }

  return {
    avgDaysCreatedToShared: avg(delaysCreatedToShared),
    avgHoursSharedToFirstAccess: avg(delaysSharedToAccess),
    acknowledgmentRate: sharedCount > 0 ? (acknowledgedCount / sharedCount) * 100 : null,
    avgSitesPerBrief: avg(sitesCounts),
  }
}

// ─── Engagement Guillaume / managers ────────────────────────────────────────

async function getEngagement(periodStart: string): Promise<Engagement> {
  const admin = createAdminClient()

  // Distinct users actifs (via activity_logs)
  const { data: activity } = await admin
    .from('activity_logs')
    .select('user_id, entity_type')
    .gte('created_at', periodStart)
    .not('user_id', 'is', null)

  const userSet = new Set<string>()
  const entityTypeCounts = new Map<string, number>()
  for (const a of (activity ?? []) as Array<{
    user_id: string | null
    entity_type: string
  }>) {
    if (a.user_id) userSet.add(a.user_id)
    entityTypeCounts.set(a.entity_type, (entityTypeCounts.get(a.entity_type) ?? 0) + 1)
  }
  const topEntityTypes = Array.from(entityTypeCounts.entries())
    .map(([entity_type, count]) => ({ entity_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Feedbacks
  const { data: feedbacks } = await admin
    .from('feedback')
    .select('id, page, message, created_at, status')
    .gte('created_at', periodStart)
    .order('created_at', { ascending: false })

  const fbRows = (feedbacks ?? []) as Array<{
    id: string
    page: string | null
    message: string
    created_at: string
    status: string
  }>

  return {
    activeUserCount: userSet.size,
    topEntityTypes,
    feedbackCount: fbRows.length,
    recentFeedbacks: fbRows.slice(0, 5),
  }
}

// ─── Centrage anti-deux-morts ───────────────────────────────────────────────

async function getCenteringMetrics(
  periodStart: string,
  volumes: BriefVolumes,
): Promise<CenteringMetrics> {
  const admin = createAdminClient()
  const { data: feedbacks } = await admin
    .from('feedback')
    .select('message')
    .gte('created_at', periodStart)
  const msgs = ((feedbacks ?? []) as Array<{ message: string }>).map((f) => f.message)

  // Briefs avec >10 sites
  const { data: oversized } = await admin
    .from('handover_briefs')
    .select('id, payload')
    .gte('created_at', periodStart)
    .is('deleted_at', null)
  const briefsOversized = ((oversized ?? []) as Array<{
    id: string
    payload: { sites?: unknown[] }
  }>).filter(
    (b) => Array.isArray(b.payload?.sites) && (b.payload.sites?.length ?? 0) > 10,
  ).length

  return {
    feedbackTrop: countMatches(msgs, /\b(trop|surchargé|surchargée|brouillon|brouillé|bordel)\b/),
    feedbackNonCompris: countMatches(
      msgs,
      /\bj['e]?ai? pas compris\b|\bne comprends pas\b|\bclair\b|\bperdu\b|\bperdue\b/,
    ),
    feedbackAnxiogene: countMatches(
      msgs,
      /\banxio|stress|peur|angoiss|inquiet|f?lic|surveill/,
    ),
    feedbackInutile: countMatches(
      msgs,
      /\binutile|sert à rien|ne change rien|déjà su\b|deja su\b|vu/,
    ),
    briefsCreatedThenArchivedUnread: volumes.archivedWithoutConsultation,
    briefsOversized,
  }
}

// ─── Production de mémoire (Couche A) ───────────────────────────────────────

async function getMemoryProduction(periodStart: string): Promise<MemoryProduction> {
  const admin = createAdminClient()
  const [aSavoir, anomalies, docs] = await Promise.all([
    admin.from('site_notes').select('id', { count: 'exact', head: true })
      .eq('kind', 'a_savoir').is('deleted_at', null).gte('created_at', periodStart),
    admin.from('intervention_anomalies').select('id', { count: 'exact', head: true })
      .gte('created_at', periodStart),
    admin.from('documents').select('memory_tier').is('deleted_at', null).gte('created_at', periodStart),
  ])
  const docRows = (docs.data ?? []) as Array<{ memory_tier: string | null }>
  return {
    aSavoirCreated: aSavoir.count ?? 0,
    anomaliesDocumented: anomalies.count ?? 0,
    documentsUploaded: docRows.length,
    documentsCold: docRows.filter((d) => d.memory_tier === 'froide').length,
  }
}

// ─── Santé du moteur (Couche A — part production) ───────────────────────────

async function getEngineHealth(): Promise<EngineHealthItem[]> {
  // Snapshot ACTUEL des signaux produits (état courant, pas borné période).
  const signals = await collectMemorySignals().catch(() => [])
  const counts = new Map<string, number>()
  for (const s of signals) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
  return (Object.keys(SIGNAL_REGISTRY) as Array<keyof typeof SIGNAL_REGISTRY>).map((kind) => {
    const meta = SIGNAL_REGISTRY[kind]
    return {
      kind,
      label: meta.label,
      family: meta.family,
      valence: meta.valence,
      count: counts.get(kind) ?? 0,
    }
  })
}

// ─── Alertes (règles agrégées) ──────────────────────────────────────────────

function computeAlerts(
  period: PeriodDays,
  volumes: BriefVolumes,
  quality: BriefQuality,
  engagement: Engagement,
  centering: CenteringMetrics,
): AlertSignal[] {
  const alerts: AlertSignal[] = []

  // ── Invisibilité ──
  if (period >= 14 && volumes.total === 0) {
    alerts.push({
      level: 'red',
      category: 'invisible',
      title: `Aucun brief créé sur les ${period} derniers jours`,
      detail:
        'La feature passage de témoin est probablement invisible pour les utilisateurs. Vérifier l\'amorçage depuis /intervenants/[id] et /equipes/[id].',
    })
  }

  // ── Sous-engagement ──
  if (period >= 14 && engagement.activeUserCount === 0) {
    alerts.push({
      level: 'red',
      category: 'engagement',
      title: `Aucun utilisateur actif sur ${period} jours`,
      detail:
        'Aucune activité enregistrée dans activity_logs — MemorIA n\'est probablement pas ouvert spontanément.',
    })
  }

  // ── Briefs créés sans partage ──
  if (volumes.byStatus.draft > 3 && volumes.byStatus.shared === 0) {
    alerts.push({
      level: 'amber',
      category: 'engagement',
      title: `${volumes.byStatus.draft} briefs créés mais aucun partagé`,
      detail:
        'Les managers créent des briefs mais ne les envoient pas. Friction de partage à investiguer.',
    })
  }

  // ── Briefs archivés sans lecture ──
  if (centering.briefsCreatedThenArchivedUnread > 2) {
    alerts.push({
      level: 'amber',
      category: 'overconstruction',
      title: `${centering.briefsCreatedThenArchivedUnread} briefs archivés sans consultation`,
      detail:
        'Briefs créés pour rien — soit le besoin n\'est pas réel, soit la transmission ne se fait pas.',
    })
  }

  // ── Brief fantôme (>10 sites) ──
  if (centering.briefsOversized > 0) {
    alerts.push({
      level: 'amber',
      category: 'overconstruction',
      title: `${centering.briefsOversized} brief(s) avec plus de 10 sites`,
      detail:
        'Risque de brief anxiogène. Vérifier les caps SITE_CAP dans lib/db/handover.ts ou la filtration par équipe source.',
    })
  }

  // ── Feedbacks surconstruction ──
  if (centering.feedbackTrop >= 3) {
    alerts.push({
      level: 'red',
      category: 'overconstruction',
      title: `${centering.feedbackTrop} feedback(s) "trop X / surchargé"`,
      detail:
        'Signal fort de surconstruction. Resserrer ce qui parle trop (caps, filtres, atténuation visuelle).',
    })
  }
  if (centering.feedbackNonCompris >= 3) {
    alerts.push({
      level: 'amber',
      category: 'overconstruction',
      title: `${centering.feedbackNonCompris} feedback(s) "j'ai pas compris"`,
      detail: 'Le wording ou la hiérarchie visuelle est confuse. Auditer la page concernée.',
    })
  }
  if (centering.feedbackAnxiogene >= 1) {
    alerts.push({
      level: 'red',
      category: 'overconstruction',
      title: `${centering.feedbackAnxiogene} feedback(s) "anxiogène / surveillance"`,
      detail:
        '⚠️ Glissement perceptif vers surveillance. Action immédiate : audit de la surface incriminée, kill switch si nécessaire.',
    })
  }

  // ── Sous-intelligence ──
  if (centering.feedbackInutile >= 3) {
    alerts.push({
      level: 'amber',
      category: 'sub-intelligence',
      title: `${centering.feedbackInutile} feedback(s) "inutile / déjà su"`,
      detail:
        'Les résonances ou briefs ne disent rien que l\'utilisateur ne savait déjà. Auditer la qualité des sorties IA (jury 4 classes).',
    })
  }

  // ── Acknowledgment rate faible ──
  if (
    quality.acknowledgmentRate !== null &&
    volumes.byStatus.shared >= 3 &&
    quality.acknowledgmentRate < 40
  ) {
    alerts.push({
      level: 'amber',
      category: 'engagement',
      title: `Taux de reconnaissance ${quality.acknowledgmentRate.toFixed(0)}% (cible >60%)`,
      detail:
        'Les briefs partagés ne sont pas confirmés "C\'est lu". Soit ils ne sont pas reçus, soit le bouton n\'est pas visible.',
    })
  }

  return alerts
}

// ─── Snapshot complet ───────────────────────────────────────────────────────

export async function buildObservationSnapshot(
  period: PeriodDays = 14,
): Promise<ObservationSnapshot> {
  const periodStart = isoDaysAgo(period)
  const periodEnd = new Date().toISOString()

  const [volumes, quality, engagement, production, engineHealth] = await Promise.all([
    getBriefVolumes(periodStart),
    getBriefQuality(periodStart),
    getEngagement(periodStart),
    getMemoryProduction(periodStart),
    getEngineHealth(),
  ])
  const centering = await getCenteringMetrics(periodStart, volumes)
  const alerts = computeAlerts(period, volumes, quality, engagement, centering)

  return {
    period,
    periodStart,
    periodEnd,
    volumes,
    quality,
    engagement,
    centering,
    production,
    engineHealth,
    alerts,
  }
}
