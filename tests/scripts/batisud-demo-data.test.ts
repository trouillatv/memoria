import { describe, expect, it } from 'vitest'

import {
  BATISUD_SITES,
  BATISUD_TEAM_MEMBERS,
  BATISUD_TEAMS,
  buildBatiSudInterventionSeeds,
  buildBatiSudSiteReturnNote,
  toIsoDate,
} from '@/scripts/dev/batisud-demo-data'

describe('BatiSud demo seed data', () => {
  const baseDate = new Date('2026-06-07T00:00:00.000Z')

  it('builds the requested BTP intervention volume across history and planning', () => {
    const seeds = buildBatiSudInterventionSeeds(baseDate)

    expect(seeds).toHaveLength(20)
    expect(seeds.filter((seed) => seed.dayOffset < 0)).toHaveLength(8)
    expect(seeds.filter((seed) => seed.dayOffset > 0)).toHaveLength(12)
    expect(seeds.filter((seed) => seed.anomaly)).toHaveLength(10)

    expect(new Set(seeds.map((seed) => seed.siteName))).toEqual(
      new Set(BATISUD_SITES.map((site) => site.name)),
    )
    expect(new Set(seeds.map((seed) => seed.status))).toEqual(
      new Set(['planned', 'completed', 'validated']),
    )
  })

  it('keeps planned interventions inside the next 3 weeks and history inside 14 days', () => {
    const seeds = buildBatiSudInterventionSeeds(baseDate)
    const futureDates = seeds
      .filter((seed) => seed.dayOffset > 0)
      .map((seed) => toIsoDate(baseDate, seed.dayOffset))
    const pastDates = seeds
      .filter((seed) => seed.dayOffset < 0)
      .map((seed) => toIsoDate(baseDate, seed.dayOffset))

    expect(futureDates.every((date) => date >= '2026-06-08')).toBe(true)
    expect(futureDates.every((date) => date <= '2026-06-27')).toBe(true)
    expect(pastDates.every((date) => date >= '2026-05-24')).toBe(true)
    expect(pastDates.every((date) => date <= '2026-06-06')).toBe(true)
  })

  it('provides named members and one referent for every BatiSud team', () => {
    const teamNames = new Set(BATISUD_TEAMS.map((team) => team.name))
    const memberTeamNames = new Set(BATISUD_TEAM_MEMBERS.map((member) => member.teamName))

    expect(memberTeamNames).toEqual(teamNames)

    for (const team of BATISUD_TEAMS) {
      const members = BATISUD_TEAM_MEMBERS.filter((member) => member.teamName === team.name)
      expect(members.length).toBeGreaterThanOrEqual(2)
      expect(members.filter((member) => member.referent)).toHaveLength(1)
      expect(members.every((member) => member.email.endsWith('@memoria.nc'))).toBe(true)
    }
  })

  it('keeps generated return notes compatible with site_notes constraints', () => {
    const seeds = buildBatiSudInterventionSeeds(baseDate)

    for (const seed of seeds.filter((item) => item.dayOffset < 0)) {
      const note = buildBatiSudSiteReturnNote(seed)
      expect(note.length).toBeLessThanOrEqual(140)
      expect(note).toContain(seed.title)
    }
  })
})
