import { describe, expect, it } from 'vitest'

import {
  BATISUD_SITES,
  buildBatiSudInterventionSeeds,
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
})
