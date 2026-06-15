import { describe, it, expect } from 'vitest'
import {
  WEATHER_META,
  weatherLabel,
  mergeWeatherIntoJournal,
} from '@/lib/db/site-day-log'
import type { JournalEntry } from '@/lib/db/site-journal'

function entry(date: string, n = 1): JournalEntry {
  return {
    date,
    interventions: Array.from({ length: n }, (_, i) => ({
      id: `${date}-${i}`,
      missionName: 'Coffrage R+1',
      status: 'completed',
      executedAt: null,
      scheduledAt: `${date}T07:00:00.000Z`,
      notes: null,
      teamName: null,
      teamColor: null,
      participantCount: 0,
      photoCount: 0,
      anomaliesOpen: 0,
      anomaliesResolved: 0,
      companies: [],
    })),
  }
}

describe('WEATHER_META / weatherLabel', () => {
  it('couvre les 8 codes météo', () => {
    expect(Object.keys(WEATHER_META)).toHaveLength(8)
  })
  it('libellé FR pour un code connu', () => {
    expect(weatherLabel('storm')).toBe('Orage')
    expect(weatherLabel('heavy_rain')).toBe('Forte pluie')
  })
  it('null si pas de code', () => {
    expect(weatherLabel(null)).toBeNull()
    expect(weatherLabel(undefined)).toBeNull()
  })
})

describe('mergeWeatherIntoJournal', () => {
  it('attache la météo à un jour déjà présent', () => {
    const out = mergeWeatherIntoJournal(
      [entry('2026-06-15')],
      [{ logDate: '2026-06-15', weather: 'rain', intemperie: false, note: 'pluie depuis 6h' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0].weather).toBe('rain')
    expect(out[0].weatherNote).toBe('pluie depuis 6h')
    expect(out[0].interventions).toHaveLength(1)
  })

  it("injecte un jour d'intempérie SANS intervention (preuve anti-pénalités)", () => {
    const out = mergeWeatherIntoJournal(
      [entry('2026-06-14')],
      [{ logDate: '2026-06-15', weather: 'storm', intemperie: true, note: null }],
    )
    expect(out).toHaveLength(2)
    const d15 = out.find((e) => e.date === '2026-06-15')!
    expect(d15.intemperie).toBe(true)
    expect(d15.interventions).toEqual([])
  })

  it('trie du jour le plus récent au plus ancien', () => {
    const out = mergeWeatherIntoJournal(
      [entry('2026-06-10')],
      [{ logDate: '2026-06-20', weather: null, intemperie: true, note: null }],
    )
    expect(out.map((e) => e.date)).toEqual(['2026-06-20', '2026-06-10'])
  })

  it("ne mute pas les entrées d'entrée", () => {
    const input = [entry('2026-06-15')]
    mergeWeatherIntoJournal(input, [
      { logDate: '2026-06-15', weather: 'rain', intemperie: false, note: 'x' },
    ])
    expect(input[0].weather).toBeUndefined()
  })
})
