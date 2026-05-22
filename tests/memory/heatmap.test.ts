import { describe, it, expect } from 'vitest'
import { buildMemoryHeatmap } from '@/lib/memory/heatmap.logic'

const NOW = new Date('2026-05-22T12:00:00.000Z').getTime()

describe('buildMemoryHeatmap (cœur pur)', () => {
  it('déterministe + une cellule par jour', () => {
    const input = { acknowledgedDates: [], sharedDates: [], noteDates: [], openAnomalyDates: [] }
    const a = buildMemoryHeatmap(input, NOW, 30)
    const b = buildMemoryHeatmap(input, NOW, 30)
    expect(a).toEqual(b)
    expect(a).toHaveLength(30)
    expect(a.every((c) => c.tone === null)).toBe(true)
    // dernière cellule = aujourd'hui
    expect(a[a.length - 1]!.date).toBe('2026-05-22')
  })

  it('priorité des teintes : confirmée > transmission > mémoire > fragilité', () => {
    const cells = buildMemoryHeatmap(
      {
        acknowledgedDates: ['2026-05-20'],
        sharedDates: ['2026-05-20', '2026-05-19'], // 20 perd face à ack
        noteDates: ['2026-05-19', '2026-05-18'], // 19 perd face à shared
        openAnomalyDates: ['2026-05-18', '2026-05-17'], // 18 perd face à note
      },
      NOW,
      7,
    )
    const byDate = new Map(cells.map((c) => [c.date, c.tone]))
    expect(byDate.get('2026-05-20')).toBe('green') // ack gagne
    expect(byDate.get('2026-05-19')).toBe('amber') // shared gagne sur note
    expect(byDate.get('2026-05-18')).toBe('blue') // note gagne sur anomaly
    expect(byDate.get('2026-05-17')).toBe('red') // seule anomaly
    expect(byDate.get('2026-05-21')).toBe(null) // rien
  })

  it('normalise les timestamps ISO en jour (yyyy-mm-dd)', () => {
    const cells = buildMemoryHeatmap(
      { acknowledgedDates: ['2026-05-21T18:30:00.000Z'], sharedDates: [], noteDates: [], openAnomalyDates: [] },
      NOW,
      7,
    )
    expect(cells.find((c) => c.date === '2026-05-21')?.tone).toBe('green')
  })
})
