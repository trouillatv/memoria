// Détecteur « visites oubliées » (pur, testable) — deux notions, une famille :
//   · planned_visit_overdue : intervention planifiée dont la date civile est
//     passée, jamais réalisée. La cause est précise (une échéance ratée).
//   · site_visit_stale : chantier sans visite terrain depuis un seuil (N jours).
//
// Tout se calcule en DATE CIVILE Nouméa (comme les autres détecteurs) : « depuis
// N jours » est une notion de calendrier, pas une différence brute d'heures.

import type { MemorySignal } from './operational-contract'
import type { OverduePlannedVisit, SiteLastVisit } from '@/lib/db/forgotten-visits'
import { localDateOf } from '@/lib/time/local-date'

/** Seuil de staleness par défaut : un chantier muet depuis plus d'un mois. */
export const STALE_VISIT_THRESHOLD_DAYS = 30

function civilDiffDays(fromCivil: string, toCivil: string): number {
  const [fy, fm, fd] = fromCivil.split('-').map(Number)
  const [ty, tm, td] = toCivil.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function overdueSignal(v: OverduePlannedVisit, now: string, daysLate: number): MemorySignal {
  const href = `/m/site/${v.siteId}`
  return {
    id: `missed-visit-planned:${v.siteId}:${v.interventionId}`,
    organizationId: v.organizationId,
    siteId: v.siteId,
    category: 'priority',
    trigger: { type: 'missed_visit', reason: 'planned_visit_overdue' },
    severity: 'warning',
    importance: 'normal',
    urgency: 'today',
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [
      {
        type: 'action', key: 'what', value: v.missionName, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: v.scheduledFor, validUntil: null,
      },
      {
        type: 'site', key: 'where', value: v.siteName, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
      },
      {
        type: 'timing', key: 'days_late', value: daysLate, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
      },
    ],
    rules: [{ id: 'planned_visit_overdue', version: '1' }],
    sources: [{ type: 'site', id: v.siteId, href, label: v.siteName }],
    subject: null,
    actions: [{ kind: 'investigate', label: 'Voir le chantier', href }],
    confidence: null,
    dedupeKey: `missed-visit-planned:${v.siteId}:${v.interventionId}`,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

function staleSignal(s: SiteLastVisit, now: string, daysSince: number): MemorySignal {
  const href = `/m/site/${s.siteId}`
  return {
    id: `missed-visit-stale:${s.siteId}`,
    organizationId: s.organizationId,
    siteId: s.siteId,
    category: 'priority',
    trigger: { type: 'missed_visit', reason: 'site_visit_stale' },
    severity: 'warning',
    importance: 'normal',
    urgency: 'week',
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [
      {
        type: 'site', key: 'what', value: s.siteName, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
      },
      {
        type: 'site', key: 'where', value: s.siteName, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
      },
      {
        type: 'timing', key: 'days_since_visit', value: daysSince, confidence: null,
        sourceIds: [], detectedAt: now, occurredAt: s.lastVisitAt, dueAt: null, validUntil: null,
      },
    ],
    rules: [{ id: 'site_visit_stale', version: '1' }],
    sources: [{ type: 'site', id: s.siteId, href, label: s.siteName }],
    subject: null,
    actions: [{ kind: 'investigate', label: 'Voir le chantier', href }],
    confidence: null,
    dedupeKey: `missed-visit-stale:${s.siteId}`,
    detectedAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
  }
}

/**
 * Signaux « visites oubliées ». Une intervention en retard prime sur la staleness
 * d'un même chantier : inutile de dire « sans visite depuis 40 j » ET « visite de
 * mardi non faite » — le retard précis suffit. On déduplique donc la staleness
 * des sites qui portent déjà une intervention en retard.
 */
export function detectMissedVisitSignals(
  candidates: { overduePlanned: OverduePlannedVisit[]; staleSites: SiteLastVisit[] },
  now = new Date().toISOString(),
  thresholdDays = STALE_VISIT_THRESHOLD_DAYS,
): MemorySignal[] {
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return []
  const todayCivil = localDateOf(new Date(nowTimestamp))

  const signals: MemorySignal[] = []
  const sitesWithOverdue = new Set<string>()

  for (const v of candidates.overduePlanned) {
    const daysLate = civilDiffDays(v.scheduledFor, todayCivil)
    if (daysLate <= 0) continue
    sitesWithOverdue.add(v.siteId)
    signals.push(overdueSignal(v, now, daysLate))
  }

  for (const s of candidates.staleSites) {
    if (!s.lastVisitAt || sitesWithOverdue.has(s.siteId)) continue
    const daysSince = civilDiffDays(localDateOf(new Date(s.lastVisitAt)), todayCivil)
    if (daysSince < thresholdDays) continue
    signals.push(staleSignal(s, now, daysSince))
  }

  return signals
}
