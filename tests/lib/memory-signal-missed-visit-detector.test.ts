// Visites oubliées (missed_visit) — deux notions, dates civiles Nouméa :
//   · planned_visit_overdue : intervention planifiée dont la date est passée ;
//   · site_visit_stale : chantier sans visite depuis le seuil (N jours).
// Règle de dédup : un chantier qui porte déjà une intervention en retard ne
// remonte PAS aussi en « sans visite ».

import { describe, expect, it } from 'vitest'
import { detectMissedVisitSignals, STALE_VISIT_THRESHOLD_DAYS } from '@/lib/memory/signals/missed-visit-detector'
import { presentSituation } from '@/lib/situations/presenter'
import { projectSituationForAttention } from '@/lib/situations/attention/project'
import type { OverduePlannedVisit, SiteLastVisit } from '@/lib/db/forgotten-visits'

// 2026-07-28T08:00Z = 2026-07-28 19:00 à Nouméa → aujourd'hui local = 28.
const NOW = '2026-07-28T08:00:00.000Z'

const planned = (over: Partial<OverduePlannedVisit> = {}): OverduePlannedVisit => ({
  interventionId: 'intv-1', siteId: 'site-1', siteName: 'Lycée PETRO ATTITI',
  organizationId: 'org-1', missionName: 'Contrôle mensuel', scheduledFor: '2026-07-22', ...over,
})

const site = (over: Partial<SiteLastVisit> = {}): SiteLastVisit => ({
  siteId: 'site-1', siteName: 'Lycée PETRO ATTITI', organizationId: 'org-1',
  lastVisitAt: '2026-06-01T09:00:00.000Z', ...over,
})

describe('detectMissedVisitSignals', () => {
  it('intervention planifiée passée → signal planned_visit_overdue (warning, jamais critique)', () => {
    const [s] = detectMissedVisitSignals({ overduePlanned: [planned()], staleSites: [] }, NOW)
    expect(s).toMatchObject({
      trigger: { type: 'missed_visit', reason: 'planned_visit_overdue' },
      severity: 'warning',
      dedupeKey: 'missed-visit-planned:site-1:intv-1',
    })
  })

  it('chantier sans visite au-delà du seuil → signal site_visit_stale', () => {
    // 2026-06-01 → 2026-07-28 = 57 jours civils > seuil.
    const [s] = detectMissedVisitSignals({ overduePlanned: [], staleSites: [site()] }, NOW)
    expect(s).toMatchObject({ trigger: { type: 'missed_visit', reason: 'site_visit_stale' } })
  })

  it('sous le seuil → aucun signal de staleness', () => {
    const recent = new Date(Date.parse(NOW) - (STALE_VISIT_THRESHOLD_DAYS - 5) * 86_400_000).toISOString()
    expect(detectMissedVisitSignals({ overduePlanned: [], staleSites: [site({ lastVisitAt: recent })] }, NOW)).toHaveLength(0)
  })

  it('jamais visité (lastVisitAt null) → jamais de staleness (bruit onboarding évité)', () => {
    expect(detectMissedVisitSignals({ overduePlanned: [], staleSites: [site({ lastVisitAt: null })] }, NOW)).toHaveLength(0)
  })

  it('un chantier avec intervention en retard ne remonte PAS aussi en « sans visite »', () => {
    const signals = detectMissedVisitSignals({ overduePlanned: [planned()], staleSites: [site()] }, NOW)
    expect(signals).toHaveLength(1)
    expect(signals[0].trigger.reason).toBe('planned_visit_overdue')
  })

  it('intervention datée aujourd\'hui (pas encore en retard) → aucun signal', () => {
    expect(detectMissedVisitSignals({ overduePlanned: [planned({ scheduledFor: '2026-07-28' })], staleSites: [] }, NOW)).toHaveLength(0)
  })

  it('traverse presenter + projection : cartes bien typées et priorisées', () => {
    const [overdue] = detectMissedVisitSignals({ overduePlanned: [planned()], staleSites: [] }, NOW)
    const overdueCard = projectSituationForAttention(presentSituation(overdue, NOW), new Date(NOW))
    expect(overdueCard).toMatchObject({ kind: 'overdue_planned_visit', title: 'Contrôle mensuel', siteLabel: 'Lycée PETRO ATTITI' })
    // impact 35 + urgence « overdue » 25 = 60, sous une action en retard (65).
    expect(overdueCard!.priority).toBe(60)

    const [stale] = detectMissedVisitSignals({ overduePlanned: [], staleSites: [site()] }, NOW)
    const staleCard = projectSituationForAttention(presentSituation(stale, NOW), new Date(NOW))
    expect(staleCard).toMatchObject({ kind: 'stale_site_visit', tone: 'amber' })
    // impact 15, sans urgence datée → priorité basse (nudge doux).
    expect(staleCard!.priority).toBe(15)
  })
})
