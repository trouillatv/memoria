import { describe, expect, it } from 'vitest'
import { buildMissionHealth, scoreMissionSeverity, type MissionHealthInput } from '@/lib/missions/mission-health'

describe('mission health', () => {
  const today = '2026-07-13'

  it('keeps an active recurring mission green when it has a future intervention and a team', () => {
    const health = buildMissionHealth(mission({
      cadence: 'weekly',
      lastInterventionDate: '2026-07-08',
      nextInterventionDate: '2026-07-15',
      assignedTeam: team(),
    }), today)

    expect(health.level).toBe('green')
    expect(health.chips).toEqual([{ tone: 'green', label: 'en rythme' }])
  })

  it('marks missing operational setup as orange, not red', () => {
    const health = buildMissionHealth(mission({
      cadence: 'weekly',
      lastInterventionDate: '2026-07-08',
      nextInterventionDate: null,
      assignedTeam: null,
    }), today)

    expect(health.level).toBe('orange')
    expect(health.sansProchaine).toBe(true)
    expect(health.sansEquipe).toBe(true)
    expect(health.chips.map((chip) => chip.label)).toEqual(['sans prochaine', 'sans équipe'])
  })

  it('uses red only for real overdue recurrence or open anomalies', () => {
    const overdue = buildMissionHealth(mission({
      cadence: 'weekly',
      lastInterventionDate: '2026-06-25',
      nextInterventionDate: null,
      assignedTeam: team(),
    }), today)
    const anomalous = buildMissionHealth(mission({
      cadence: 'monthly',
      lastInterventionDate: '2026-07-01',
      nextInterventionDate: '2026-08-01',
      openAnomalyCount: 2,
      assignedTeam: team(),
    }), today)

    expect(overdue.level).toBe('red')
    expect(overdue.overdueDays).toBe(18)
    expect(overdue.chips[0]).toEqual({ tone: 'red', label: '18 j de retard' })
    expect(anomalous.level).toBe('red')
    expect(anomalous.chips[0]).toEqual({ tone: 'red', label: '2 anomalies' })
  })

  it('scores overdue missions above anomaly-only missions', () => {
    const overdue = buildMissionHealth(mission({
      cadence: 'weekly',
      lastInterventionDate: '2026-06-25',
      nextInterventionDate: null,
    }), today)
    const anomalous = buildMissionHealth(mission({
      openAnomalyCount: 2,
      nextInterventionDate: '2026-07-14',
    }), today)

    expect(scoreMissionSeverity(overdue, 0)).toBeGreaterThan(scoreMissionSeverity(anomalous, 2))
  })
})

function mission(overrides: Partial<MissionHealthInput> = {}): MissionHealthInput {
  return {
    active: overrides.active ?? true,
    cadence: overrides.cadence ?? 'weekly',
    lastInterventionDate: overrides.lastInterventionDate ?? '2026-07-08',
    nextInterventionDate: overrides.nextInterventionDate ?? null,
    openAnomalyCount: overrides.openAnomalyCount ?? 0,
    assignedTeam: overrides.assignedTeam === undefined ? team() : overrides.assignedTeam,
  }
}

function team(): MissionHealthInput['assignedTeam'] {
  return { id: 'team-1', name: 'Equipe Nord', color: '#0ea5e9' }
}
